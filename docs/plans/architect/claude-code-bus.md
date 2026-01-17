# Claude Code Bus - Design Document

## Overview

A lightweight MCP server that enables multiple Claude Code instances in tmux to coordinate work. One instance (orchestrator) creates tasks, and idle instances (workers) are dispatched to execute them.

**Key integration:** Uses [beads](https://github.com/steveyegge/beads) for task persistence and tracking. Tasks are git-backed, recoverable, and maintain full history.

## Problem Statement

When running multiple Claude Code instances in tmux panes:
1. No built-in way for them to communicate
2. No way to dispatch work to an idle instance
3. No visibility into which instances are available vs busy
4. No persistence - if something crashes, work is lost

## Goals

- **Simple**: Minimal moving parts, easy to understand
- **Zero idle cost**: Workers sitting at the prompt burn no tokens
- **Watchable**: Tasks execute in interactive mode so you can observe
- **Recoverable**: Beads-backed tasks survive crashes, can be retried
- **Lightweight**: Personal tool, not enterprise orchestration

## Non-Goals

- Worker specialization (all workers are generic)
- Distributed/multi-machine coordination
- Complex task dependencies (beads handles this separately)

## Architecture

**Pattern: Master-Worker with LRU selection, Beads-backed tasks**

The orchestrator (master) creates beads tasks and dispatches them to workers. Workers execute tasks and mark them complete. MCP server selects the least-recently-used available worker for each task.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            tmux session                                  │
├──────────────┬───────────────┬───────────────┬──────────────────────────┤
│ file-manager │  orchestrator │  file_viewer  │                          │
│    (nnn)     │   (master)    │               │                          │
│              │               │               │                          │
│              ├───────────────┼───────────────┤                          │
│              │    z.ai1      │    z.ai2      │                          │
│              │   (worker)    │   (worker)    │                          │
│              │               │               │                          │
└──────────────┴───────────────┴───────────────┴──────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Server (Node.js)                              │
│                                                                          │
│  Workers: (discovered via tmux list-panes)                               │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ "z.ai1" → { pane_id: "%4", status: "available", available_since: T } │ │
│  │ "z.ai2" → { pane_id: "%3", status: "busy",      current_task: "bd-a1b2" } │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Selection: LRU (worker available longest gets next task)                │
│                                                                          │
│  MCP Tools:                                                              │
│  - submit_task(bead_id)      → select LRU worker, mark busy, dispatch    │
│  - task_complete(bead_id)    → bd close, mark available, process queue   │
│  - get_status()              → list workers + queue + beads status       │
│  - reset_worker(worker)      → force mark available (unstick)            │
│  - retry_task(bead_id)       → re-queue an incomplete task               │
└──────────────────────────────────────────────────────────────────────────┘
        │
        │ reads/writes
        ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        .beads/ (git-backed)                              │
│                                                                          │
│  bd-a1b2: { title: "Review auth module", status: "in_progress", ... }   │
│  bd-c3d4: { title: "Fix login bug", status: "open", ... }               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Flow:**
```
1. Master creates task: bd create "Review auth module" --details "..."
   → returns bd-a1b2

2. Master calls submit_task("bd-a1b2")

3. MCP server:
   - Runs: bd update bd-a1b2 --status in_progress
   - Selects LRU available worker (z.ai1)
   - Marks z.ai1 busy, records current_task = "bd-a1b2"
   - Runs: tmux send-keys -t %4 "Execute task bd-a1b2. Run bd show bd-a1b2 for details. When done, call task_complete(\"bd-a1b2\")." Enter

4. z.ai1 runs bd show bd-a1b2, sees full task details

5. z.ai1 does the work (you watch it happen)

6. z.ai1 calls task_complete("bd-a1b2")

7. MCP server:
   - Runs: bd close bd-a1b2
   - Marks z.ai1 available, sets available_since = now
   - Processes queue if any pending tasks

8. z.ai1 is now last in LRU queue (z.ai2 would be picked next)
```

**Recovery flow:**
```
1. Worker z.ai2 crashes mid-task (bd-c3d4)

2. Orchestrator notices, or checks: bd ready
   → sees bd-c3d4 is still in_progress but worker is gone

3. Orchestrator calls reset_worker("z.ai2") to clear worker state

4. Orchestrator calls retry_task("bd-c3d4") to re-queue
   → task dispatched to next available worker
```

## Pane Naming Convention

Tmux panes have persistent titles set in `~/.tmux-claude.conf`:

| Pane Title    | Role              | Notes                        |
|---------------|-------------------|------------------------------|
| file-manager  | nnn file browser  | Not a worker                 |
| orchestrator  | Coordinator       | Submits tasks, not a worker  |
| file_viewer   | Worker (optional) | Can be used for viewing      |
| z.ai1         | Worker            | Available for tasks          |
| z.ai2         | Worker            | Available for tasks          |

Workers are identified by title prefix `z.ai*` (configurable).

## Components

### 1. MCP Server (`claude-bus`)

A single Node.js process that:
- Exposes MCP tools to Claude Code instances
- Discovers workers by scanning tmux panes
- Dispatches tasks directly via `tmux send-keys`
- Integrates with beads for task persistence

**MCP Tools:**

| Tool | Description |
|------|-------------|
| `submit_task(bead_id)` | Select LRU worker, mark busy, dispatch via tmux |
| `task_complete(bead_id)` | Close bead, mark worker available, process queue |
| `get_status()` | List workers, queue, and active beads |
| `reset_worker(worker_name)` | Force a stuck worker back to available |
| `retry_task(bead_id)` | Re-queue an in_progress task (for recovery) |

**State** (in-memory, worker tracking only):
```typescript
interface Worker {
  pane_id: string              // e.g., "%4"
  pane_title: string           // e.g., "z.ai1"
  status: 'available' | 'busy'
  available_since: number | null
  current_task: string | null  // bead_id if busy
}

interface State {
  workers: Map<string, Worker>
  taskQueue: string[]  // bead_ids waiting for available worker
}
```

**Note:** Task details live in beads (`.beads/`), not in MCP server state. Server only tracks worker availability and a lightweight queue of bead IDs.

### 2. Worker Selection (LRU)

```typescript
function selectWorker(workers: Map<string, Worker>): Worker | null {
  return Array.from(workers.values())
    .filter(w => w.status === 'available')
    .sort((a, b) => a.available_since! - b.available_since!)  // oldest first
    .at(0) ?? null
}
```

When a worker becomes available, it goes to the **back** of the LRU queue (most recently available = picked last).

### 3. Worker Discovery

On startup and periodically, scan tmux for worker panes:

```typescript
function discoverWorkers(): void {
  const output = execSync('tmux list-panes -a -F "#{pane_id}|#{pane_title}"').toString()
  const workerPattern = /^z\.ai/

  for (const line of output.trim().split('\n')) {
    const [pane_id, pane_title] = line.split('|')
    if (workerPattern.test(pane_title) && !state.workers.has(pane_title)) {
      state.workers.set(pane_title, {
        pane_id,
        pane_title,
        status: 'available',
        available_since: Date.now()
      })
    }
  }
}
```

### 4. Worker Protocol

Workers receive a bead ID, read the task details, do the work, then call `task_complete()`:

```
Worker receives: "Execute task bd-a1b2. Run bd show bd-a1b2 for details.
                  When done, call task_complete(\"bd-a1b2\")."

Worker runs: bd show bd-a1b2
Worker does the work
Worker calls: task_complete("bd-a1b2")
```

## MCP Server Implementation

```typescript
import { execSync } from 'child_process'

const state: State = {
  workers: new Map(),
  taskQueue: []  // bead_ids
}

// ─── Beads Integration ─────────────────────────────────────────────

function beadSetInProgress(beadId: string): void {
  execSync(`bd update ${beadId} --status in_progress`)
}

function beadClose(beadId: string): void {
  execSync(`bd close ${beadId}`)
}

function beadGetTitle(beadId: string): string {
  const output = execSync(`bd show ${beadId} --format json`).toString()
  return JSON.parse(output).title ?? beadId
}

// ─── Worker Selection (LRU) ────────────────────────────────────────

function selectWorker(): Worker | null {
  return Array.from(state.workers.values())
    .filter(w => w.status === 'available')
    .sort((a, b) => a.available_since! - b.available_since!)
    .at(0) ?? null
}

// ─── Task Dispatch ─────────────────────────────────────────────────

function dispatchToWorker(worker: Worker, beadId: string): void {
  // Mark bead as in_progress
  beadSetInProgress(beadId)

  // Update worker state
  worker.status = 'busy'
  worker.available_since = null
  worker.current_task = beadId

  // Build prompt for worker
  const prompt = `Execute task ${beadId}. Run "bd show ${beadId}" for details. When done, call task_complete("${beadId}").`

  // Send to tmux pane
  execSync(`tmux send-keys -t ${worker.pane_id} ${JSON.stringify(prompt)} Enter`)
}

function processQueue(): void {
  while (state.taskQueue.length > 0) {
    const worker = selectWorker()
    if (!worker) break

    const beadId = state.taskQueue.shift()!
    dispatchToWorker(worker, beadId)
  }
}

// ─── MCP Tools ─────────────────────────────────────────────────────

const tools = {
  submit_task: ({ bead_id }: { bead_id: string }) => {
    discoverWorkers()

    const worker = selectWorker()

    if (worker) {
      dispatchToWorker(worker, bead_id)
      return { dispatched: true, worker: worker.pane_title, bead_id }
    } else {
      state.taskQueue.push(bead_id)
      return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id }
    }
  },

  task_complete: ({ bead_id }: { bead_id: string }) => {
    // Find worker with this task
    const worker = Array.from(state.workers.values())
      .find(w => w.current_task === bead_id)

    if (!worker) {
      // Task completed but worker unknown - still close the bead
      beadClose(bead_id)
      return { success: true, bead_id, warning: 'Worker not found, bead closed anyway' }
    }

    // Close the bead
    beadClose(bead_id)

    // Mark worker available
    worker.status = 'available'
    worker.available_since = Date.now()
    worker.current_task = null

    // Process queue
    processQueue()

    return { success: true, bead_id, worker: worker.pane_title }
  },

  get_status: () => ({
    workers: Array.from(state.workers.values()).map(w => ({
      name: w.pane_title,
      status: w.status,
      current_task: w.current_task,
      idle_seconds: w.available_since ? Math.floor((Date.now() - w.available_since) / 1000) : null
    })),
    queued_tasks: state.taskQueue.length,
    queue: state.taskQueue
  }),

  reset_worker: ({ worker_name }: { worker_name: string }) => {
    const worker = state.workers.get(worker_name)
    if (!worker) {
      return { success: false, error: `Unknown worker: ${worker_name}` }
    }

    const previousTask = worker.current_task
    worker.status = 'available'
    worker.available_since = Date.now()
    worker.current_task = null

    processQueue()

    return { success: true, worker: worker_name, previous_task: previousTask }
  },

  retry_task: ({ bead_id }: { bead_id: string }) => {
    // Re-queue an in_progress task (doesn't change bead status, just re-dispatches)
    const worker = selectWorker()

    if (worker) {
      dispatchToWorker(worker, bead_id)
      return { dispatched: true, worker: worker.pane_title, bead_id }
    } else {
      state.taskQueue.push(bead_id)
      return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id }
    }
  }
}
```

## Usage Flow

### Setup (One-time)

1. Install the MCP server:
   ```bash
   npm install -g claude-bus
   ```

2. Configure Claude Code to use it (`~/.claude/settings.json`):
   ```json
   {
     "mcpServers": {
       "claude-bus": {
         "command": "claude-bus",
         "args": ["serve"]
       }
     }
   }
   ```

3. Ensure beads is initialized in your project:
   ```bash
   bd init
   ```

### Daily Use

1. **Start tmux** - layout auto-creates with named panes (z.ai1, z.ai2, etc.)

2. **Start Claude Code** in worker panes
   - Workers are auto-discovered when first task is submitted

3. **From orchestrator**, create a task and dispatch:
   ```
   Create a bead task to review the auth module for security issues, then submit it.
   ```

   Orchestrator runs:
   ```bash
   bd create "Review auth module for security issues" --details "Check for SQL injection, XSS, auth bypass..."
   # returns bd-a1b2
   ```
   Then calls `submit_task("bd-a1b2")`

4. **MCP server** marks bead in_progress, selects LRU worker, dispatches via tmux

5. **Worker** receives prompt, runs `bd show bd-a1b2`, does the work

6. **Worker** calls `task_complete("bd-a1b2")`
   - Bead is closed
   - Worker marked available

7. **Orchestrator** can verify: `bd show bd-a1b2` shows status: closed

### Monitoring

From orchestrator:
```
Show me the bus status
```

Returns:
```
Workers:
  - z.ai1: available (idle 45s)
  - z.ai2: busy (task: bd-c3d4)

Queued: 1 task
  - bd-e5f6
```

Or check beads directly:
```bash
bd ready        # see open tasks
bd list         # see all tasks
```

### Recovery

If a worker crashes or gets stuck:

```
1. Check status: get_status()
   → z.ai2 busy on bd-c3d4, but pane is dead

2. Reset the worker: reset_worker("z.ai2")
   → z.ai2 marked available, bd-c3d4 still in_progress in beads

3. Retry the task: retry_task("bd-c3d4")
   → dispatched to z.ai1 (or queued if no workers free)
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Worker pane closed | Next `discoverWorkers()` removes stale entries |
| Worker crashes mid-task | `reset_worker()` + `retry_task()` to recover |
| MCP server restarts | Worker state lost, but beads persist - can recover from `bd ready` |
| Task fails | Worker should still call `task_complete()` (or orchestrator retries) |
| No workers available | Task queued, dispatched when `task_complete()` frees a worker |
| Bead not found | `submit_task` fails with error |

**Key insight:** Because tasks live in beads, MCP server restart is recoverable. Orchestrator can check `bd ready` or `bd list --status in_progress` to find orphaned tasks.

## Configuration

Environment variables:

```bash
CLAUDE_BUS_WORKER_PATTERN="^z\.ai"  # Regex for worker pane titles
```

## Future Considerations

- Task priorities (beads supports priority field)
- Batch task submission (submit multiple bead IDs at once)
- Web dashboard for monitoring
- Claude Code hooks for automatic `task_complete()` on response complete
- Worker affinity (route certain task types to certain workers)

## Implementation Plan

| Phase | Deliverable |
|-------|-------------|
| 1 | MCP server with `submit_task`, `task_complete`, `get_status`, `reset_worker`, `retry_task` |
| 2 | Beads integration (`bd update`, `bd close`) |
| 3 | Worker discovery via `tmux list-panes` |
| 4 | LRU selection logic |
| 5 | npm package (`claude-bus serve`) |

---

*Design Status: DRAFT - Ready for review*
