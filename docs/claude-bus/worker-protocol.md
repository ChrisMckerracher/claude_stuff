# Worker Protocol

This document details the complete worker lifecycle for claude-bus.

---

## Overview

Workers are Claude Code instances that execute tasks dispatched by an orchestrator. They follow a strict protocol: **register → poll → ack → execute → done → poll again**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Worker Lifecycle                                 │
│                                                                         │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌───────────┐         │
│  │ Register│ ──> │  Poll   │ ──> │   Ack   │ ──> │  Execute  │         │
│  └─────────┘     └────┬────┘     └─────────┘     └─────┬─────┘         │
│                       │                                 │               │
│                       │ timeout                         │ done          │
│                       │                                 │               │
│                       └─────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Registration

Workers must register before polling. This announces the worker to the bus.

```typescript
mcp__claude-bus__register_worker({ name: "z.ai1" })
```

**Response:**
```json
{
  "success": true,
  "worker": "z.ai1",
  "message": "Registered"
}
```

**State change:**
```
workers.set("z.ai1", {
  status: "idle",
  registered_at: Date.now(),
  current_task: null
})
```

**If already registered:**
```json
{
  "success": true,
  "worker": "z.ai1",
  "message": "Already registered"
}
```

---

## Phase 2: Polling

Workers call `poll_task` to wait for work. This is a **blocking long-poll** - the call doesn't return until a task is available or timeout occurs.

```typescript
mcp__claude-bus__poll_task({ name: "z.ai1", timeout_ms: 30000 })
```

**If task available:**
```json
{
  "task": {
    "bead_id": "task-123",
    "title": "Implement login",
    "assigned_at": 1705312800000
  }
}
```

**If timeout:**
```json
{
  "task": null,
  "timeout": true
}
```

**If unknown worker:**
```json
{
  "error": "Unknown worker: z.ai1 - call register_worker first"
}
```

**State change:**
```
worker.status = "polling"
blockedPollers.set("z.ai1", { resolve, timeoutId })
```

### How Long-Polling Works

```typescript
async function pollTask(name: string, timeout: number): Promise<Response> {
  const worker = state.workers.get(name);
  if (!worker) return { error: "Unknown worker" };

  // Check if task already pending
  const pending = state.pendingTasks.get(name);
  if (pending) {
    return { task: pending };
  }

  // Block until task or timeout
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      state.blockedPollers.delete(name);
      worker.status = "idle";
      resolve({ task: null, timeout: true });
    }, timeout);

    state.blockedPollers.set(name, {
      resolve: (task) => {
        clearTimeout(timeoutId);
        state.blockedPollers.delete(name);
        resolve({ task });
      },
      timeoutId
    });

    worker.status = "polling";
  });
}
```

---

## Phase 3: Task Assignment

When the orchestrator submits a task, the daemon:

1. Validates the bead exists
2. Selects LRU (least-recently-used) available worker
3. If worker is blocked polling → resolves immediately
4. If worker is idle → queues in `pendingTasks`

```typescript
mcp__claude-bus__submit_task({ bead_id: "task-123" })
```

**Response:**
```json
{
  "dispatched": true,
  "worker": "z.ai1",
  "bead_id": "task-123"
}
```

**State change:**
```
worker.status = "pending"
pendingTasks.set("z.ai1", { bead_id, assigned_at })
// If worker was polling, their blocked promise resolves
```

### LRU Worker Selection

Workers are selected based on `last_activity` timestamp:

```typescript
function selectWorker(state: BusState): Worker | null {
  const available = Array.from(state.workers.values())
    .filter(w => w.status === 'idle' || w.status === 'polling');

  if (available.length === 0) return null;

  // Sort by last_activity ascending (oldest first)
  available.sort((a, b) => a.last_activity - b.last_activity);
  return available[0];
}
```

---

## Phase 4: Acknowledgment

After receiving a task, workers **must acknowledge** before executing. This confirms receipt and transitions to executing state.

```typescript
mcp__claude-bus__ack_task({ name: "z.ai1", bead_id: "task-123" })
```

**Response:**
```json
{
  "success": true,
  "worker": "z.ai1",
  "bead_id": "task-123"
}
```

**State change:**
```
worker.status = "executing"
worker.current_task = "task-123"
worker.task_started_at = Date.now()
pendingTasks.delete("z.ai1")
activeBeads.add("task-123")
```

**If wrong task:**
```json
{
  "success": false,
  "error": "Task mismatch"
}
```

---

## Phase 5: Execution

The worker executes the task. This typically involves:

1. Reading the bead details: `bd show task-123`
2. Executing the appropriate skill: `/agent-ecosystem:code task-123`
3. Following human validation gates
4. Completing the work

The bus doesn't manage execution - it only tracks state.

---

## Phase 6: Completion

When done, workers signal completion:

```typescript
mcp__claude-bus__worker_done({ bead_id: "task-123" })
```

**Response:**
```json
{
  "success": true,
  "bead_id": "task-123"
}
```

**State change:**
```
worker.status = "idle"
worker.current_task = null
worker.last_activity = Date.now()
activeBeads.delete("task-123")
```

### Signaling Failure

If task fails:

```typescript
mcp__claude-bus__task_failed({ bead_id: "task-123", reason: "Build failed" })
```

**Response:**
```json
{
  "success": true,
  "bead_id": "task-123",
  "status": "failed"
}
```

---

## Phase 7: Resume Polling

After completion, workers immediately resume polling:

```typescript
mcp__claude-bus__poll_task({ name: "z.ai1", timeout_ms: 30000 })
```

This creates a continuous work loop:

```
register → poll → ack → execute → done → poll → ack → execute → done → ...
```

---

## Complete Worker Example

```typescript
// Worker startup
async function startWorker(name: string) {
  // 1. Register
  await mcp__claude-bus__register_worker({ name });

  // 2. Polling loop
  while (true) {
    const result = await mcp__claude-bus__poll_task({
      name,
      timeout_ms: 30000
    });

    if (result.timeout) {
      // No task, poll again
      continue;
    }

    if (result.task) {
      const { bead_id } = result.task;

      // 3. Acknowledge
      await mcp__claude-bus__ack_task({ name, bead_id });

      try {
        // 4. Execute
        await executeTask(bead_id);

        // 5. Signal completion
        await mcp__claude-bus__worker_done({ bead_id });
      } catch (error) {
        // Signal failure
        await mcp__claude-bus__task_failed({
          bead_id,
          reason: error.message
        });
      }
    }
  }
}
```

---

## Error Scenarios

| Scenario | Worker Behavior |
|----------|-----------------|
| Poll returns error | Check if registered, re-register if needed |
| Ack fails (task mismatch) | Log error, resume polling |
| Execution crashes | Task stays in `activeBeads`, use `retry_task` |
| Connection lost mid-poll | Timeout fires, reconnect and re-poll |
| Daemon restarts | Re-register and resume polling |

---

## Best Practices

1. **Always register first** - Polling without registration returns an error
2. **Always acknowledge** - Unacked tasks remain in `pending` state
3. **Always signal completion** - Either `worker_done` or `task_failed`
4. **Handle timeouts gracefully** - Just re-poll on timeout
5. **Use unique worker names** - Collisions cause state confusion

---

## Debugging

### Check if worker is registered

```typescript
const status = await mcp__claude-bus__get_status();
const worker = status.workers.find(w => w.name === "z.ai1");
if (!worker) {
  console.log("Worker not registered");
}
```

### Check worker state

```typescript
const status = await mcp__claude-bus__get_status();
// status.workers shows: name, status, current_task, idle_seconds
```

### Force reset stuck worker

```typescript
await mcp__claude-bus__reset_worker({ worker_name: "z.ai1" });
```

### Re-queue stuck task

```typescript
await mcp__claude-bus__retry_task({ bead_id: "task-123" });
```
