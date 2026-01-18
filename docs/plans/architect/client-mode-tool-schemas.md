# Client Mode Tool Schemas

## Problem

Client-mode MCP tools in `startClientMode()` are registered without parameter schemas. The MCP SDK falls back to `{ properties: {} }`, causing Claude to omit required parameters like `name` for `register_worker`.

**Impact:** Workers connecting via client mode cannot register - Claude doesn't know to send the `name` parameter.

## Root Cause

```typescript
// server.ts lines 1093-1108 (client mode - BROKEN)
for (const toolName of tools) {
  (server.tool as Function)(
    toolName,
    `Forward ${toolName} to bus server`,
    async (args) => { ... }  // No schema!
  );
}

// server.ts lines 484-487 (server mode - CORRECT)
(server.tool as Function)(
  'register_worker',
  'Register a worker with the bus...',
  { name: z.string().min(1).describe('The worker name') },
  async ({ name }) => { ... }
);
```

## Solution

Extract tool schemas to a shared constant and use in both server and client modes.

### Design

```typescript
// New: shared schema definitions
const TOOL_SCHEMAS = {
  submit_task: {
    description: 'Submit a bead task to be dispatched to an available worker',
    schema: { bead_id: z.string().describe('The bead ID to submit') },
  },
  worker_done: {
    description: 'Signal that a worker has completed its task',
    schema: { bead_id: z.string().describe('The bead ID completed') },
  },
  get_status: {
    description: 'Get current status of all workers and task queue',
    schema: {},  // No params
  },
  reset_worker: {
    description: 'Force a stuck worker back to idle',
    schema: { worker_name: z.string().describe('The worker to reset') },
  },
  retry_task: {
    description: 'Re-queue an in_progress task',
    schema: { bead_id: z.string().describe('The bead ID to retry') },
  },
  task_failed: {
    description: 'Mark task blocked, free worker',
    schema: {
      bead_id: z.string().describe('The bead ID that failed'),
      reason: z.string().describe('Reason for failure'),
    },
  },
  register_worker: {
    description: 'Register a worker with the bus (for polling-based dispatch)',
    schema: { name: z.string().min(1).describe('The worker name (e.g., z.ai1)') },
  },
  poll_task: {
    description: 'Long-poll for a task assignment',
    schema: {
      name: z.string().min(1).describe('The worker name'),
      timeout_ms: z.number().optional().describe('Timeout in ms (default: 30000)'),
    },
  },
  ack_task: {
    description: 'Acknowledge receipt of a task before execution',
    schema: {
      name: z.string().min(1).describe('The worker name'),
      bead_id: z.string().describe('The bead ID being acknowledged'),
    },
  },
} as const;
```

### Client Mode Fix

```typescript
// startClientMode() - FIXED
for (const toolName of tools) {
  const toolDef = TOOL_SCHEMAS[toolName as keyof typeof TOOL_SCHEMAS];
  (server.tool as Function)(
    toolName,
    toolDef.description,
    toolDef.schema,
    async (args: Record<string, unknown>) => {
      const result = await forwardToolCall(toolName, args);
      return jsonResponse(result);
    }
  );
}
```

### Server Mode Refactor (Optional)

Server mode can also use `TOOL_SCHEMAS` to avoid duplication, but the handlers remain inline since they contain the actual logic.

## Files to Change

| File | Change |
|------|--------|
| `plugin/lib/claude-bus/server.ts` | Add `TOOL_SCHEMAS` constant, update `startClientMode()` |

## Acceptance Criteria

- [ ] Client mode tools expose same schemas as server mode
- [ ] `register_worker` works from client-mode instances
- [ ] All existing tests pass
- [ ] New test: client mode tool schemas match server mode

## Scope

~40 lines added (schema constant + client mode loop update)

---

*Design Status: APPROVED - Task claude_stuff-8qx created*
