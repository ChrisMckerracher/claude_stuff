# Claude Code Bus - Design Document

## Overview

A lightweight MCP server that enables multiple Claude Code instances to coordinate work. One instance (orchestrator) creates tasks, and idle instances (workers) poll for and execute them.

**Key integration:** Uses [beads](https://github.com/steveyegge/beads) for task persistence and tracking. Tasks are git-backed, recoverable, and maintain full history.

**Interaction model:** Human-in-the-loop. Workers self-register and poll for tasks. You can chat with workers when stuck and approve at human gates. The bus solves task delegation - workers are not fully autonomous.

## Problem Statement

When running multiple Claude Code instances:
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

**Pattern: Master-Worker with Self-Registration and LRU Selection, Beads-backed tasks**

Workers self-register with the MCP server and poll for tasks. The orchestrator (master) creates beads tasks and submits them. MCP server selects the least-recently-used available worker for each task.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MCP Server (Node.js)                              │
│                                                                          │
│  Workers: (self-registered via register_worker)                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ "z.ai1" → { status: "polling", registered_at: T }                   │ │
│  │ "z.ai2" → { status: "executing", current_task: "bd-a1b2" }          │ │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  Selection: LRU (worker available longest gets next task)                │
│                                                                          │
│  MCP Tools:                                                              │
│  - register_worker(name)     → worker announces itself                   │
│  - poll_task(name, timeout)  → worker waits for task assignment          │
│  - ack_task(name, bead_id)   → worker confirms task receipt              │
│  - submit_task(bead_id)      → select LRU worker, assign task            │
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
1. Worker z.ai1 starts up:
   - Calls register_worker("z.ai1") to announce itself
   - Calls poll_task("z.ai1", 30000) and blocks waiting for task

2. Master creates task: bd create "Review auth module" --details "..."
   → returns bd-a1b2

3. Master calls submit_task("bd-a1b2")

4. MCP server:
   - Runs: bd update bd-a1b2 --status in_progress
   - Selects LRU available worker (z.ai1)
   - Resolves z.ai1's blocked poll with the task

5. z.ai1 receives task from poll_task:
   - Calls ack_task("z.ai1", "bd-a1b2") to confirm receipt
   - Runs /code bd-a1b2 to execute the task
   - Does the work (you can chat if stuck)

6. z.ai1 pauses at Pre-Commit Gate (you approve)

7. z.ai1 runs /task-complete bd-a1b2:
   - Commits, merges to epic, rebases dependents
   - Closes bead with summary
   - Calls worker_done("bd-a1b2") to notify bus

8. MCP server:
   - Marks z.ai1 available, sets available_since = now
   - Processes queue if any pending tasks

9. z.ai1 resumes polling with poll_task("z.ai1", 30000)
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

## Worker Naming Convention

Workers self-register with a name when they start up. The naming convention is flexible - workers can use any unique identifier.

**Recommended naming:** `z.ai1`, `z.ai2`, etc. for easy identification.

## Components

### 1. MCP Server (`claude-bus`)

A single Node.js process that:
- Exposes MCP tools to Claude Code instances
- Accepts worker self-registration via `register_worker`
- Assigns tasks to polling workers
- Integrates with beads for task persistence

**MCP Tools:**

| Tool | Description |
|------|-------------|
| `register_worker(name)` | Worker announces itself to the bus |
| `poll_task(name, timeout_ms)` | Worker blocks waiting for task assignment |
| `ack_task(name, bead_id)` | Worker confirms task receipt before execution |
| `submit_task(bead_id)` | Select LRU worker, assign task |
| `worker_done(bead_id)` | Mark worker available, process queue (called by `/task-complete`) |
| `task_failed(bead_id, reason)` | Mark bead blocked, free worker (when task can't complete) |
| `get_status()` | List workers, queue, and idle times |
| `reset_worker(worker_name)` | Force a stuck worker back to available |
| `retry_task(bead_id)` | Re-queue an in_progress task (for recovery) |

**State** (in-memory, worker tracking only):
```typescript
interface Worker {
  name: string                 // e.g., "z.ai1"
  status: 'idle' | 'polling' | 'executing'
  registered_at: number
  available_since: number | null
  current_task: string | null  // bead_id if executing
}

interface State {
  workers: Map<string, Worker>
  taskQueue: string[]  // bead_ids waiting for available worker
  activeBeads: Set<string>  // bead_ids currently dispatched or queued (dedup)
  blockedPollers: Map<string, BlockedPoller>  // workers waiting for tasks
}
```

**Note:** Task details live in beads (`.beads/`), not in MCP server state. Server only tracks worker availability and a lightweight queue of bead IDs.

### 2. Worker Selection (LRU)

```typescript
function selectWorker(workers: Map<string, Worker>): Worker | null {
  return Array.from(workers.values())
    .filter(w => w.status === 'polling' || w.status === 'idle')
    .sort((a, b) => a.available_since! - b.available_since!)  // oldest first
    .at(0) ?? null
}
```

When a worker becomes available, it goes to the **back** of the LRU queue (most recently available = picked last).

### 3. Worker Protocol

Workers use polling to receive tasks:

```
Worker startup:
1. register_worker("z.ai1")     → announces to bus
2. poll_task("z.ai1", 30000)    → blocks waiting for task

When task assigned (poll_task returns):
3. ack_task("z.ai1", "bd-a1b2") → confirms receipt
4. /code bd-a1b2                → executes skill

Worker's /code skill:
1. Derives epic: ${bead_id%%.*}  (e.g., bd-a1b2.1 → bd-a1b2)
2. Navigates to worktree: .worktrees/{epic}/ (if exists)
3. Claims task: bd update bd-a1b2 --status in_progress
4. Reads design doc, spawns QA in parallel
5. Implements using TDD workflow
6. Pauses at Pre-Commit Gate → human approves
7. Runs /task-complete bd-a1b2:
   - Commits work
   - Merges to epic branch
   - Rebases dependent tasks
   - Closes bead with summary
   - Notifies bus: worker_done("bd-a1b2")

After completion:
8. Resume polling with poll_task("z.ai1", 30000)
```

**Integration with existing ecosystem:** This reuses the `/code` and `/task-complete` skills rather than inventing new protocols. The only addition is `/task-complete` calling `worker_done()` at the end.

**Human gates preserved:** Workers still pause at the Pre-Commit Gate. The bus doesn't bypass human approval.

## MCP Server Implementation

See `plugin/lib/claude-bus/` for the full implementation. The server uses a polling-based architecture where workers self-register and long-poll for tasks.

Key implementation details are documented in `claude-bus-polling.md`.

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

1. **Start Claude Code** in worker instances
   - Workers self-register with `register_worker(name)`
   - Workers begin polling with `poll_task(name, timeout)`

2. **From orchestrator**, create a task and dispatch:
   ```
   Create a bead task to review the auth module for security issues, then submit it.
   ```

   Orchestrator runs:
   ```bash
   bd create "Review auth module for security issues" --details "Check for SQL injection, XSS, auth bypass..."
   # returns bd-a1b2
   ```
   Then calls `submit_task("bd-a1b2")`

3. **MCP server** marks bead in_progress, selects LRU polling worker, resolves their poll

4. **Worker** receives task from poll_task, acknowledges with `ack_task`, executes the work

5. **Worker** calls `worker_done("bd-a1b2")`
   - Bead is closed
   - Worker resumes polling

6. **Orchestrator** can verify: `bd show bd-a1b2` shows status: closed

### Monitoring

From orchestrator:
```
Show me the bus status
```

Returns:
```
Workers:
  - z.ai1: polling (idle 45s)
  - z.ai2: executing (task: bd-c3d4)

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
   → z.ai2 executing bd-c3d4, but worker is not responding

2. Reset the worker: reset_worker("z.ai2")
   → z.ai2 removed, bd-c3d4 still in_progress in beads

3. Retry the task: retry_task("bd-c3d4")
   → dispatched to z.ai1 (or queued if no workers free)
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Worker polls without registering | Error: "Unknown worker - call register_worker first" |
| Worker disconnects mid-poll | Timeout fires, worker can re-register and poll |
| Worker crashes mid-task | Task stays in `activeBeads`, can be retried with `retry_task()` |
| Task fails (worker can't complete) | Worker calls `task_failed(bead_id, reason)` to mark blocked |
| MCP server restarts | Worker state lost, but beads persist - see recovery procedure below |
| No workers available | Task queued, dispatched when polling worker becomes available |
| Bead not found | `submit_task` fails with error |
| Poll timeout | Returns `{ task: null, timeout: true }`, worker re-polls |

### MCP Server Restart Recovery

After MCP server restart, in-memory state is lost but beads persist. Recovery procedure:

1. Workers re-register and resume polling automatically
2. Orchestrator checks for orphaned tasks: `bd list --status in_progress`
3. Orchestrator calls `submit_task` for each orphaned task

### Task Failure (Worker Can't Complete)

When a worker encounters an error that prevents task completion (not a crash, but a logical failure), it calls `task_failed(bead_id, reason)`. This marks the bead as blocked, frees the worker, and processes the queue.

Orchestrator can review blocked tasks: `bd list --status blocked`

### Worker Health Check

The server tracks `task_started_at` for executing workers. Long-running tasks can be identified via `get_status()`.

**Recovery is simple:** Use `reset_worker()` + `retry_task()` to reassign work from stuck workers.

**Key insight:** Because tasks live in beads, MCP server restart is recoverable. Orchestrator can check `bd ready` or `bd list --status in_progress` to find orphaned tasks.

## Configuration

Environment variables:

```bash
CLAUDE_BUS_POLL_TIMEOUT_MS="30000"  # Default poll timeout in milliseconds
```

### Graceful Shutdown

The server handles SIGTERM/SIGINT to log state before exit, including any in-progress tasks that may need recovery.

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
| Pre-Commit | Worker pauses, waits for human approval |
| Code Review rejection | Worker iterates or flags to human |
| Architecture concern | Worker stops, flags for Architect review |

The bus doesn't bypass these - human approval is still required at all gates.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interaction model | Human-in-the-loop | Workers operate semi-autonomously, humans approve at gates |
| Worker registration | Self-registration | Workers announce themselves, no external discovery needed |
| Task dispatch | Polling-based | Workers long-poll for tasks, reliable delivery with ack |
| Dispatch format | `/code <bead_id>` | Reuses existing skill; handles worktrees, TDD, gates automatically |
| Completion signal | `/task-complete` calls `worker_done()` | Integrates with existing ecosystem; single completion path |
| Orchestrator model | Single orchestrator assumed | Simplicity; no coordination between orchestrators needed |
| MCP server lifecycle | Per-project, started by orchestrator | Server tied to project; orchestrator starts it when entering project |
| Task results | Worker closes bead with notes | Worker has context; close notes = results; `bd show` to view |

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
| 1 | MCP server with `register_worker`, `poll_task`, `ack_task` (polling tools) |
| 2 | MCP server with `submit_task`, `worker_done`, `get_status`, `reset_worker`, `retry_task` |
| 3 | LRU selection with self-reported worker state |
| 4 | Hook `/task-complete` to call `worker_done()` |
| 5 | npm package (`claude-bus serve`) |

---

*Design Status: REVISED v4 - Migrated from tmux send-keys dispatch to polling-based self-registration model. Workers self-register and long-poll for tasks. No tmux dependencies for dispatch.*
