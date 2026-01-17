# Claude Code Bus - Design Document

## Overview

A lightweight MCP server that enables multiple Claude Code instances in tmux to coordinate work. One instance (orchestrator) creates tasks, and idle instances (workers) are dispatched to execute them.

**Key integration:** Uses [beads](https://github.com/steveyegge/beads) for task persistence and tracking. Tasks are git-backed, recoverable, and maintain full history.

**Interaction model:** Human-in-the-loop. You watch workers in tmux, chat with them when stuck, and approve at human gates. The bus solves task delegation - workers are not fully autonomous.

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
│  - submit_task(bead_id)      → select LRU worker, dispatch /code <id>    │
│  - worker_done(bead_id)      → mark available, process queue             │
│  - get_status()              → list workers + queue + idle times         │
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
   - Runs: tmux send-keys -t %4 "/code bd-a1b2" Enter

4. z.ai1's /code skill activates:
   - Derives epic from task ID
   - Navigates to worktree if needed
   - Runs bd show bd-a1b2 for details
   - Does the work (you watch it happen, can chat if stuck)

5. z.ai1 pauses at Pre-Commit Gate (you approve in tmux)

6. z.ai1 runs /task-complete bd-a1b2:
   - Commits, merges to epic, rebases dependents
   - Closes bead with summary
   - Calls worker_done("bd-a1b2") to notify bus

7. MCP server:
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

> **⚠️ IMPORTANT: Worker panes MUST match the naming pattern or they won't be discovered.**
>
> Default pattern: `^z\.ai` (matches `z.ai1`, `z.ai2`, etc.)
>
> Set in your tmux config or override with `CLAUDE_BUS_WORKER_PATTERN`.

Tmux panes have persistent titles set in `~/.tmux-claude.conf`:

| Pane Title    | Role              | Notes                        |
|---------------|-------------------|------------------------------|
| file-manager  | nnn file browser  | Not a worker                 |
| orchestrator  | Coordinator       | Submits tasks, not a worker  |
| file_viewer   | Worker (optional) | Can be used for viewing      |
| z.ai1         | Worker            | Available for tasks          |
| z.ai2         | Worker            | Available for tasks          |

Workers are identified by title prefix `z.ai*` (configurable via `CLAUDE_BUS_WORKER_PATTERN`).

**To set pane titles in tmux:**
```bash
# In ~/.tmux.conf or ~/.tmux-claude.conf
# Allow programs to set pane title
set -g allow-rename on

# Or manually: Ctrl-b , (rename window) or:
tmux select-pane -T "z.ai1"
```

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
| `submit_task(bead_id)` | Select LRU worker, mark busy, dispatch `/code <bead_id>` via tmux |
| `worker_done(bead_id)` | Mark worker available, process queue (called by `/task-complete`) |
| `task_failed(bead_id, reason)` | Mark bead blocked, free worker (when task can't complete) |
| `get_status()` | List workers, queue, and idle times |
| `reset_worker(worker_name)` | Force a stuck worker back to available |
| `retry_task(bead_id)` | Re-queue an in_progress task (for recovery) |

**State** (in-memory, worker tracking only):
```typescript
interface Worker {
  pane_id: string              // e.g., "%4"
  pane_title: string           // e.g., "z.ai1"
  status: 'available' | 'busy'
  available_since: number | null
  busy_since: number | null    // timestamp when marked busy (for timeout warnings)
  current_task: string | null  // bead_id if busy
}

interface State {
  workers: Map<string, Worker>
  taskQueue: string[]  // bead_ids waiting for available worker
  activeBeads: Set<string>  // bead_ids currently dispatched or queued (dedup)
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
  // Use pane_id first (always %N format), then title - avoids delimiter issues
  const output = execSync('tmux list-panes -a -F "#{pane_id}|#{pane_title}"').toString()
  const workerPattern = /^z\.ai/

  for (const line of output.trim().split('\n')) {
    // pane_id is always %N format, so first | is safe delimiter
    const pipeIdx = line.indexOf('|')
    const pane_id = line.slice(0, pipeIdx)
    const pane_title = line.slice(pipeIdx + 1)

    if (workerPattern.test(pane_title) && !state.workers.has(pane_title)) {
      state.workers.set(pane_title, {
        pane_id,
        pane_title,
        status: 'available',
        available_since: Date.now(),
        busy_since: null,
        current_task: null
      })
    }
  }
}
```

### 4. Worker Protocol

Workers receive `/code <bead_id>` which invokes the existing Coding Agent skill:

```
Bus dispatches: /code bd-a1b2

Worker's /code skill:
1. Derives epic: ${bead_id%%.*}  (e.g., bd-a1b2.1 → bd-a1b2)
2. Navigates to worktree: .worktrees/{epic}/ (if exists)
3. Claims task: bd update bd-a1b2 --status in_progress
4. Reads design doc, spawns QA in parallel
5. Implements using TDD workflow
6. Pauses at Pre-Commit Gate → human approves in tmux
7. Runs /task-complete bd-a1b2:
   - Commits work
   - Merges to epic branch
   - Rebases dependent tasks
   - Closes bead with summary
   - Notifies bus: worker_done("bd-a1b2")
```

**Integration with existing ecosystem:** This reuses the `/code` and `/task-complete` skills rather than inventing new protocols. The only addition is `/task-complete` calling `worker_done()` at the end.

**Human gates preserved:** Workers still pause at the Pre-Commit Gate. You approve in the tmux pane - the bus doesn't bypass human approval.

## MCP Server Implementation

```typescript
import { execSync } from 'child_process'

const state: State = {
  workers: new Map(),
  taskQueue: [],
  activeBeads: new Set()
}

// ─── Startup Validation ────────────────────────────────────────────

function validateDependencies(): void {
  // Check beads CLI is installed and supports required features
  try {
    const version = execSync('bd --version', { encoding: 'utf8' }).trim()
    console.log(`Using beads: ${version}`)

    // Verify --format json is supported (added in beads 0.3+)
    execSync('bd list --format json --limit 1', { encoding: 'utf8', stdio: 'pipe' })
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      throw new Error('beads CLI (bd) not found. Install from: https://github.com/steveyegge/beads')
    }
    if (e.message?.includes('--format')) {
      throw new Error('beads CLI version too old. Requires --format json support (v0.3+)')
    }
    throw new Error(`beads CLI check failed: ${e.message}`)
  }

  // Check tmux is available
  try {
    execSync('tmux -V', { encoding: 'utf8' })
  } catch {
    throw new Error('tmux not found. Install tmux to use claude-bus')
  }
}

// Call on server startup
validateDependencies()

// ─── Beads Integration ─────────────────────────────────────────────

function validateBead(beadId: string): { valid: boolean; error?: string } {
  try {
    const output = execSync(`bd show ${beadId} --format json`, { encoding: 'utf8' })
    const bead = JSON.parse(output)
    if (bead.status === 'closed') return { valid: false, error: 'Bead already closed' }
    if (bead.status === 'blocked') return { valid: false, error: 'Bead is blocked' }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Bead not found' }
  }
}

function beadSetInProgress(beadId: string): void {
  execSync(`bd update ${beadId} --status in_progress`)
}

// ─── Worker Selection (LRU) ────────────────────────────────────────

function selectWorker(): Worker | null {
  return Array.from(state.workers.values())
    .filter(w => w.status === 'available')
    .sort((a, b) => a.available_since! - b.available_since!)
    .at(0) ?? null
}

// ─── Task Dispatch ─────────────────────────────────────────────────

function verifyPaneExists(paneId: string): boolean {
  try {
    execSync(`tmux display-message -t ${paneId} -p ''`, { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function dispatchToWorker(worker: Worker, beadId: string): void {
  // Verify pane still exists before dispatch
  if (!verifyPaneExists(worker.pane_id)) {
    state.workers.delete(worker.pane_title)
    throw new Error(`Worker pane ${worker.pane_title} no longer exists`)
  }

  // Track active bead (dedup) - before dispatch so we don't lose track on failure
  state.activeBeads.add(beadId)

  // Mark bead as in_progress BEFORE dispatch (prevents race condition)
  // If dispatch fails, bead stays in_progress but can be retried
  try {
    beadSetInProgress(beadId)
  } catch (e) {
    state.activeBeads.delete(beadId)
    throw new Error(`Failed to update bead status: ${e}`)
  }

  // Update worker state
  worker.status = 'busy'
  worker.available_since = null
  worker.busy_since = Date.now()
  worker.current_task = beadId

  // Escape bead ID for shell (handles special characters)
  const escapedBeadId = beadId.replace(/'/g, "'\\''")

  try {
    // Dispatch using existing /code skill
    // Worker's /code will handle: worktree navigation, TDD, human gates, task-complete
    execSync(`tmux send-keys -t ${worker.pane_id} '/code ${escapedBeadId}' Enter`)
  } catch (e) {
    // Rollback worker state on dispatch failure
    // Note: bead stays in_progress - orchestrator can retry_task() to reassign
    state.activeBeads.delete(beadId)
    worker.status = 'available'
    worker.available_since = Date.now()
    worker.busy_since = null
    worker.current_task = null
    throw e
  }
}

function processQueue(): void {
  // Discover new workers that may have appeared
  discoverWorkers()

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
    // Validate bead exists and is in submittable state
    const validation = validateBead(bead_id)
    if (!validation.valid) {
      return { dispatched: false, error: validation.error, bead_id }
    }

    // Dedup: reject if already active or queued
    if (state.activeBeads.has(bead_id)) {
      return { dispatched: false, error: 'Task already active or queued', bead_id }
    }

    discoverWorkers()

    const worker = selectWorker()

    if (worker) {
      dispatchToWorker(worker, bead_id)
      return { dispatched: true, worker: worker.pane_title, bead_id }
    } else {
      state.activeBeads.add(bead_id)
      state.taskQueue.push(bead_id)
      return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id }
    }
  },

  worker_done: ({ bead_id }: { bead_id: string }) => {
    // Remove from active set (allows resubmit if needed later)
    state.activeBeads.delete(bead_id)

    // Find worker with this task
    const worker = Array.from(state.workers.values())
      .find(w => w.current_task === bead_id)

    if (!worker) {
      return { success: true, bead_id, warning: 'Worker not found' }
    }

    // Mark worker available (bead already closed by worker)
    worker.status = 'available'
    worker.available_since = Date.now()
    worker.busy_since = null
    worker.current_task = null

    // Process queue
    processQueue()

    return { success: true, bead_id, worker: worker.pane_title }
  },

  get_status: () => {
    // Refresh worker state before reporting
    discoverWorkers()

    return {
      workers: Array.from(state.workers.values()).map(w => ({
        name: w.pane_title,
        status: w.status,
        current_task: w.current_task,
        idle_seconds: w.available_since ? Math.floor((Date.now() - w.available_since) / 1000) : null
      })),
      queued_tasks: state.taskQueue.length,
      queue: state.taskQueue
    }
  },

  reset_worker: ({ worker_name }: { worker_name: string }) => {
    const worker = state.workers.get(worker_name)
    if (!worker) {
      return { success: false, error: `Unknown worker: ${worker_name}` }
    }

    const previousTask = worker.current_task

    // Remove task from active set (allows retry)
    if (previousTask) {
      state.activeBeads.delete(previousTask)
    }

    worker.status = 'available'
    worker.available_since = Date.now()
    worker.busy_since = null
    worker.current_task = null

    processQueue()

    return { success: true, worker: worker_name, previous_task: previousTask }
  },

  retry_task: ({ bead_id }: { bead_id: string }) => {
    // Dedup check: reject if task is still active (use reset_worker first if worker died)
    if (state.activeBeads.has(bead_id)) {
      return { dispatched: false, error: 'Task still active - use reset_worker first if worker died', bead_id }
    }

    // Validate bead is in retryable state
    const validation = validateBead(bead_id)
    if (!validation.valid) {
      return { dispatched: false, error: validation.error, bead_id }
    }

    discoverWorkers()
    const worker = selectWorker()

    if (worker) {
      dispatchToWorker(worker, bead_id)
      return { dispatched: true, worker: worker.pane_title, bead_id }
    } else {
      state.activeBeads.add(bead_id)
      state.taskQueue.push(bead_id)
      return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id }
    }
  },

  task_failed: ({ bead_id, reason }: { bead_id: string, reason: string }) => {
    // Mark bead as blocked (not closed, not in_progress)
    const escapedReason = reason.replace(/"/g, '\\"')
    execSync(`bd update ${bead_id} --status blocked --note "${escapedReason}"`)

    // Remove from active set
    state.activeBeads.delete(bead_id)

    // Find and free the worker
    const worker = Array.from(state.workers.values())
      .find(w => w.current_task === bead_id)

    if (worker) {
      worker.status = 'available'
      worker.available_since = Date.now()
      worker.busy_since = null
      worker.current_task = null
    }

    processQueue()

    return { success: true, bead_id, status: 'blocked', reason }
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
| Worker pane closed | `discoverWorkers()` removes stale entries, clears from `activeBeads` |
| Worker crashes mid-task | `discoverWorkers()` auto-clears, then `retry_task()` to recover |
| Worker stuck | You see it in tmux - chat to unstick or use `reset_worker()` |
| Task fails (worker can't complete) | Worker calls `task_failed(bead_id, reason)` to mark blocked |
| MCP server restarts | Worker state lost, but beads persist - see recovery procedure below |
| No workers available | Task queued, dispatched when `worker_done()` frees a worker |
| Bead not found | `submit_task` fails with error |
| Dispatch to dead pane | `dispatchToWorker()` verifies pane exists, rolls back on failure |

### MCP Server Restart Recovery

After MCP server restart, in-memory state is lost but beads persist. Recovery procedure:

```bash
# From orchestrator, re-queue any in_progress tasks
bd list --status in_progress --format=ids | while read id; do
  echo "Re-queueing $id"
done

# Or let orchestrator handle it:
# "Check for orphaned tasks and re-queue them"
```

The orchestrator can check `bd list --status in_progress` and call `submit_task` for each orphaned task.

### Stale Worker Cleanup

When `discoverWorkers()` runs, it compares current tmux panes against known workers:

```typescript
function discoverWorkers(): void {
  const currentPanes = new Set<string>()
  const output = execSync('tmux list-panes -a -F "#{pane_id}|#{pane_title}"').toString()
  const workerPattern = /^z\.ai/

  for (const line of output.trim().split('\n')) {
    // pane_id is always %N format, so first | is safe delimiter
    const pipeIdx = line.indexOf('|')
    const pane_id = line.slice(0, pipeIdx)
    const pane_title = line.slice(pipeIdx + 1)
    currentPanes.add(pane_title)

    if (workerPattern.test(pane_title) && !state.workers.has(pane_title)) {
      // New worker discovered
      state.workers.set(pane_title, {
        pane_id,
        pane_title,
        status: 'available',
        available_since: Date.now(),
        busy_since: null,
        current_task: null
      })
    }
  }

  // Remove stale workers (pane no longer exists)
  for (const [name, worker] of state.workers) {
    if (!currentPanes.has(name)) {
      if (worker.current_task) {
        // Worker died with task - remove from activeBeads so it can be retried
        state.activeBeads.delete(worker.current_task)
        console.warn(`Worker ${name} died with task ${worker.current_task} - task can be retried`)
      }
      state.workers.delete(name)
    }
  }
}
```

### Task Failure (Worker Can't Complete)

When a worker encounters an error that prevents task completion (not a crash, but a logical failure), it calls `task_failed(bead_id, reason)`. This marks the bead as blocked, frees the worker, and processes the queue.

Orchestrator can review blocked tasks: `bd list --status blocked`

### Worker Health Check (Optional)

Since you're watching workers in tmux, automated health checks are less critical. You can see when a worker is stuck and intervene directly.

For convenience, `get_status()` shows idle time for busy workers - if a worker has been "busy" for an unusually long time, you can check the pane visually.

**Recovery is simple:** If a worker is stuck, just chat with it in tmux to unstick it, or use `reset_worker()` + `retry_task()` to reassign the work.

**Key insight:** Because tasks live in beads, MCP server restart is recoverable. Orchestrator can check `bd ready` or `bd list --status in_progress` to find orphaned tasks.

## Configuration

Environment variables:

```bash
CLAUDE_BUS_WORKER_PATTERN="^z\.ai"  # Regex for worker pane titles
CLAUDE_BUS_BUSY_TIMEOUT_MINS="30"   # Warn if worker busy > N minutes (0 = disabled)
```

### Busy Timeout Warnings

Optional periodic check warns if workers are busy longer than expected:

```typescript
const BUSY_TIMEOUT_MS = parseInt(process.env.CLAUDE_BUS_BUSY_TIMEOUT_MINS || '0') * 60 * 1000

function checkBusyTimeouts(): void {
  if (BUSY_TIMEOUT_MS <= 0) return  // disabled

  const now = Date.now()
  for (const worker of state.workers.values()) {
    if (worker.status === 'busy' && worker.busy_since) {
      const busyDuration = now - worker.busy_since
      if (busyDuration > BUSY_TIMEOUT_MS) {
        const mins = Math.floor(busyDuration / 60000)
        console.warn(
          `⚠️  Worker ${worker.pane_title} has been busy for ${mins} minutes ` +
          `on task ${worker.current_task}. Check tmux pane or use reset_worker().`
        )
      }
    }
  }
}

// Run check every 5 minutes if timeout is enabled
if (BUSY_TIMEOUT_MS > 0) {
  setInterval(checkBusyTimeouts, 5 * 60 * 1000)
}
```

### Graceful Shutdown

Handle SIGTERM/SIGINT to log state before exit:

```typescript
function handleShutdown(signal: string): void {
  console.log(`\nReceived ${signal}, shutting down...`)

  // Log any in-progress tasks for recovery
  const busyWorkers = Array.from(state.workers.values())
    .filter(w => w.status === 'busy' && w.current_task)

  if (busyWorkers.length > 0) {
    console.log('\n⚠️  Tasks that may need recovery:')
    for (const w of busyWorkers) {
      console.log(`  - ${w.current_task} (was on ${w.pane_title})`)
    }
    console.log('\nRun `bd list --status in_progress` to find orphaned tasks.')
  }

  if (state.taskQueue.length > 0) {
    console.log(`\n⚠️  ${state.taskQueue.length} queued tasks were not dispatched:`)
    for (const beadId of state.taskQueue) {
      console.log(`  - ${beadId}`)
    }
  }

  process.exit(0)
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'))
process.on('SIGINT', () => handleShutdown('SIGINT'))
```

## Integration with Agent Ecosystem

The bus reuses existing agent ecosystem patterns rather than inventing parallel mechanisms.

### Dispatch Format

Bus uses the existing `/code` skill:
```
/code <bead_id>
```

The `/code` skill already handles:
- Worktree navigation (derives epic from task ID)
- Design doc lookup
- TDD workflow with QA spawning
- Human validation gates
- Task completion via `/task-complete`

### Worktree Awareness

When tasks are part of an epic (created via `/decompose`), workers automatically navigate to the correct worktree:

```
Task ID: claude_stuff-abc.1
Epic ID: claude_stuff-abc (derived: ${task_id%%.*})
Worktree: .worktrees/claude_stuff-abc/
Branch: task/claude_stuff-abc.1
```

The `/code` skill handles this navigation. Bus just dispatches the task ID.

### Task Completion Hook

To notify the bus when work is done, `/task-complete` calls `worker_done()`:

```bash
# At end of task-complete.sh, add:
# Notify bus if running
if command -v claude-bus &>/dev/null; then
  claude-bus notify-done "$task_id" 2>/dev/null || true
fi
```

Or workers can call `worker_done()` directly via MCP tool after `/task-complete` finishes.

### Human Gates

Workers still pause at all mandatory gates:

| Gate | What Happens |
|------|--------------|
| Pre-Commit | Worker pauses, you approve in tmux pane |
| Code Review rejection | Worker iterates or flags to you |
| Architecture concern | Worker stops, flags for Architect review |

The bus doesn't bypass these - you interact with workers directly in tmux.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction model | Human-in-the-loop | You watch workers in tmux, chat when stuck, approve at gates |
| Dispatch format | `/code <bead_id>` | Reuses existing skill; handles worktrees, TDD, gates automatically |
| Completion signal | `/task-complete` calls `worker_done()` | Integrates with existing ecosystem; single completion path |
| Orchestrator model | Single orchestrator assumed | Simplicity; no coordination between orchestrators needed |
| Project context | All panes share cwd | Workers launched in same tmux session share project context |
| MCP server lifecycle | Per-project, started by orchestrator | Server tied to project; orchestrator starts it when entering project |
| Task results | Worker closes bead with notes | Worker has context; close notes = results; `bd show` to view |
| Dispatch validation | Verify pane exists before send-keys | Prevents silent failures; enables rollback |
| State refresh | `get_status` calls `discoverWorkers()` | Always returns current state; auto-detects dead workers |
| Dispatch confirmation | Fire-and-forget (tmux send-keys) | Simplicity; busy timeout catches stuck workers |

### Known Limitations

**Dispatch is fire-and-forget:** `tmux send-keys` injects keystrokes but provides no confirmation the worker received them. If the pane buffer is full, in copy mode, or in an unexpected state, keystrokes may be dropped silently.

**Mitigations:**
- Pane existence is verified before dispatch (catches dead panes)
- Busy timeout warning catches workers that never start (optional)
- Human is watching tmux and can intervene
- Bead stays `in_progress` so orphaned tasks are discoverable

**Future enhancement:** Could poll worker pane for expected output (e.g., "Starting task bd-xxxx") to confirm dispatch succeeded. Deferred as over-engineering for v1.

### Single Orchestrator Constraint

This design assumes a single orchestrator. Multiple orchestrators calling `submit_task` simultaneously could cause race conditions.

**Enforcement options:**
1. **Documentation** (current): Document as constraint, trust user compliance
2. **File lock**: Server acquires `/tmp/claude-bus-{project}.lock` at startup
3. **Leader election**: First orchestrator claims leadership, others get read-only access

For personal use, documentation suffices. If needed, add file lock:

```typescript
import { flockSync } from 'fs-ext'  // or similar

const lockFile = `/tmp/claude-bus-${projectHash}.lock`
const fd = fs.openSync(lockFile, 'w')
try {
  flockSync(fd, 'exnb')  // exclusive, non-blocking
} catch {
  console.error('Another claude-bus instance is running for this project')
  process.exit(1)
}
```

## Future Considerations

- Task priorities (beads supports priority field)
- Batch task submission (submit multiple bead IDs at once)
- Web dashboard for monitoring
- Worker specialization (route `/security` tasks to security-focused workers)

## Implementation Plan

| Phase | Deliverable |
|-------|-------------|
| 1 | MCP server with `submit_task`, `worker_done`, `get_status`, `reset_worker`, `retry_task` |
| 2 | Worker discovery via `tmux list-panes` + LRU selection |
| 3 | Dispatch via `/code <bead_id>` (tmux send-keys) |
| 4 | Hook `/task-complete` to call `worker_done()` |
| 5 | npm package (`claude-bus serve`) |

---

*Design Status: REVISED v3 - Fixed dispatch ordering (bead status before send-keys), added startup validation (bd/tmux version checks), busy timeout warnings, graceful shutdown with task logging, documented worker naming requirements and dispatch limitations*
