# Claude-Bus

> Lightweight orchestration for parallel multi-agent execution.

![Claude-Bus Demo](../assets/claude-bus-demo.gif)

---

## Overview

**The core idea:** Opus does deep planning and task breakdown. Cheaper models (or proxied instances) execute in parallel.

**Key distinction: These are interactive sessions, not background jobs.** Workers are full Claude Code sessions - you can watch them execute, intervene at human gates, and interact with any worker directly while others continue working.

```
┌─────────────────┐
│  Orchestrator   │  Opus - plans, decomposes, coordinates
└────────┬────────┘
         │ submit tasks
         ▼
┌─────────────────────────────────────┐
│           Claude-Bus                 │
└─────────────────────────────────────┘
         │ dispatch to LRU worker
    ┌────┼────┬────┐
    ▼    ▼    ▼    ▼
  ┌───┐┌───┐┌───┐┌───┐  Cheaper models / proxied instances
  │ W ││ W ││ W ││ W │  Interactive sessions you can engage with
  └───┘└───┘└───┘└───┘
```

**Why this matters:**
- **Interactive, not fire-and-forget** - Watch progress, intervene when needed, maintain control
- **Cost efficiency** - Opus plans once, cheaper models execute many tasks
- **Parallelism** - Multiple workers execute simultaneously
- **Quality** - Opus's sophisticated task decomposition means workers get well-scoped work

Claude-Bus coordinates multiple Claude Code instances as parallel workers. An orchestrator submits tasks, workers poll for work, execute, and signal completion.

**Key Features:**
- **External daemon** - Shared state across all Claude instances
- **Long-polling** - Workers wait efficiently for tasks (no busy-loops)
- **LRU dispatch** - Tasks go to least-recently-used available worker
- **Auto-start** - Daemon spawns automatically when needed

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Claude-Bus Daemon                         │
│                                                                  │
│  Workers:           Task Queue:        Blocked Pollers:          │
│  ┌──────────────┐   ┌────────────┐    ┌──────────────────┐      │
│  │ z.ai1: idle  │   │ task-123   │    │ z.ai2: waiting   │      │
│  │ z.ai2: poll  │   │ task-456   │    │ z.ai3: waiting   │      │
│  │ z.ai3: exec  │   └────────────┘    └──────────────────┘      │
│  └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
    ┌────┴────┐          ┌────┴────┐          ┌────┴────┐
    │ Worker  │          │ Worker  │          │ Worker  │
    │ z.ai1   │          │ z.ai2   │          │ z.ai3   │
    └─────────┘          └─────────┘          └─────────┘
```

1. **Daemon** maintains shared state (workers, queue, blocked pollers)
2. **Workers** connect via Unix socket, register, and long-poll for tasks
3. **Orchestrator** submits tasks; daemon dispatches to available workers
4. **Workers** acknowledge, execute, and signal completion

---

## Quick Start

### As Orchestrator

```typescript
// Submit a task
mcp__claude-bus__submit_task({ bead_id: "task-123" })
// -> { dispatched: true, worker: "z.ai1", bead_id: "task-123" }

// Check status
mcp__claude-bus__get_status()
// -> { workers: [...], queued_tasks: 2, polling_workers: 1 }
```

### As Worker

```typescript
// 1. Register
mcp__claude-bus__register_worker({ name: "z.ai1" })

// 2. Poll (blocks until task or timeout)
mcp__claude-bus__poll_task({ name: "z.ai1", timeout_ms: 30000 })
// -> { task: { bead_id: "task-123", ... } }

// 3. Acknowledge
mcp__claude-bus__ack_task({ name: "z.ai1", bead_id: "task-123" })

// 4. Execute your task...

// 5. Signal completion
mcp__claude-bus__worker_done({ bead_id: "task-123" })

// 6. Resume polling
mcp__claude-bus__poll_task({ name: "z.ai1", timeout_ms: 30000 })
```

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `register_worker(name)` | Register a worker with the bus |
| `poll_task(name, timeout_ms)` | Long-poll for task assignment (blocks) |
| `ack_task(name, bead_id)` | Acknowledge task receipt before execution |
| `submit_task(bead_id)` | Submit a task for dispatch to available worker |
| `worker_done(bead_id)` | Signal task completion |
| `task_failed(bead_id, reason)` | Signal task failure |
| `get_status()` | Get current bus state (workers, queue) |
| `reset_worker(worker_name)` | Force stuck worker back to available |
| `retry_task(bead_id)` | Re-queue an in-progress task |

---

## Worker States

```
┌─────────┐  register   ┌─────────┐  poll_task   ┌─────────┐
│  (new)  │ ──────────> │  idle   │ ───────────> │ polling │
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

| State | Meaning |
|-------|---------|
| `idle` | Registered but not polling |
| `polling` | Waiting for task (blocked) |
| `pending` | Task assigned, awaiting ack |
| `executing` | Task acknowledged, in progress |

---

## Configuration

### Socket Path

The daemon creates a Unix socket per project directory:

```
/tmp/claude-bus-{hash}.sock
```

Where `{hash}` is the first 8 characters of the MD5 hash of the project root path.

### Timeouts

| Setting | Default | Description |
|---------|---------|-------------|
| Poll timeout | 5 seconds | How long workers wait before re-polling |
| Task timeout | 30 minutes | Max time before stuck task returns to queue |
| Reconnect retries | 3 | MCP client reconnection attempts |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Worker polls without registering | Error: "Unknown worker - call register_worker first" |
| Worker disconnects mid-poll | Timeout fires, worker can re-poll |
| Worker crashes during execution | Task stays active, use `retry_task` to re-queue |
| Daemon not running | MCP auto-starts daemon |
| Poll timeout | Returns `{ task: null, timeout: true }` |

---

## Learn More

- [Architecture](architecture.md) - External daemon design, IPC protocol
- [Worker Protocol](worker-protocol.md) - Detailed worker lifecycle

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Workers not appearing in status | Ensure `register_worker` called before `poll_task` |
| Tasks not dispatching | Check if workers are in `polling` state |
| "Daemon not running" | Will auto-start; or manually: `claude-bus start` |
| Stuck worker | Use `reset_worker(name)` to force idle |
