# Claude Bus Polling Architecture

## Overview

A reliable polling-based architecture where workers actively poll the MCP server for tasks. Workers self-register and long-poll, eliminating the need for external dispatch mechanisms.

## Problem Statement (Historical)

The original design used `tmux send-keys` for dispatch, which had reliability issues. This has been replaced with the polling model described below.

## Goals

- **Reliable delivery**: Tasks are confirmed received before execution
- **Self-reporting workers**: Workers announce their state, not inferred from tmux
- **Clean handshake**: Clear protocol for task assignment and completion
- **Human-friendly**: Main session remains interactive after task completion

## Non-Goals

- Complex job scheduling (priorities, dependencies)
- Worker specialization
- Distributed/multi-machine coordination

## Architecture

### Pattern: Long-Poll with Background Continuation

Workers use blocking long-poll to wait for tasks. After completing a task, they spawn a background agent to continue polling, keeping the main session free for human interaction.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Server (claude-bus)                          │
│                                                                         │
│  Registered Workers:                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ "z.ai1" → { status: "polling", registered_at: T1 }                 ││
│  │ "z.ai2" → { status: "executing", task: "bead-123", since: T2 }     ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  Pending Tasks (keyed by worker):                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ "z.ai1" → { bead_id: "bead-456", assigned_at: T3 }                 ││
│  │ "z.ai2" → null                                                      ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
│  Blocked Pollers (waiting for tasks):                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │ "z.ai1" → { resolve: fn, timeout_id: T }                           ││
│  └─────────────────────────────────────────────────────────────────────┘│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### MCP Tools

#### Existing Tools (Modified)

| Tool | Change |
|------|--------|
| `submit_task(bead_id)` | Assigns to LRU worker's pending queue, resolves blocked poller |
| `worker_done(bead_id)` | Marks worker available for new tasks |
| `get_status()` | Shows registered workers and their self-reported state |

#### New Tools

| Tool | Description |
|------|-------------|
| `register_worker(name)` | Worker announces itself to the bus |
| `poll_task(name, timeout_ms)` | Long-poll for task (blocks until task or timeout) |
| `ack_task(name, bead_id)` | Confirm task receipt, transition to executing |

### Tool Specifications

#### `register_worker(name: string)`

Worker calls this on startup to announce itself.

```typescript
register_worker({ name: "z.ai1" })
→ { success: true, worker: "z.ai1", message: "Registered" }

// If already registered
→ { success: true, worker: "z.ai1", message: "Already registered" }
```

State change:
```
workers.set("z.ai1", {
  status: "idle",
  registered_at: Date.now(),
  current_task: null
})
```

#### `poll_task(name: string, timeout_ms?: number)`

Worker calls this to wait for a task. **Blocks** until task assigned or timeout.

Default timeout: 30000ms (30 seconds)

```typescript
poll_task({ name: "z.ai1", timeout_ms: 30000 })

// If task pending
→ { task: { bead_id: "bead-123", title: "Fix bug", assigned_at: T } }

// If timeout
→ { task: null, timeout: true }

// If unknown worker
→ { error: "Unknown worker: z.ai1 - call register_worker first" }
```

Implementation (blocking with Promise):
```typescript
async function pollTask(name: string, timeout: number): Promise<Response> {
  const worker = state.workers.get(name)
  if (!worker) return { error: "Unknown worker" }

  // Check if task already pending
  const pending = state.pendingTasks.get(name)
  if (pending) {
    return { task: pending }
  }

  // Block until task or timeout
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      state.blockedPollers.delete(name)
      resolve({ task: null, timeout: true })
    }, timeout)

    state.blockedPollers.set(name, {
      resolve: (task) => {
        clearTimeout(timeoutId)
        state.blockedPollers.delete(name)
        resolve({ task })
      },
      timeoutId
    })

    worker.status = "polling"
  })
}
```

#### `ack_task(name: string, bead_id: string)`

Worker confirms task receipt before starting execution.

```typescript
ack_task({ name: "z.ai1", bead_id: "bead-123" })
→ { success: true, worker: "z.ai1", bead_id: "bead-123" }

// If wrong task
→ { success: false, error: "Task mismatch" }
```

State change:
```
worker.status = "executing"
worker.current_task = bead_id
state.pendingTasks.delete(name)
```

### Modified `submit_task`

When orchestrator submits a task:

```typescript
submit_task({ bead_id: "bead-123" })

1. Validate bead exists
2. Select LRU available worker (status: "idle" or "polling")
3. If worker is blocked polling:
   - Resolve their poll immediately with the task
4. Else:
   - Add to pendingTasks[worker] for next poll
5. Return { dispatched: true, worker: "z.ai1", bead_id }
```

## Worker Lifecycle

### Phase 1: Session Start

```
┌─────────────────────────────────────────────────────────────────┐
│  onSessionStart hook fires (pane matches z\.ai pattern)         │
│                                                                 │
│  Hook output: "WORKER_MODE:z.ai1"                               │
│                                                                 │
│  Claude receives context injection:                             │
│  "You are worker z.ai1. Call register_worker, then poll_task." │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2: Polling Loop

```
┌─────────────────────────────────────────────────────────────────┐
│  Worker calls:                                                   │
│  1. register_worker("z.ai1")  → { success: true }               │
│  2. poll_task("z.ai1", 30000) → BLOCKS                          │
│                                                                 │
│  ... waiting for task ...                                       │
│                                                                 │
│  Orchestrator: submit_task("bead-123")                          │
│                                                                 │
│  poll_task returns: { task: { bead_id: "bead-123" } }           │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 3: Task Execution

```
┌─────────────────────────────────────────────────────────────────┐
│  Worker calls:                                                   │
│  1. ack_task("z.ai1", "bead-123")  → confirms receipt           │
│  2. /agent-ecosystem:code bead-123  → executes skill            │
│                                                                 │
│  ... skill runs, human approves at gates ...                    │
│                                                                 │
│  3. worker_done("bead-123")  → signals completion               │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 4: Background Continuation

```
┌─────────────────────────────────────────────────────────────────┐
│  After worker_done, spawn background polling agent:             │
│                                                                 │
│  Task({                                                         │
│    subagent_type: "general-purpose",                            │
│    run_in_background: true,                                     │
│    prompt: "Continue polling. Call poll_task('z.ai1')..."       │
│  })                                                             │
│                                                                 │
│  Main session is now free for human interaction.                │
│  Background agent waits for next task.                          │
└─────────────────────────────────────────────────────────────────┘
```

## Worker Initialization

Workers are initialized by providing them with worker mode instructions. The worker name can be configured via environment variable or passed directly.

### Worker Protocol

Workers follow this startup sequence:

```
1. Call register_worker("<name>") to announce yourself
2. Call poll_task("<name>", 30000) to wait for a task
3. When you receive a task, call ack_task("<name>", bead_id)
4. Execute: /agent-ecosystem:code <bead_id>
5. When the skill completes, call worker_done(bead_id)
6. Resume polling with poll_task("<name>", 30000)

Always acknowledge tasks before executing. Always signal completion.
```

## State Management

### Worker States

```
┌─────────┐  register   ┌─────────┐  poll_task   ┌─────────┐
│  (new)  │ ──────────► │  idle   │ ───────────► │ polling │
└─────────┘             └─────────┘              └────┬────┘
                              ▲                       │
                              │                       │ task assigned
                              │                       ▼
                              │               ┌───────────┐
                              │               │  pending  │
                              │               └─────┬─────┘
                              │                     │
                              │                     │ ack_task
                              │                     ▼
                              │               ┌───────────┐
                              └───────────────│ executing │
                                worker_done   └───────────┘
```

### Server State Structure

```typescript
interface WorkerState {
  status: 'idle' | 'polling' | 'pending' | 'executing'
  registered_at: number
  current_task: string | null
  task_started_at: number | null
}

interface PendingTask {
  bead_id: string
  assigned_at: number
}

interface BlockedPoller {
  resolve: (task: PendingTask) => void
  timeout_id: NodeJS.Timeout
}

interface State {
  workers: Map<string, WorkerState>
  pendingTasks: Map<string, PendingTask>  // worker_name → task
  blockedPollers: Map<string, BlockedPoller>
  activeBeads: Set<string>
}
```

## Migration from Send-Keys (COMPLETED)

The migration from tmux send-keys to polling-based dispatch is complete.

### What Was Removed

- `tmux send-keys` dispatch mechanism
- `tmux list-panes` worker discovery
- `pane_id` tracking in worker state
- `discoverWorkers()` function
- `CLAUDE_BUS_WORKER_PATTERN` environment variable

### Current Architecture

Workers now self-register and poll for tasks. No tmux dependencies remain in the dispatch path.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Worker polls without registering | Error: "Unknown worker" |
| Worker disconnects mid-poll | Timeout fires, worker can re-poll |
| Worker crashes during execution | Task stays in `activeBeads`, can be retried |
| Orchestrator submits to busy worker | Task queued in `pendingTasks` |
| Poll timeout | Returns `{ task: null, timeout: true }`, worker re-polls |
| Ack wrong task | Error: "Task mismatch" |

## Implementation Status

All implementation tasks are complete. See `plugin/lib/claude-bus/` for the implementation.

### Completed Tasks

1. **Polling Tools** - `register_worker`, `poll_task`, `ack_task` implemented in server.ts
2. **Modified submit_task** - Resolves blocked pollers, queues for pending workers
3. **Worker State Management** - Self-registered workers with idle/polling/executing states
4. **LRU Selection** - Uses self-reported availability timestamps

---

*Design Status: IMPLEMENTED - Polling-based dispatch is now the primary mechanism*
