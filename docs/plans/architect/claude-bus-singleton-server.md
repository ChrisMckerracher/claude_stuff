# Claude Bus: Singleton Server Per Codebase

## Overview

Fix two issues with claude-bus:
1. Each Claude Code instance spawns its own MCP server with isolated state - workers can't see each other
2. Pane-name-based auto-registration still exists and should be removed

## Problem Statement

### Issue 1: Multiple Isolated MCP Servers

Currently, `.mcp.json` launches a new MCP server process per Claude Code instance:

```json
{
  "mcpServers": {
    "claude-bus": {
      "command": "node",
      "args": [".../cli.js", "serve"]
    }
  }
}
```

Result:
```
Claude (pane 4) ─── spawns ──► MCP Server A (state: {z.ai2})
Claude (pane 5) ─── spawns ──► MCP Server B (state: {z.ai1})
Claude (orch)   ─── spawns ──► MCP Server C (state: {})
```

Each server has isolated in-memory state. Workers registering with Server B don't appear in Server A's `get_status`.

### Issue 2: Pane-Name Auto-Registration Not Removed

Previous design docs stated we'd remove tmux pane-based worker registration, but:
- `worker-init.sh` still detects pane titles matching `z\.ai[0-9]*`
- `tmux-claude.conf` still sets pane titles to `z.ai2`, `z.ai1`

This creates ghost registrations and confusion.

## Solution

### Part 1: Singleton MCP Server

**Strategy:** First Claude instance for a codebase becomes the server. Subsequent instances connect as clients.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Startup Flow                                   │
│                                                                         │
│  Claude starts → Check if /tmp/claude-bus-{hash}.sock exists            │
│                           │                                             │
│              ┌────────────┴────────────┐                                │
│              │                         │                                │
│         Socket exists?            No socket?                            │
│              │                         │                                │
│              ▼                         ▼                                │
│     Connect as CLIENT          Become SERVER                            │
│     (forward MCP calls         (create socket,                          │
│      via IPC)                   handle requests)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Implementation:**

1. On MCP server startup in `cli.ts`:
   - Compute socket path: `/tmp/claude-bus-{md5(cwd)[0:8]}.sock`
   - Try to connect to existing socket
   - If connect succeeds → run as IPC client (proxy MCP calls to real server)
   - If connect fails (ENOENT/ECONNREFUSED) → become the server

2. Server mode:
   - Create Unix socket, listen for IPC connections
   - Handle MCP tool calls directly (current behavior)
   - Maintain single source of truth for state

3. Client mode:
   - Forward all MCP tool calls to server via IPC socket
   - Return server's response to Claude Code

**Code location:** `plugin/lib/claude-bus/cli.ts` and `ipc.ts`

### Part 2: Remove Pane-Name Auto-Registration

**Delete:**

| File | Action |
|------|--------|
| `plugin/hooks/worker-init.sh` | DELETE |
| `plugin/hooks/hooks.json` | Remove `worker-init` hook |

**Tmux config stays** - it's for pane layout, not worker discovery.

Workers name themselves. No auto-discovery. No pane scanning.

## Detailed Design

### Startup Sequence (cli.ts)

```typescript
async function main() {
  const socketPath = getSocketPath();

  // Try to connect to existing server
  const existingServer = await tryConnect(socketPath);

  if (existingServer) {
    // Run as client - proxy all MCP calls
    runAsClient(existingServer);
  } else {
    // Become the server
    await startServer(socketPath);
  }
}

async function tryConnect(socketPath: string): Promise<Socket | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    socket.on('connect', () => resolve(socket));
    socket.on('error', () => resolve(null));
  });
}
```

### Client Mode

When running as client, forward all tool calls via IPC:

```typescript
function runAsClient(serverSocket: Socket) {
  // MCP stdio transport talks to us
  // We forward to server socket and return response

  const mcpServer = new Server({
    name: 'claude-bus-client',
    version: '1.0.0'
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Forward to real server
    const response = await forwardToServer(serverSocket, request);
    return response;
  });
}
```

### Server Takeover on Crash

If the server process dies, the socket becomes stale:

1. Clients detect `ECONNRESET` on next call
2. Client attempts to become new server (race with other clients)
3. Winner creates socket, others connect to new server

**Race handling:** Use `SO_REUSEADDR` and atomic socket creation. First to successfully bind wins.

### State Persistence

None. Clean restart on crash is acceptable. Workers re-register when they poll.

## Files to Change

| File | Change |
|------|--------|
| `plugin/lib/claude-bus/cli.ts` | Add singleton detection, client mode |
| `plugin/lib/claude-bus/ipc.ts` | Add client-mode IPC forwarding |
| `plugin/lib/claude-bus/server.ts` | No changes needed |
| `plugin/hooks/worker-init.sh` | DELETE |
| `plugin/hooks/hooks.json` | Remove worker-init hook |

**Note:** `configs/tmux/tmux-claude.conf` can stay for pane layout - just ensure no claude-bus code references tmux for worker discovery/dispatch.

## Worker Initialization (New Flow)

Workers name themselves. Not our problem to solve.

```
Worker calls: register_worker("my-chosen-name")
Worker calls: poll_task("my-chosen-name")
```

No special mechanism needed. Workers decide their own names.

## Migration

1. Deploy new cli.ts with singleton detection
2. Delete worker-init.sh hook
3. Restart all Claude instances
4. Workers self-register with their chosen names

## Acceptance Criteria

- [x] First Claude instance for a codebase becomes the MCP server
- [x] Subsequent instances connect as clients via IPC
- [x] All instances share the same worker state
- [x] `get_status()` from any instance shows all registered workers
- [x] `worker-init.sh` hook deleted
- [x] No pane-title-based auto-registration
- [x] Workers only appear after explicit `register_worker()` call
- [x] Existing tests pass
- [x] New test: multiple clients share state through singleton server

## Risks

| Risk | Mitigation |
|------|------------|
| Server crash loses all state | Acceptable - workers re-register on next poll |
| Race condition on server takeover | Use atomic socket creation |
| IPC adds latency | Negligible - local Unix socket |
| Debugging harder with proxy | Add logging to client mode |

## Estimated Scope

- cli.ts changes: ~80 lines
- ipc.ts client mode: ~60 lines
- Hook deletion: -50 lines
- Config cleanup: -10 lines

**Net: +80 lines** (simpler than expected since IPC infrastructure exists)

---

*Design Status: REVIEWED - Ready for implementation*
