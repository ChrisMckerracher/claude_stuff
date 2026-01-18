# Claude Bus: External Daemon Architecture

## Problem Statement

The current singleton approach (documented in `claude-bus-singleton-server.md`) fails because MCP servers configured in `~/.claude/settings.json` spawn **per Claude Code process**:

```
~/.claude/settings.json:
{
  "mcpServers": {
    "claude-bus": {
      "command": "node",
      "args": ["cli.js", "serve"]
    }
  }
}

Result:
Claude (orch)  ─spawns─► MCP Server A (isolated state)
Claude (z.ai1) ─spawns─► MCP Server B (isolated state)
Claude (z.ai2) ─spawns─► MCP Server C (isolated state)
```

The IPC/Unix socket approach tried to detect existing servers and connect as clients, but **Claude Code spawns the MCP server before our code runs**. We can't intercept this.

## Research Findings

### Pattern 1: External Daemon (PM2, D-Bus model)

**How it works:** Start the coordination server outside of Claude Code entirely. MCP "server" becomes a thin client that connects to the external daemon.

Example: [PM2](https://pm2.keymetrics.io/) uses this pattern:
- PM2 daemon runs independently (`pm2-daemon`)
- CLI connects to daemon via Unix socket
- All CLI instances share same daemon state

**Pros:**
- True singleton - one process, shared state
- Survives Claude Code restarts
- Can start before any Claude instance

**Cons:**
- Requires manual daemon management
- Another process to monitor/restart

### Pattern 2: Shared State via SQLite (Claude-Flow model)

**How it works:** Use a file-based database that all processes read/write. No central coordinator - processes coordinate via atomic DB operations.

[Claude-Flow](https://github.com/ruvnet/claude-flow) uses this:
- SQLite at `.swarm/memory.db`
- All agents read/write shared state
- Coordination via DB transactions

**Pros:**
- No daemon to manage
- Survives all crashes (file-based)
- Simple to implement

**Cons:**
- Polling for changes (no push notifications)
- SQLite write contention under high load
- Need careful locking for task assignment

### Pattern 3: External Message Broker (NATS, Redis)

**How it works:** Use an off-the-shelf message broker for coordination.

[NATS](https://nats.io/) is particularly suited:
- Lightweight, single binary
- Request-reply pattern for task assignment
- No persistence needed (workers re-register)

**Pros:**
- Battle-tested coordination
- Built-in pub/sub for notifications
- Handles all the hard distributed problems

**Cons:**
- External dependency
- Overkill for 2-5 workers
- Requires NATS server running

## Recommendation: External Daemon Pattern

For claude-bus, the **external daemon pattern** is the best fit:

1. **Minimal change** - Keep existing MCP tool interface
2. **Simple** - One daemon process, Unix socket IPC
3. **Matches mental model** - Users already expect a "bus" to be a separate thing

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Startup (before Claude Code)                              │
│                                                                              │
│  Terminal: claude-bus daemon start                                           │
│            └─► Creates /tmp/claude-bus-{cwd-hash}.sock                       │
│            └─► Listens for IPC connections                                   │
│            └─► Maintains worker/queue state                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Claude Code (MCP Server = Thin Client)                    │
│                                                                              │
│  MCP Server spawned by Claude Code:                                          │
│    └─► Connects to /tmp/claude-bus-{cwd-hash}.sock                           │
│    └─► Forwards all tool calls to daemon via IPC                             │
│    └─► Returns daemon responses to Claude                                    │
│                                                                              │
│  If daemon not running:                                                      │
│    └─► Returns error: "Bus daemon not running. Start with: claude-bus start" │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Usage Flow

```bash
# 1. Start daemon (once, before opening Claude instances)
claude-bus start
# Output: Bus daemon started at /tmp/claude-bus-abc123.sock

# 2. Open Claude Code instances (they connect as clients)
# - MCP server spawns, connects to daemon
# - All instances share same daemon state

# 3. Stop daemon when done
claude-bus stop
```

### Auto-Start Daemon (DEFAULT)

**Decision:** MCP client auto-starts daemon if not running. This matches PM2/D-Bus behavior and reduces user friction.

```typescript
async function ensureDaemon(): Promise<Socket> {
  const socketPath = getSocketPath();

  // Try to connect
  const socket = await tryConnect(socketPath);
  if (socket) return socket;

  // Not running - spawn daemon
  const daemon = spawn('claude-bus', ['daemon', '--background'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore']
  });
  daemon.unref();

  // Wait for socket to appear (with retries)
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    const socket = await tryConnect(socketPath);
    if (socket) return socket;
  }

  throw new Error('Failed to start daemon');
}
```

Users can still manually manage with `claude-bus start/stop/status` if needed.

## Detailed Design

### Daemon Process (`claude-bus daemon`)

```typescript
// daemon.ts
import net from 'net';

const state: BusState = {
  workers: new Map(),
  taskQueue: [],
  activeBeads: new Set(),
  blockedPollers: new Map()
};

function startDaemon(socketPath: string) {
  // Clean up stale socket
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const server = net.createServer((conn) => {
    handleConnection(conn, state);
  });

  server.listen(socketPath, () => {
    console.log(`Bus daemon listening at ${socketPath}`);
  });

  // Write PID file for management
  fs.writeFileSync(`${socketPath}.pid`, process.pid.toString());
}

function handleConnection(conn: net.Socket, state: BusState) {
  let buffer = '';

  conn.on('data', (data) => {
    buffer += data.toString();
    // Parse newline-delimited JSON messages
    const lines = buffer.split('\n');
    buffer = lines.pop()!;

    for (const line of lines) {
      const request = JSON.parse(line);
      const response = handleRequest(request, state);
      conn.write(JSON.stringify(response) + '\n');
    }
  });
}

function handleRequest(request: ToolRequest, state: BusState): ToolResponse {
  switch (request.tool) {
    case 'register_worker':
      return registerWorker(request.params, state);
    case 'poll_task':
      return pollTask(request.params, state);
    // ... other tools
  }
}
```

### MCP Client Mode (`cli.ts` when spawned by Claude)

```typescript
// cli.ts - now always runs as client
async function main() {
  const socketPath = getSocketPath();

  const daemon = await connectToDaemon(socketPath);
  if (!daemon) {
    console.error('Bus daemon not running. Start with: claude-bus start');
    process.exit(1);
  }

  // Run MCP server that proxies to daemon
  const server = new Server({
    name: 'claude-bus',
    version: '1.0.0'
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Forward to daemon
    const response = await sendToDaemon(daemon, {
      tool: request.params.name,
      params: request.params.arguments
    });
    return response;
  });

  // Connect to Claude via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

### CLI Commands

```bash
# Start daemon (foreground)
claude-bus daemon

# Start daemon (background, daemonized)
claude-bus start

# Stop daemon
claude-bus stop

# Check status (current project)
claude-bus status

# List all running daemons
claude-bus list

# Stop all daemons
claude-bus stop-all

# The MCP serve command (spawned by Claude) now just connects
claude-bus serve  # → connects to daemon, proxies MCP calls
```

## Review Findings (Code Review + Architecture)

### IPC Protocol Specification

**Protocol:** NDJSON (Newline Delimited JSON) over Unix socket
**Encoding:** UTF-8
**Max message size:** 1MB

**Request format:**
```typescript
{
  "id": "uuid-123",           // Required: correlation ID
  "tool": "register_worker",  // Tool name
  "params": { "name": "z.ai1" }
}
```

**Success response:**
```typescript
{
  "id": "uuid-123",
  "success": true,
  "data": { ... }
}
```

**Error response:**
```typescript
{
  "id": "uuid-123",
  "success": false,
  "error": "UNKNOWN_TOOL",      // Error code
  "message": "No handler for 'foo'"  // Human-readable
}
```

**Error codes:**
| Code | Meaning |
|------|---------|
| `UNKNOWN_TOOL` | Tool name not recognized |
| `INVALID_PARAMS` | Missing or invalid parameters |
| `INTERNAL` | Server-side error (bead CLI failed, etc.) |
| `TIMEOUT` | Operation timed out |

### Graceful Shutdown

On `claude-bus stop` or SIGTERM:

```typescript
process.on('SIGTERM', async () => {
  // 1. Stop accepting new connections
  server.close();

  // 2. Notify all connected clients
  for (const conn of connections) {
    conn.write(JSON.stringify({ type: 'shutdown' }) + '\n');
  }

  // 3. Wait for active requests (max 5s)
  await Promise.race([
    Promise.all(activeRequests),
    sleep(5000)
  ]);

  // 4. Force close remaining connections
  for (const conn of connections) {
    conn.destroy();
  }

  // 5. Cleanup
  fs.unlinkSync(socketPath);
  fs.unlinkSync(`${socketPath}.pid`);

  process.exit(0);
});
```

### Connection Lifecycle Management

**Worker cleanup on disconnect:**
- Track which connection owns which worker
- On connection close, mark worker as `disconnected`
- After 30s without reconnect, remove worker from state
- Return any in-progress task to queue

**Stale socket detection:**
```typescript
function isSocketStale(socketPath: string): boolean {
  const pidFile = `${socketPath}.pid`;
  if (!fs.existsSync(pidFile)) return true;

  const pid = parseInt(fs.readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid, 0);  // Test if process exists
    return false;
  } catch {
    return true;  // Process dead
  }
}
```

### Socket Security

```typescript
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);  // Owner read/write only
});
```

### MCP Client Reconnection

```typescript
async function forwardToolCall(tool: string, args: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await sendToDaemon({ tool, args });
    } catch (e) {
      if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED') {
        await sleep(1000 * (attempt + 1));  // Exponential backoff
        await ensureDaemon();  // Reconnect or auto-start
        continue;
      }
      throw e;
    }
  }
  throw new Error('Daemon unavailable after 3 retries');
}
```

### Task Timeout Handling

Track task assignment time. If worker doesn't complete within timeout:

```typescript
// In daemon, periodic check every 60s
function checkTaskTimeouts(state: BusState) {
  const timeout = 30 * 60 * 1000;  // 30 minutes
  const now = Date.now();

  for (const [name, worker] of state.workers) {
    if (worker.status === 'executing' && worker.task_started_at) {
      if (now - worker.task_started_at > timeout) {
        // Return task to queue
        state.taskQueue.unshift(worker.current_task!);
        worker.status = 'idle';
        worker.current_task = null;
        console.log(`Task timeout: ${worker.current_task} returned to queue`);
      }
    }
  }
}
```

### Daemon Logging

- **Foreground mode:** stdout/stderr
- **Background mode:** `~/.claude-bus/logs/daemon-{hash}.log`
- **Log rotation:** Keep last 5 files, 10MB max each

## Dead Code Analysis

Based on spelunk analysis of the current implementation, migrating to an external daemon pattern makes **~60-70% of current MCP code dead**.

### Files Entirely Removed

| File | Lines | Reason |
|------|-------|--------|
| `selection.ts` | 81 | LRU selection moves to daemon |
| `beads.ts` | ~150 | Bead CLI calls move to daemon |

### Files With Significant Dead Code

| File | Total Lines | Dead Lines | What Stays |
|------|-------------|------------|------------|
| `server.ts` | 1160 | ~950 | `TOOL_SCHEMAS`, `startClientMode()`, `jsonResponse()` |
| `ipc.ts` | 425 | ~200 | `getSocketPath()`, `sendIpcMessage()`, `forwardToolCall()` |
| `cli.ts` | 126 | ~50 | Simplified to client-only |
| `types.ts` | 180 | 0 | All types still needed for IPC |

### Dead Functions (server.ts)

| Function | Lines | Reason |
|----------|-------|--------|
| `createClaudeBusServer()` | ~756 | All tool handlers move to daemon |
| `createIpcHandler()` | ~108 | Daemon handles IPC directly |
| `startServer()` | ~17 | No server mode in MCP process |
| `processQueue()` | ~20 | Daemon-only |
| `assignTaskToWorker()` | ~15 | Daemon-only |

### Dead Functions (ipc.ts)

| Function | Lines | Reason |
|----------|-------|--------|
| `startIpcServer()` | ~87 | Daemon creates server, not MCP |
| `cleanupSocket()` | ~8 | Daemon manages socket |
| `isSocketStale()` | ~24 | Daemon manages socket |
| `notifyWorkerDone()` | ~6 | CLI commands removed |
| `notifyTaskFailed()` | ~10 | CLI commands removed |
| `isBusRunning()` | ~8 | Replaced by daemon check |

### Dead CLI Commands

| Command | Reason |
|---------|--------|
| `notify-done` | Workers call daemon directly |
| `notify-failed` | Workers call daemon directly |
| `status` | Replaced by `claude-bus status` (daemon query) |

### What Stays in MCP Process

```
plugin/lib/claude-bus/
├── cli.ts          (~40 lines) - Just startClientMode() call
├── client.ts       (~100 lines) - NEW: daemon connection
├── types.ts        (180 lines) - Keep all types
└── schemas.ts      (~50 lines) - Extract TOOL_SCHEMAS here
```

**Total: ~370 lines** (down from ~2100 lines)

### What Moves to Daemon

```
daemon/
├── daemon.ts       - Main daemon process
├── server.ts       - Tool implementations (from current server.ts)
├── selection.ts    - LRU worker selection
├── beads.ts        - Bead CLI wrapper
├── ipc.ts          - IPC server (from current ipc.ts)
└── state.ts        - State management
```

**Total: ~1200 lines** (extracted from current code)

## Files to Change

| File | Change |
|------|--------|
| `plugin/lib/claude-bus/daemon.ts` | NEW - standalone daemon process |
| `plugin/lib/claude-bus/cli.ts` | Simplify - remove server mode, add daemon commands |
| `plugin/lib/claude-bus/client.ts` | NEW - IPC client for connecting to daemon |
| `plugin/lib/claude-bus/server.ts` | DELETE most - keep only `startClientMode()` |
| `plugin/lib/claude-bus/selection.ts` | MOVE to daemon |
| `plugin/lib/claude-bus/beads.ts` | MOVE to daemon |
| `plugin/lib/claude-bus/ipc.ts` | SPLIT - client stays, server moves to daemon |

## Migration Path

**Decision: Full commitment to external daemon. No hybrid/fallback mode.**

1. Create daemon process with extracted server logic
2. Gut MCP process to client-only (~370 lines)
3. Delete all server-mode code from MCP
4. Update workflow: `claude-bus start` required before Claude instances
5. If daemon not running, MCP returns clear error (no silent fallback)

## Alternative Considered: SQLite Shared State

If daemon management feels like too much overhead, SQLite provides a simpler path:

```typescript
// All MCP servers read/write same DB file
const db = new Database('.claude-bus/state.db');

function registerWorker(name: string) {
  db.exec(`INSERT OR REPLACE INTO workers (name, status, registered_at)
           VALUES (?, 'idle', datetime('now'))`, [name]);
}

function pollTask(name: string): Task | null {
  // Atomic claim with transaction
  return db.transaction(() => {
    const task = db.get(`SELECT * FROM queue ORDER BY created_at LIMIT 1`);
    if (task) {
      db.exec(`DELETE FROM queue WHERE id = ?`, [task.id]);
      db.exec(`UPDATE workers SET status = 'executing', current_task = ? WHERE name = ?`,
              [task.bead_id, name]);
    }
    return task;
  })();
}
```

**Pros:** No daemon, atomic operations via SQLite
**Cons:** Need polling loop for workers (no push), SQLite WAL mode required

## Acceptance Criteria

### Core Functionality
- [ ] `claude-bus start` spawns daemon process
- [ ] `claude-bus stop` cleanly shuts down daemon (SIGTERM handling)
- [ ] `claude-bus status` shows daemon PID and socket path
- [ ] `claude-bus list` shows all running daemons
- [ ] MCP server (`serve`) auto-starts daemon if not running
- [ ] MCP server connects to daemon via IPC
- [ ] All Claude instances share same worker/queue state
- [ ] `get_status()` from any instance returns complete state
- [ ] Workers can register/poll through any Claude instance
- [ ] Daemon survives Claude Code restarts

### Protocol & Security
- [ ] Request ID correlation in IPC protocol
- [ ] Socket created with mode 0600
- [ ] Stale socket cleanup on daemon start
- [ ] PID file written and validated

### Reliability
- [ ] MCP client reconnects on daemon restart (3 retries with backoff)
- [ ] Worker cleanup on connection disconnect (30s grace period)
- [ ] Task timeout handling (30 min default)
- [ ] Graceful shutdown notifies connected clients

### Test Scenarios

**Test: Multi-instance state sharing**
```
1. Start daemon
2. Start MCP instance A, register worker "w1"
3. Start MCP instance B, call get_status()
4. Assert worker "w1" visible from instance B
```

**Test: Daemon persistence**
```
1. Start daemon, note PID
2. Start MCP, register worker
3. Kill MCP process
4. Verify daemon still running (same PID)
5. Start new MCP, verify worker still registered
```

**Test: Auto-start daemon**
```
1. Ensure no daemon running
2. Start MCP serve (should auto-start daemon)
3. Verify daemon running
4. Call get_status(), verify success
```

**Test: Graceful shutdown**
```
1. Start daemon
2. Connect MCP client
3. Send SIGTERM to daemon
4. Verify client receives shutdown message
5. Verify socket and PID file cleaned up
```

## Risks

| Risk | Mitigation |
|------|------------|
| Users forget to start daemon | Auto-start daemon on first MCP connection |
| Daemon crashes | MCP client reconnects with backoff; workers re-register; tasks in beads survive |
| Socket file left behind | PID file validation + stale socket cleanup |
| Multiple daemons race | Advisory file lock on socket |
| Worker hangs mid-task | Task timeout (30 min) returns task to queue |
| Connection drops silently | Worker cleanup after 30s grace period |
| Unauthorized socket access | Socket created with mode 0600 |
| Long-running daemon memory | Monitor memory; periodic restart if needed |

---

## Sources

- [Enterprise Integration Patterns - Message Bus](https://www.enterpriseintegrationpatterns.com/patterns/messaging/MessageBus.html)
- [Microsoft Multi-Agent Reference Architecture](https://microsoft.github.io/multi-agent-reference-architecture/docs/agents-communication/Message-Driven.html)
- [Claude-Flow (Swarm Coordination)](https://github.com/ruvnet/claude-flow)
- [Node.js Unix Domain Sockets](https://nodejs.org/api/net.html)
- [node-ipc](https://github.com/node-ipc/node-ipc)
- [NATS Messaging](https://nats.io/)
- [Multi-Agent Coordination Patterns](https://medium.com/@ohusiev_6834/multi-agent-coordination-patterns-architectures-beyond-the-hype-3f61847e4f86)

---

*Design Status: APPROVED - Reviews incorporated. Ready for decompose.*

**Review Summary:**
- Code Review: APPROVED with recommendations (all incorporated)
- Architecture Review: APPROVED with recommendations (all incorporated)
- Key changes: Auto-start daemon as default, IPC protocol spec, graceful shutdown, connection lifecycle, socket security
