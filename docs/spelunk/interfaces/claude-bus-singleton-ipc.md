# Claude Bus Singleton IPC Implementation

**Spelunk Report for Architecture Agent**
**Focus:** Client mode vs server mode detection, IPC socket creation/connection, client-mode forwarding
**Generated:** 2026-01-18

---

## Executive Summary

The claude-bus module implements a singleton MCP server pattern using Unix domain sockets for IPC. When multiple Claude Code instances start for the same codebase, only the first becomes the "server" (owns state), while subsequent instances become "clients" that proxy MCP tool calls through IPC to the real server.

**Key finding for external daemon migration:** If we move to an always-external daemon pattern (MCP always runs as client), approximately **60-70%** of the current code becomes dead code, including the entire server startup logic, IPC server creation, and dual-mode detection.

---

## Architecture Overview

```
Current Pattern:

  Claude Code Instance 1           Claude Code Instance 2
         |                                  |
         v                                  v
  +--------------+                  +--------------+
  | MCP Process  |                  | MCP Process  |
  | (SERVER)     |<-- IPC Socket -->| (CLIENT)     |
  +--------------+                  +--------------+
         |
         v
  Unix Socket: /tmp/claude-bus-{hash}.sock
         |
         v
  Server State (workers, queues, beads)
```

---

## File Inventory

| File | Lines | Purpose | Dead Code if Always-Client? |
|------|-------|---------|----------------------------|
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/cli.ts` | 126 | Entry point, singleton detection | Partial - mode detection stays |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/ipc.ts` | 425 | Socket path, IPC server/client | ~200 lines server code dead |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts` | 1160 | MCP server, tool handlers, state | ~900 lines dead (all server logic) |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/types.ts` | 180 | Type definitions | Keep all (client needs types) |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/selection.ts` | 81 | LRU worker selection | DEAD (server-only) |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/beads.ts` | ~150 | Bead CLI wrapper | DEAD (server-only) |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/index.ts` | 56 | Re-exports | Simplify exports |

---

## Detailed Code Analysis

### 1. Client Mode vs Server Mode Detection

**File:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/cli.ts`

**Detection Logic (lines 25-56):**
```typescript
async function main(): Promise<void> {
  switch (command) {
    case 'serve':
    case undefined: {
      // Singleton detection: check if a server already exists for this codebase
      const existingServer = await tryConnectToServer();

      if (existingServer) {
        // Server already running - run as client, proxying MCP calls via IPC
        existingServer.destroy(); // Close test connection
        console.error('[claude-bus] Server already running, starting as client');
        await startClientMode();
      } else {
        // No server running - try to become the server
        try {
          console.error('[claude-bus] Starting as server');
          await startServer();
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code === EADDRINUSE) {
            // Another process won the race - fall back to client mode
            console.error('[claude-bus] Server race lost, starting as client');
            await startClientMode();
          } else {
            throw err;
          }
        }
      }
      break;
    }
    // ... CLI commands
  }
}
```

**Key Functions:**
| Function | File | Line | Purpose |
|----------|------|------|---------|
| `tryConnectToServer()` | ipc.ts | 357-396 | Test if server exists |
| `startServer()` | server.ts | 1102-1119 | Become server mode |
| `startClientMode()` | server.ts | 1127-1159 | Run as forwarding client |
| `EADDRINUSE` | server.ts | 1089 | Error code for race detection |

**If always-client:** The entire `if/else` block in `main()` simplifies to just `await startClientMode()`. Lines 30-54 become dead code.

---

### 2. IPC Socket Creation/Connection

**File:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/ipc.ts`

**Socket Path Generation (lines 58-62):**
```typescript
export function getSocketPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  const hash = crypto.createHash('md5').update(root).digest('hex').slice(0, 8);
  return `/tmp/claude-bus-${hash}.sock`;
}
```

**IPC Server Creation (lines 127-214) - DEAD CODE IF ALWAYS-CLIENT:**
```typescript
export async function startIpcServer(
  handler: IpcHandler,
  projectRoot?: string
): Promise<{ server: net.Server; socketPath: string }> {
  const socketPath = getSocketPath(projectRoot);
  const stale = await isSocketStale(socketPath);
  if (stale) {
    cleanupSocket(socketPath);
  }

  const server = net.createServer((connection) => {
    // Handle incoming IPC connections
    // Parse JSON-RPC messages
    // Call handler and return response
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(socketPath, resolve);
  });

  return { server, socketPath };
}
```

**IPC Client Functions (lines 227-295, 357-424) - KEEP:**
```typescript
// Send message to server
export function sendIpcMessage(
  request: IpcRequest,
  projectRoot?: string,
  timeout: number = 5000
): Promise<IpcResponse>

// Check if server exists
export async function tryConnectToServer(
  projectRoot?: string,
  timeout: number = 1000
): Promise<net.Socket | null>

// Forward MCP tool call to server
export async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot?: string
): Promise<unknown>
```

**Dead Code Analysis for ipc.ts:**
| Lines | Function | Dead if Always-Client? |
|-------|----------|----------------------|
| 58-62 | `getSocketPath` | KEEP (client needs it) |
| 69-77 | `cleanupSocket` | DEAD |
| 86-110 | `isSocketStale` | DEAD |
| 127-214 | `startIpcServer` | DEAD |
| 227-295 | `sendIpcMessage` | KEEP |
| 306-330 | `notifyWorkerDone`, `notifyTaskFailed` | DEAD (CLI commands, not MCP) |
| 338-345 | `isBusRunning` | DEAD (CLI command) |
| 357-396 | `tryConnectToServer` | KEEP (but simplify) |
| 408-424 | `forwardToolCall` | KEEP |

---

### 3. tryConnect/connectToDaemon Functions

**File:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/ipc.ts`

**`tryConnectToServer` (lines 357-396):**
```typescript
export async function tryConnectToServer(
  projectRoot?: string,
  timeout: number = 1000
): Promise<net.Socket | null> {
  const socketPath = getSocketPath(projectRoot);

  // Check if socket exists
  if (!fs.existsSync(socketPath)) {
    return null;
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(null);
      }
    }, timeout);

    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(socket);  // Return connected socket
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(null);  // No server
      }
    });
  });
}
```

**If always-client (external daemon):** This function transforms into a hard requirement check rather than optional detection:
- Remove the `return null` fallback
- Change to `connectToDaemon()` that throws if daemon not running
- External daemon startup becomes a system concern, not MCP startup concern

---

### 4. Client-Mode Forwarding

**File:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts`

**`startClientMode` (lines 1127-1159) - BECOMES THE ONLY MODE:**
```typescript
export async function startClientMode(): Promise<void> {
  const server = new McpServer({
    name: 'claude-bus-client',
    version: '0.1.0',
  });

  // Define tools with same schemas as server mode, forwarding via IPC
  const toolNames = Object.keys(TOOL_SCHEMAS) as Array<keyof typeof TOOL_SCHEMAS>;

  for (const toolName of toolNames) {
    const toolDef = TOOL_SCHEMAS[toolName];
    // Register tool with schema so Claude knows the parameters
    (server.tool as Function)(
      toolName,
      toolDef.description,
      toolDef.schema,
      async (args: Record<string, unknown>) => {
        try {
          const result = await forwardToolCall(toolName, args);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({
            error: `Failed to forward to server: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    );
  }

  // Start MCP server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

**`TOOL_SCHEMAS` (lines 92-138) - KEEP:**
```typescript
export const TOOL_SCHEMAS = {
  submit_task: {
    description: 'Submit a bead task to be dispatched to an available worker',
    schema: { bead_id: z.string().describe('The bead ID to submit for execution') },
  },
  worker_done: { ... },
  get_status: { ... },
  reset_worker: { ... },
  retry_task: { ... },
  task_failed: { ... },
  register_worker: { ... },
  poll_task: { ... },
  ack_task: { ... },
} as const;
```

**`forwardToolCall` in ipc.ts (lines 408-424) - KEEP:**
```typescript
export async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot?: string
): Promise<unknown> {
  const response = await sendIpcMessage(
    { type: 'forward_tool', tool_name: toolName, tool_args: args },
    projectRoot,
    60000 // 60s timeout for tool calls (some like poll_task block)
  );

  if (!response.success) {
    throw new Error(response.error || 'Tool forwarding failed');
  }

  return response.data;
}
```

---

## Dead Code Summary (If Always-Client Pattern)

### Files That Become Entirely Dead

| File | Lines | Reason |
|------|-------|--------|
| `selection.ts` | 81 | LRU selection is server-only |
| `beads.ts` | ~150 | Bead CLI calls are server-only |

### Files With Significant Dead Code

| File | Total Lines | Dead Lines | Keep |
|------|-------------|------------|------|
| `server.ts` | 1160 | ~950 | `TOOL_SCHEMAS`, `startClientMode`, `jsonResponse` |
| `ipc.ts` | 425 | ~200 | `getSocketPath`, `sendIpcMessage`, `tryConnectToServer`, `forwardToolCall` |
| `cli.ts` | 126 | ~50 | Startup, but simplified |
| `types.ts` | 180 | 0 | All types needed for IPC protocol |

### Functions That Become Dead

**server.ts:**
- `createClaudeBusServer()` - lines 210-966 (~756 lines)
- `createIpcHandler()` - lines 976-1084 (~108 lines)
- `startServer()` - lines 1102-1119 (~17 lines)
- `processQueue()` - lines 173-192
- `assignTaskToWorker()` - lines 149-164
- All tool handler implementations (submit_task, worker_done, etc.)

**ipc.ts:**
- `startIpcServer()` - lines 127-214 (~87 lines)
- `cleanupSocket()` - lines 69-77
- `isSocketStale()` - lines 86-110
- `notifyWorkerDone()` - lines 306-311
- `notifyTaskFailed()` - lines 321-330
- `isBusRunning()` - lines 338-345

**cli.ts:**
- `notify-done` command handler
- `notify-failed` command handler
- `status` command handler
- Server startup logic

---

## External Daemon Architecture (Alternative)

If migrating to external daemon pattern:

```
New Pattern:

  External Daemon (always running)
         |
  Unix Socket: /tmp/claude-bus-{hash}.sock
         ^
         |
  +------+------+------+
  |      |      |      |
  v      v      v      v
MCP    MCP    MCP    MCP
Client Client Client Client
```

### What To Keep

1. **`TOOL_SCHEMAS`** - Tool definitions for MCP registration
2. **`startClientMode()`** - Becomes the only mode
3. **`forwardToolCall()`** - Core forwarding logic
4. **`sendIpcMessage()`** - Low-level IPC send
5. **`getSocketPath()`** - Socket path computation
6. **All types** - IPC protocol types remain needed

### What To Remove

1. All server-side tool implementations
2. IPC server creation (`startIpcServer`)
3. State management (`State`, `createState`)
4. Worker selection (`selectWorker`, `isWorkerAvailable`)
5. Bead CLI integration (`validateBead`, `beadSetInProgress`, etc.)
6. Singleton detection logic (always client)
7. CLI commands (`notify-done`, `notify-failed`, `status`)

### New Requirements for External Daemon

1. Daemon startup script (systemd/launchd)
2. Daemon health checking
3. Daemon restart on crash
4. Multi-codebase daemon management (one per project?)
5. Daemon logs location

---

## Architecture Decision

**DECIDED: Full external daemon pattern. No hybrid/fallback.**

Implementation plan:
- Create new `daemon.ts` that extracts server logic
- Simplify `cli.ts` to only client mode
- Remove ~1200 lines from MCP process
- Add daemon management tooling (`start`, `stop`, `status`)
- MCP errors clearly if daemon not running

See: `docs/plans/architect/claude-bus-external-daemon.md`

---

## Hash Tracking

```
Files analyzed:
- plugin/lib/claude-bus/cli.ts: md5=<computed>
- plugin/lib/claude-bus/ipc.ts: md5=<computed>
- plugin/lib/claude-bus/server.ts: md5=<computed>
- plugin/lib/claude-bus/types.ts: md5=<computed>
- plugin/lib/claude-bus/selection.ts: md5=<computed>
- plugin/lib/claude-bus/index.ts: md5=<computed>
```

---

*End of Spelunk Report*
