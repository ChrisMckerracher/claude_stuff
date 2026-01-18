# Agent Ecosystem + Claude-Bus

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blue.svg)](https://claude.ai/code)

Two tools for AI-assisted software development with [Claude Code](https://claude.ai/code).

---

## Agent Ecosystem

> 7 specialized AI agents that design, implement, review, and ship code.

**Agents:** Orchestrator, Architecture, Product, Coding, QA, Code Review, Security

**Features:**
- Merge tree workflows for parallel task execution
- Persistent codebase exploration (spelunk)
- Invisible task tracking via [beads](https://github.com/steveyegge/beads)
- GitLab integration

```bash
/architect    # Co-design with human
/decompose    # Break into parallel tasks
/code         # Implement (TDD)
/review       # Quality gate
```

[Full Documentation](docs/agent-ecosystem/README.md)

---

## Claude-Bus

> Lightweight orchestration for parallel multi-agent execution.

![Claude-Bus Demo](docs/assets/claude-bus-demo.gif)

**The idea:** Opus does deep planning and task breakdown. Cheaper models (or proxied instances) execute in parallel.

**Key distinction: These are interactive sessions, not background jobs.** You can watch workers execute, intervene at human gates, and interact with any worker directly while others continue working.

```
┌─────────────────┐
│  Orchestrator   │  Opus - plans, decomposes, coordinates
└────────┬────────┘
         │ submit tasks
         ▼
┌─────────────────────────────────────┐
│           Claude-Bus                 │
└─────────────────────────────────────┘
         │ dispatch
    ┌────┼────┬────┐
    ▼    ▼    ▼    ▼
  ┌───┐┌───┐┌───┐┌───┐  Cheaper models / proxied instances
  │ W ││ W ││ W ││ W │  Interactive sessions you can engage with
  └───┘└───┘└───┘└───┘
```

**Architecture:** External daemon with Unix socket IPC. Workers long-poll for tasks, acknowledge receipt, execute, and signal completion.

```
Orchestrator                    Workers
     |                         /   |   \
     +-- submit_task -------> z.ai1 z.ai2 z.ai3
                               |     |     |
                            poll   poll   poll
                               |     |     |
                            execute tasks in parallel
```

```bash
# Start workers, then from orchestrator:
mcp__claude-bus__submit_task(bead_id: "task-123")
# -> Dispatched to least-recently-used available worker
```

[Full Documentation](docs/claude-bus/README.md)

---

## Quick Start

### Agent Ecosystem

```bash
/plugin marketplace add https://github.com/ChrisMckerracher/claude_stuff
/plugin install agent-ecosystem
```

### Claude-Bus

The bus daemon auto-starts when needed. Workers register and poll:

```bash
# In worker session:
mcp__claude-bus__register_worker(name: "z.ai1")
mcp__claude-bus__poll_task(name: "z.ai1", timeout_ms: 30000)
```

---

## Requirements

- [Claude Code](https://claude.ai/code) 2.0.74+
- [beads](https://github.com/steveyegge/beads) - `go install github.com/steveyegge/beads/cmd/bd@latest`
- Node.js 18+

---

## License

MIT
