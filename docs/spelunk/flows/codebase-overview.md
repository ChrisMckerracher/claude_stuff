---
lens: flows
focus: "high-level architecture, all features, capabilities, and user-facing functionality"
generated: 2026-01-10T18:30:00Z
source_files:
  - path: README.md
    hash: a1b2c3d4
  - path: AGENTS.md
    hash: e5f6g7h8
  - path: plugin/.claude-plugin/plugin.json
    hash: i9j0k1l2
  - path: plugin/agents/orchestrator.md
    hash: m3n4o5p6
  - path: plugin/skills/architect/SKILL.md
    hash: q7r8s9t0
  - path: plugin/skills/product/SKILL.md
    hash: u1v2w3x4
  - path: plugin/skills/qa/SKILL.md
    hash: y5z6a7b8
  - path: plugin/skills/security/SKILL.md
    hash: c9d0e1f2
  - path: plugin/skills/code/SKILL.md
    hash: g3h4i5j6
  - path: plugin/skills/spelunk/SKILL.md
    hash: k7l8m9n0
  - path: beads/README.md
    hash: o1p2q3r4
tool_chain: grep-fallback
---

# Codebase Overview: Agent Ecosystem for Claude Code

## Purpose

This codebase is a **Claude Code Plugin** that provides a productivity system for AI-assisted software development. It adds specialized agents, merge tree workflows, and invisible task tracking to Claude Code sessions.

The core value proposition: **Enable structured, multi-agent software development workflows with proper authority hierarchies, quality gates, and persistent codebase exploration.**

## Primary Users

1. **Software developers** using Claude Code for development work
2. **AI agents** (Claude instances) that need structured workflows and task tracking
3. **Development teams** wanting coordinated agent-assisted development

## Core Features

### 1. Specialist Agent System (7 Agents)

The codebase provides 7 specialized AI agents, each with specific responsibilities:

| Agent | Role | Authority Level |
|-------|------|-----------------|
| **Orchestrator** | Routes requests to appropriate agents, manages status | Coordinator |
| **Architecture Agent** | Drafts designs with human, analyzes codebase structure | Highest (below human) |
| **Product Agent** | Validates designs match product goals, creates PRDs | Peer |
| **Coding Agent** | Implements tasks using TDD workflow | Peer |
| **QA Agent** | Generates tests from specs, analyzes coverage | Peer |
| **Code Review Agent** | Reviews code for style/quality, can block merge | Gatekeeper |
| **Security Agent** | Audits for OWASP, secrets, CVEs, has VETO power | VETO authority |

**Authority Hierarchy:**
```
Human (ultimate authority)
    |
Architecture Agent (drafts design first)
    |
Security Agent (VETO power)
    |
Product / Coding / QA (peer consensus)
    |
Code Review Agent (gatekeeper)
```

### 2. Spelunk System (Persistent Codebase Exploration)

A cache-based exploration system that enables:

- **Lens-based exploration** - Focus on specific aspects:
  - `interfaces` - Type definitions and class signatures
  - `flows` - Execution paths and data flow
  - `boundaries` - Module exports and dependencies
  - `contracts` - Validation schemas and API contracts
  - `trust-zones` - Auth checks and security boundaries

- **Hash-based cache validation** - Documents validated against SHA-256 hashes
- **Staleness detection** - FRESH/STALE/MISSING/ORPHANED status
- **Cross-session persistence** - Findings survive between sessions
- **Multi-agent sharing** - Agents reuse each other's exploration results

**Output location:** `docs/spelunk/{lens}/{focus-slug}.md`

### 3. Merge Tree Workflows

Features decompose into dependent tasks forming a tree structure:

```
        [Feature Complete]           <- root
              /    \
       [Auth Done]  [UI Done]        <- merge points
        /    \        /    \
    [login] [logout] [form] [styles] <- leaves (parallelizable)
```

**Key capabilities:**
- Leaves execute in parallel
- Parent tasks unblock when all children complete
- Target: 500 lines per task (max 1000)
- Automatic progress tracking via beads

### 4. Dashboard (Web UI)

A localhost web interface at port 3847 that provides:

- **Task visualization** - View all beads tasks with status
- **Git diff viewer** - See changes against main branch
- **Repository status** - Branch, uncommitted changes, ahead/behind counts
- **Real-time updates** - Monitor progress during development

### 5. GitLab Integration

Commands for GitLab MR workflow:

- `/gitlab-pull-comments` - Fetch MR feedback into context
- `/gitlab-push-mr` - Create/update MRs from current branch

Requires `GITLAB_TOKEN` and optionally `GITLAB_HOST` environment variables.

### 6. Quality Gates and Hooks

**Session Start Hook:**
- Automatically shows ready tasks when starting a Claude session
- Runs when entering a project with beads initialized

**Pre-Push Security Hook:**
- Scans for secrets (password, api_key, token patterns)
- Blocks .env files and private keys (.pem, .key)
- Security Agent has VETO power to block pushes

### 7. Task Tracking (via Beads)

Invisible task infrastructure using [beads](https://github.com/steveyegge/beads):

- **Git-backed storage** - Tasks stored as JSONL in `.beads/`
- **Hash-based IDs** - Zero merge conflicts (e.g., `bd-a1b2`)
- **Dependency tracking** - Blocking dependencies affect ready queue
- **Hierarchical IDs** - Epic/task/subtask structure (e.g., `bd-a3f8.1.1`)

Users see "tasks" not "beads" - the CLI details are abstracted away.

## Available Commands (15 Total)

| Command | Purpose |
|---------|---------|
| `/orchestrator` | Route requests to appropriate agents |
| `/architect` | Start design session, analyze architecture |
| `/product` | Validate design, create PRD, examine product |
| `/code` | Implement next ready task (TDD) |
| `/qa` | Generate tests from specs |
| `/review` | Code review for style/quality |
| `/security` | Security audit (OWASP, secrets, CVEs) |
| `/decompose` | Break feature into merge tree |
| `/visualize` | Show task tree with progress |
| `/merge-up` | Merge completed children to parent |
| `/rebalance` | Split large tasks, consolidate small ones |
| `/dashboard` | Open web UI at localhost:3847 |
| `/gitlab-pull-comments` | Fetch MR feedback |
| `/gitlab-push-mr` | Create/update MR |
| `/update-claude` | Update CLAUDE.md with feedback |

## Examine Modes

Most agents support an `examine` mode for read-only exploration:

- `/architect examine` - Analyze codebase structure
- `/product examine` - Understand what problem codebase solves
- `/code examine` - Analyze code relationships
- `/qa examine` - Analyze test coverage

## Typical Workflow

The recommended development flow:

```
1. /architect          -> Co-design with human
2. /product            -> Validate design
3. /decompose          -> Create task tree
4. /visualize          -> See what's ready
5. /code               -> Implement task (TDD)
6. /review             -> Check quality
7. /security           -> Security gate
8. /merge-up           -> Merge to parent
9. Repeat 4-8 until done
```

## Human Validation Gates (3 Mandatory)

1. **Design Review** - After architect writes design doc
2. **Pre-Implementation** - After decompose creates task tree
3. **Pre-Commit** - After implementation complete

**Rules:** Never skip gates, never assume approval from silence.

## Documentation Layer Principle

Agents are divided into two layers:

**Documentation-layer agents:** Architecture, Product, QA
- Read from `docs/`, README, config files
- Do NOT read source code directly
- Delegate to spelunk when they need codebase info

**Code-layer agents:** Coding, Security
- Full access to source code
- Write findings to `docs/spelunk/` for other agents

## Dependencies

- **beads** (bd CLI) - Git-backed task tracking
- **Claude Code** - Anthropic's CLI for Claude
- **jq** - JSON processing for hooks
- **glab** (optional) - GitLab CLI for MR operations

## Installation

1. Clone the repository
2. Run `./scripts/install-ecosystem.sh`
3. Add plugin to `~/.claude/settings.json`
4. Verify with `./scripts/test-ecosystem.sh`

## Plugin Structure

```
plugin/
├── .claude-plugin/plugin.json    # Plugin metadata
├── agents/                       # Agent system prompts (7)
├── commands/                     # Slash commands (15)
├── skills/                       # Skill definitions (14)
├── lib/spelunk/                  # TypeScript spelunk implementation
├── dashboard/                    # Web UI (Express server)
├── hooks/                        # Session and pre-push hooks
└── templates/                    # Design doc and MR templates
```

## Key Value Propositions

1. **Structured agent workflows** - Not ad-hoc AI assistance, but proper authority hierarchies
2. **Persistent context** - Spelunk docs survive sessions, shared across agents
3. **Quality enforcement** - Security VETO, code review gates, mandatory human approval
4. **Invisible task management** - Users see "tasks" not CLI commands
5. **Parallel execution** - Merge tree enables concurrent agent work
6. **Token efficiency** - Hash-based cache avoids redundant exploration
