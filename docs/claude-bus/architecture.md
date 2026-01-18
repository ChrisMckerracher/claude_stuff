# Claude-Bus Architecture

## Problem Statement

Claude Code spawns MCP servers **per-process**. Each Claude instance gets its own isolated MCP server with independent state:

```
Claude (orchestrator)  ─spawns─> MCP Server A (isolated state)
Claude (z.ai1)         ─spawns─> MCP Server B (isolated state)
Claude (z.ai2)         ─spawns─> MCP Server C (isolated state)
```

Workers can't see each other. The orchestrator can't dispatch to workers. No shared coordination.

## Solution: External Daemon Pattern

Claude-bus uses an **external daemon** that runs independently of Claude Code. MCP servers become thin clients that connect to the shared daemon.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Daemon (started before Claude Code)                       │
│                                                                              │
│  Terminal: claude-bus daemon start                                           │
│            └─> Creates /tmp/claude-bus-{cwd-hash}.sock                       │
│            └─> Listens for IPC connections                                   │
│            └─> Maintains worker/queue state                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                    Claude Code (MCP Server = Thin Client)                    │
│                                                                              │
│  MCP Server spawned by Claude Code:                                          │
│    └─> Connects to /tmp/claude-bus-{cwd-hash}.sock                           │
│    └─> Forwards all tool calls to daemon via IPC                             │
│    └─> Returns daemon responses to Claude                                    │
│                                                                              │
│  If daemon not running:                                                      │
│    └─> Auto-starts daemon in background                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Why External Daemon?

Three patterns were evaluated:

| Pattern | Pros | Cons | Verdict |
|---------|------|------|---------|
| **External Daemon** | True singleton, survives restarts | Requires daemon process | **Selected** |
| **SQLite Shared State** | No daemon, survives crashes | Polling only, write contention | Too slow |
| **Message Broker (NATS)** | Battle-tested coordination | External dependency, overkill | Too heavy |

The external daemon pattern:
- Keeps existing MCP tool interface unchanged
- Simple Unix socket IPC
- Matches user mental model ("bus" is a separate thing)

---

## IPC Protocol

**Transport:** Unix domain socket
**Protocol:** NDJSON (Newline Delimited JSON)
**Encoding:** UTF-8
**Max message size:** 1MB

### Request Format

```json
{
  "id": "uuid-123",
  "tool": "register_worker",
  "params": { "name": "z.ai1" }
}
```

### Success Response

```json
{
  "id": "uuid-123",
  "success": true,
  "data": { "worker": "z.ai1", "message": "Registered" }
}
```

### Error Response

```json
{
  "id": "uuid-123",
  "success": false,
  "error": "UNKNOWN_TOOL",
  "message": "No handler for 'foo'"
}
```

### Error Codes

| Code | Meaning |
|------|---------|
| `UNKNOWN_TOOL` | Tool name not recognized |
| `INVALID_PARAMS` | Missing or invalid parameters |
| `INTERNAL` | Server-side error |
| `TIMEOUT` | Operation timed out |

---

## Daemon State

```typescript
interface BusState {
  workers: Map<string, Worker>;        // Registered workers
  taskQueue: string[];                  // Pending bead IDs
  activeBeads: Set<string>;            // Currently executing
  blockedPollers: Map<string, Poller>; // Workers waiting for tasks
  pendingTasks: Map<string, Task>;     // Assigned but not acked
}

interface Worker {
  name: string;
  status: 'idle' | 'polling' | 'pending' | 'executing';
  registered_at: number;
  last_activity: number;
  current_task: string | null;
  task_started_at: number | null;
}
```

---

## Socket Management

### Socket Path

```typescript
const root = projectRoot || process.cwd();
const hash = crypto.createHash('md5').update(root).digest('hex').slice(0, 8);
return `/tmp/claude-bus-${hash}.sock`;
```

### Socket Security

```typescript
server.listen(socketPath, () => {
  fs.chmodSync(socketPath, 0o600);  // Owner read/write only
});
```

### Stale Socket Detection

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

---

## Graceful Shutdown

On `claude-bus stop` or SIGTERM:

1. Stop accepting new connections
2. Notify all connected clients with `{ type: 'shutdown' }`
3. Wait for active requests (max 5s)
4. Force close remaining connections
5. Clean up socket and PID file

---

## Connection Lifecycle

### Worker Cleanup on Disconnect

- Track which connection owns which worker
- On connection close, mark worker as `disconnected`
- After 30s without reconnect, remove worker from state
- Return any in-progress task to queue

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

---

## Task Timeout Handling

Daemon periodically checks for stuck tasks:

```typescript
function checkTaskTimeouts(state: BusState) {
  const timeout = 30 * 60 * 1000;  // 30 minutes
  const now = Date.now();

  for (const [name, worker] of state.workers) {
    if (worker.status === 'executing' && worker.task_started_at) {
      if (now - worker.task_started_at > timeout) {
        state.taskQueue.unshift(worker.current_task!);
        worker.status = 'idle';
        worker.current_task = null;
      }
    }
  }
}
```

---

## CLI Commands

```bash
claude-bus daemon     # Start daemon (foreground)
claude-bus start      # Start daemon (background)
claude-bus stop       # Stop daemon
claude-bus status     # Check status
claude-bus list       # List all running daemons
claude-bus stop-all   # Stop all daemons
claude-bus serve      # MCP mode (connects to daemon)
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Users forget to start daemon | Auto-start on first MCP connection |
| Daemon crashes | MCP client reconnects; workers re-register; tasks survive in beads |
| Socket file left behind | PID file validation + stale socket cleanup |
| Multiple daemons race | Advisory file lock on socket |
| Worker hangs mid-task | Task timeout (30 min) returns task to queue |
| Connection drops silently | Worker cleanup after 30s grace period |
| Unauthorized socket access | Socket created with mode 0600 |
