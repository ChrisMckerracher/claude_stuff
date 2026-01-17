# Claude Bus: Remove Tmux, Pure Self-Registration

## Overview

Remove all tmux coupling from claude-bus. Workers self-register via MCP. This becomes a pure Claude-to-Claude coordination system.

## Problem

Current design couples to tmux:
1. Auto-discovers workers by scanning tmux pane titles
2. Dispatches tasks via `tmux send-keys` keystroke injection
3. Tracks `pane_id` for each worker
4. False positives when non-Claude processes have matching pane names

## Solution

**Rip out tmux entirely.** Workers self-register and poll for tasks. User tells workers they're workers on startup.

## New Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     MCP Server (claude-bus)                         │
│                                                                     │
│  Workers: (populated by register_worker calls only)                 │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ "z.ai1" → { status: "polling", last_activity: T1 }              ││
│  │ "z.ai2" → { status: "executing", current_task: "bead-123" }     ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  No tmux. No pane IDs. Just names and states.                       │
└─────────────────────────────────────────────────────────────────────┘
```

## Worker Lifecycle (Background Job Chain)

```
User starts Claude in terminal, tells it: "You are worker z.ai1"

Main Session:
┌────────────────────────────────────────────────────────────────────┐
│ 1. Receives instruction "you are worker z.ai1"                     │
│ 2. Spawns background job to poll for work                          │
│ 3. Main session FREE for human interaction                         │
└────────────────────────────────────────────────────────────────────┘

Background Job #1:
┌────────────────────────────────────────────────────────────────────┐
│ 1. register_worker("z.ai1")                                        │
│ 2. poll_task("z.ai1") ─── blocks waiting ───                       │
│ 3. Receives task: { bead_id: "bead-123" }                          │
│ 4. ack_task("z.ai1", "bead-123")                                   │
│ 5. Executes: /code bead-123                                        │
│ 6. worker_done("bead-123")                                         │
│ 7. Spawns Background Job #2 to continue polling                    │
│ 8. This job ends                                                   │
└────────────────────────────────────────────────────────────────────┘

Background Job #2:
┌────────────────────────────────────────────────────────────────────┐
│ 1. register_worker("z.ai1")  ← always re-register (idempotent)     │
│ 2. poll_task("z.ai1") ─── blocks waiting ───                       │
│ 3. ... cycle continues ...                                         │
└────────────────────────────────────────────────────────────────────┘
```

Each background job handles one task, then spawns the next poller. Main session stays free.

**Note:** Always re-register on each job iteration. If worker was reset due to staleness between jobs, re-registering recovers gracefully.

## Orchestrator Health Monitor (Same Pattern)

```
Orchestrator spawns background job on startup:

Background Monitor Job #1:
┌────────────────────────────────────────────────────────────────────┐
│ 1. Bash("sleep 30")  ← wait before checking                        │
│ 2. get_status()                                                    │
│ 3. For each worker with health "stale" or "stuck":                 │
│    - reset_worker(name)                                            │
│    - retry_task(bead_id) if task was active                        │
│ 4. Spawns Background Monitor Job #2                                │
│ 5. This job ends                                                   │
└────────────────────────────────────────────────────────────────────┘
```

The `sleep 30` at the start of each job creates the monitoring interval. Each job sleeps, checks, cleans up, spawns next, ends.

## Changes Required

### 1. Remove tmux.ts Entirely

Delete:
- `discoverWorkers()`
- `discoverAllWorkers()`
- `parseTmuxOutput()`
- `getWorkerPattern()`
- `DEFAULT_WORKER_PATTERN`

### 2. Remove dispatch.ts

No longer needed - workers pull tasks via `poll_task()`, not push via `tmux send-keys`.

Delete:
- `dispatchToWorker()`
- `verifyPaneExists()`
- `escapeForShell()`
- `findFirstWorkerPane()`

### 3. Simplify Worker Interface

```typescript
interface Worker {
  name: string                    // e.g., "z.ai1"
  status: WorkerStatus
  registered_at: number
  last_activity: number
  current_task: string | null
  task_started_at: number | null
}

type WorkerStatus = 'idle' | 'polling' | 'pending' | 'executing'
```

No `pane_id`. No `pane_title`. Just `name`.

### 4. Remove discoverWorkers() Calls from Server

Currently called in:
- `submit_task` → remove call
- `get_status` → remove call
- `processQueue` → remove call, but **keep the function**

Worker map populated ONLY by `register_worker()`.

**Note on `processQueue`:** Still needed but repurposed. When `worker_done()` is called:
1. Check if tasks are queued
2. Find blocked pollers (workers waiting in `poll_task`)
3. Resolve their poll with the queued task

The function no longer discovers workers or dispatches via tmux - it just matches queued tasks to waiting pollers.

### 5. Remove Legacy Worker States

Remove `'available'` and `'busy'` states entirely. Only polling states remain.

### 6. Update Selection Logic

```typescript
function selectWorker(workers: Map<string, Worker>): Worker | null {
  return Array.from(workers.values())
    .filter(w => w.status === 'idle' || w.status === 'polling')
    .sort((a, b) => a.last_activity - b.last_activity)  // oldest activity first
    .at(0) ?? null
}
```

Selects worker with oldest `last_activity` - the one that's been idle longest (fair distribution).

## Health Check

### Track Last Activity

Updated on every worker MCP call:
- `register_worker()`
- `poll_task()`
- `ack_task()`
- `worker_done()`

### Health Status in get_status()

```typescript
function checkWorkerHealth(
  worker: Worker,
  pendingTasks: Map<string, PendingTask>,
  now: number = Date.now()
): 'healthy' | 'stale' | 'stuck' {
  const STALE_THRESHOLD = 90_000      // 90s no activity (allows poll timeout + buffer)
  const STUCK_THRESHOLD = 300_000     // 5min executing without completion
  const PENDING_THRESHOLD = 30_000    // 30s pending without ack

  if (worker.status === 'executing' && worker.task_started_at) {
    if (now - worker.task_started_at > STUCK_THRESHOLD) {
      return 'stuck'
    }
  }

  if (worker.status === 'pending') {
    const pending = pendingTasks.get(worker.name)
    if (pending && now - pending.assigned_at > PENDING_THRESHOLD) {
      return 'stuck'  // Task assigned but never acked
    }
  }

  if (worker.status === 'idle' || worker.status === 'polling') {
    if (now - worker.last_activity > STALE_THRESHOLD) {
      return 'stale'
    }
  }

  return 'healthy'
}
```

Pure function - pass `pendingTasks` and `now` for testability.

### Response Format

```typescript
get_status() → {
  workers: [
    { name: "z.ai1", status: "polling", health: "healthy", idle_seconds: 5 },
    { name: "z.ai2", status: "executing", health: "stuck", current_task: "bead-123", executing_seconds: 342 }
  ],
  queued_tasks: 0
}
```

**Computed fields:**
- `idle_seconds` = `now - last_activity` (for idle/polling workers)
- `executing_seconds` = `now - task_started_at` (for executing workers)

## Files to Change

| File | Action |
|------|--------|
| `tmux.ts` | DELETE |
| `tmux.test.ts` | DELETE |
| `tmux-integration.test.ts` | DELETE |
| `dispatch.ts` | DELETE |
| `dispatch.test.ts` | DELETE |
| `server.ts` | Remove `discoverWorkers()` calls, remove tmux/dispatch imports, add health check |
| `server.test.ts` | Update for self-registration flow, add health check tests |
| `selection.ts` | Remove `'available'`/`'busy'` handling, delete `isPollingWorker()` (all workers are polling now), use `last_activity` for LRU |
| `selection.test.ts` | Update for polling states only |
| `types.ts` | Remove `pane_id`, `pane_title`, legacy states; rename `pane_title` → `name`, add `last_activity` |
| `ipc.ts` | KEEP - still used for HTTP API if needed |
| `ipc.test.ts` | KEEP - may need minor updates |

## Estimated Scope

~300 lines deleted, ~50 lines added (health check logic)

Net: **-250 lines**

## Benefits

1. **No tmux dependency** - works anywhere Claude runs
2. **No false positives** - only real Claude instances can call MCP tools
3. **Simpler code** - delete two modules, simplify state
4. **Reliable** - no keystroke injection, no pane scanning
5. **Portable** - could work across machines in future

## Worker Name Uniqueness

If two Claude instances register with the same name (e.g., both claim "z.ai1"):
- **Behavior:** Last-write-wins. Second registration overwrites the first.
- **Rationale:** User controls worker names. Keep it simple for v1.
- **Future:** Could reject duplicates or auto-suffix if needed.

## Migration

1. User tells existing workers: "You are worker z.ai1, spawn a background job to register and poll"
2. Or restart worker sessions with new instructions

No backward compatibility needed - this is a clean break.

## Rollback

If something breaks badly: `git revert <commit>`. The changes are deletions + modifications, cleanly revertible.

## Acceptance Criteria

- [ ] `tmux.ts` and `tmux.test.ts` and `tmux-integration.test.ts` deleted
- [ ] `dispatch.ts` and `dispatch.test.ts` deleted
- [ ] `pane_id`/`pane_title` removed from Worker interface, replaced with `name`
- [ ] `last_activity` added to Worker interface
- [ ] Legacy states (`available`, `busy`) removed from codebase
- [ ] `isPollingWorker()` helper deleted (all workers are polling workers now)
- [ ] Workers only appear after `register_worker()` call
- [ ] `get_status()` returns health status (`healthy`/`stale`/`stuck`) per worker
- [ ] `last_activity` updated on all worker MCP calls
- [ ] `processQueue` updated to resolve blocked pollers (no tmux dispatch)
- [ ] All remaining tests pass with self-registration flow
- [ ] Documentation updated (claude-code-bus.md, claude-bus-polling.md)

---

*Design Status: REVIEWED - Ready to decompose*
