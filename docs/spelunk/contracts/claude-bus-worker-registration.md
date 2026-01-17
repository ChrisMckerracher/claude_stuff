# Claude Bus Worker Registration Flow

**Spelunk focus:** Worker registration and poll_task flow - investigating why workers calling poll_task are not appearing in get_status

**Generated:** 2025-01-17
**Source files:** `plugin/lib/claude-bus/server.ts`, `types.ts`, `selection.ts`, `ipc.ts`

## Architecture Overview

The claude-bus uses a polling-based dispatch model:

```
                       MCP Server (in-memory State)
                       +--------------------------+
                       | workers: Map<name, Worker>
                       | taskQueue: string[]
                       | pendingTasks: Map<name, PendingTask>
                       | blockedPollers: Map<name, BlockedPoller>
                       +--------------------------+
                                  |
            +---------------------+---------------------+
            |                     |                     |
    register_worker()       poll_task()          submit_task()
            |                     |                     |
         Worker              Long-poll              Assigns to
         added to            blocks until            LRU worker
         state.workers       task arrives
```

## Key Finding: Registration is REQUIRED Before Polling

The `poll_task` handler checks if the worker exists in `state.workers`:

```typescript
// server.ts lines 486-493
const worker = state.workers.get(name);

if (!worker) {
  const response: PollTaskResponse = {
    error: `Unknown worker: ${name} - call register_worker first`,
  };
  return jsonResponse(response);
}
```

**If workers are calling `poll_task` without first calling `register_worker`, they receive an error response and are NOT added to `state.workers`.**

## The Root Cause

Workers `z.ai1` and `opus-worker-1` are polling but not appearing in `get_status` because:

1. **They never called `register_worker(name)` first**
2. Their `poll_task` calls are returning errors: `"Unknown worker: z.ai1 - call register_worker first"`
3. Since they're not in `state.workers`, they don't appear in `get_status`

The `get_status` response builds from `state.workers.values()`:

```typescript
// server.ts lines 243-256
const workers = Array.from(state.workers.values()).map((w) => {
  return {
    name: w.name,
    status: w.status,
    // ...
  };
});
```

## Why z.ai2 Appears

`z.ai2` must have correctly called `register_worker("z.ai2")` before polling, which adds it to the workers map:

```typescript
// server.ts lines 455-465
const worker: Worker = {
  name,
  status: 'idle',
  registered_at: now,
  last_activity: now,
  current_task: null,
  task_started_at: null,
};
state.workers.set(name, worker);
```

## Worker Lifecycle (Correct Flow)

```
1. Worker startup: register_worker("z.ai1")
   -> Worker added to state.workers with status: 'idle'

2. Worker polling: poll_task("z.ai1", 30000)
   -> Worker status changes to 'polling'
   -> Worker added to blockedPollers map (blocked Promise)
   -> Long-poll blocks until task or timeout

3. Task arrives: submit_task("bead-123")
   -> selectWorker() finds LRU available worker
   -> assignTaskToWorker() sets status: 'pending'
   -> Resolves blocked poll with task

4. Worker acks: ack_task("z.ai1", "bead-123")
   -> Worker status: 'executing'
   -> Task removed from pendingTasks
```

## MCP Server Isolation

Each MCP server instance has **independent in-memory state**. The socket path is per-project:

```typescript
// ipc.ts line 56-59
const root = projectRoot || process.cwd();
const hash = crypto.createHash('md5').update(root).digest('hex').slice(0, 8);
return `/tmp/claude-bus-${hash}.sock`;
```

**Important:** If workers are connecting to a different MCP server instance (different project/cwd), their registration won't be visible from another instance's `get_status`.

## Diagnostic Checklist

1. **Are workers calling register_worker first?**
   - Check if poll_task returns error about unknown worker

2. **Are all Claude instances using the same MCP server?**
   - MCP servers are per-project (based on cwd hash)
   - Orchestrator and workers must share the same project root

3. **Is the MCP server restarting?**
   - State is in-memory only
   - Server restart loses all worker registrations
   - Workers must re-register after restart

## Fix

Workers must follow this sequence:

```
1. register_worker("z.ai1")   <- MUST do this first
2. poll_task("z.ai1", 30000)  <- Now this will work
```

The worker protocol documentation states this clearly in `claude-bus-polling.md`:

> Workers follow this startup sequence:
> 1. Call register_worker("<name>") to announce yourself
> 2. Call poll_task("<name>", 30000) to wait for a task

If workers are skipping step 1, they will never appear in `state.workers` and their polls will silently fail with an error response.
