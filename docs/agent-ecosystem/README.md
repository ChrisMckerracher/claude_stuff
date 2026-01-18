# Agent Ecosystem for Claude Code

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blue.svg)](https://claude.ai/code)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

> **Orchestrate AI agents for software development.** Design, implement, review, and ship with 7 specialized agents that collaborate through merge tree workflows.

A [Claude Code](https://claude.ai/code) plugin providing specialized agents, persistent codebase exploration, and invisible task tracking via [beads](https://github.com/steveyegge/beads).

## Overview

This plugin provides:

- **7 Specialist Agents** - Orchestrator, Architecture, Product, Coding, QA, Code Review, Security
- **Spelunk System** - Persistent codebase exploration with hash-based cache validation
- **Dashboard** - Web UI for visualizing tasks and git diffs (localhost:3847)
- **Merge Tree Workflows** - Decompose features into dependent tasks, track progress
- **Invisible Task Tracking** - Beads infrastructure hidden from user (you see "tasks", not `bd` commands)
- **GitLab Integration** - Pull MR comments, push MRs, sync feedback
- **Quality Gates** - Automatic security and code review hooks
- **16 Commands** - Direct agent invocation and workflow management

---

## Installation

```bash
/plugin marketplace add https://github.com/ChrisMckerracher/claude_stuff
/plugin install agent-ecosystem
```

Requires [beads](https://github.com/steveyegge/beads) for task tracking:

```bash
go install github.com/steveyegge/beads/cmd/bd@latest
```

### LSP Support

LSP is **enabled by default** in Claude Code 2.0.74+. No configuration required.

**Benefits:** Accurate type definitions, find references, cross-references, and navigation.

**Supported Languages:** TypeScript (vtsls), Python (pyright), Go (gopls), Rust (rust-analyzer), Java (jdtls), C/C++ (clangd).

**If LSP isn't working:** Ensure you're on Claude Code 2.0.74+:
```bash
npm install -g @anthropics/claude-code@latest
```

**Fallback:** When LSP is unavailable, spelunk uses ast-grep/semgrep (if installed) or grep-based search.

---

## Usage

### Commands

Commands invoke agents and workflows directly:

| Command | Purpose |
|---------|---------|
| `/orchestrator` | Route requests to appropriate agents |
| `/architect` | Start design session, analyze architecture |
| `/product` | Validate design matches product goals |
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
| `/verify` | Create custom verification cycles |

### Agent Examine Mode

Most agents support an `examine` mode for exploring the codebase without taking action:

| Command | Purpose |
|---------|---------|
| `/architect examine` | Analyze codebase structure |
| `/product examine` | Understand what problem codebase solves |
| `/code examine` | Analyze code relationships |
| `/qa examine` | Analyze test coverage |

### Spelunk System

The spelunk system enables persistent codebase exploration that survives across sessions and can be shared between agents.

**Key Features:**
- **Lens-based exploration** - Focus on specific aspects: `interfaces`, `flows`, `boundaries`, `contracts`, `trust-zones`
- **LSP-powered code intelligence** - Accurate symbol resolution (enabled by default in Claude Code 2.0.74+)
- **Hash-based cache validation** - Documents are validated against SHA-256 hashes of source files
- **Automatic staleness detection** - Know instantly if a spelunk doc is FRESH, STALE, MISSING, or ORPHANED

**LSP Mode vs Fallback:**

| Aspect | LSP Mode | Fallback Mode |
|--------|----------|---------------|
| **Accuracy** | Precise symbol parsing with full type information | Pattern-based search (may miss complex constructs) |
| **Speed** | Fast (native language servers) | Slower (text scanning) |
| **Requirements** | Claude Code 2.0.74+ (default) | No setup required |
| **Operations** | documentSymbol, findReferences, hover, goToDefinition | grep patterns, ast-grep/semgrep |
| **Best for** | Production use, large codebases | Quick exploration, older Claude versions |

**How Hash Validation Works:**

When a spelunk document is generated, each analyzed source file gets an 8-character SHA-256 hash stored in `docs/spelunk/_staleness.json`:

```json
{
  "version": 1,
  "docs": {
    "contracts/authentication-layer.md": {
      "generated": "2024-01-15T10:30:00Z",
      "source_files": {
        "src/auth/handler.ts": "a1b2c3d4",
        "src/auth/types.ts": "e5f6g7h8"
      }
    }
  }
}
```

When an agent needs codebase knowledge:
1. Check if a spelunk doc exists for the lens+focus
2. Recompute current file hashes
3. Compare against stored hashes
4. **FRESH**: All hashes match - reuse the document (saves tokens)
5. **STALE**: Hash mismatch - regenerate only stale sections

This enables:
- Cross-session knowledge persistence
- Multi-agent sharing of exploration results
- Automatic invalidation when code changes
- Significant token savings on large codebases

### Typical Workflow

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

### Human Validation Gates

The workflow includes 3 mandatory approval points where agents pause for human confirmation:

| Gate | When | Agent Says |
|------|------|------------|
| **Design Review** | After architect writes design doc | "Design draft complete. Review and approve/revise/discuss." |
| **Pre-Implementation** | After decompose creates task tree | "Task tree created. Want me to spawn N Coding Agents?" |
| **Pre-Commit** | After implementation complete | "Ready to commit?" |

**Rules:**
- Agents never skip mandatory gates
- Silence is not approval - agents wait for explicit response
- Human can always request changes or discussion at any gate

---

## Architecture

### Authority Hierarchy

```
                [Human]
                   ^ (ultimate authority)
                   |
          [Architecture Agent]  <- drafts design first
                   |
            [Security Agent]    <- VETO power
                   |
    +--------------+--------------+
    v              v              v
[Product]     [Coding]        [QA]     <- peer consensus
    |              |              |
    +--------------+--------------+
                   v
         [Code Review Agent]    <- gatekeeper
```

### Agent Responsibilities

| Agent | Mode | Responsibility |
|-------|------|----------------|
| **Orchestrator** | Route | Routes requests to appropriate agents |
| | Status | Shows ready tasks, progress, blockers |
| **Architecture** | Examine | Analyze codebase structure, patterns, boundaries |
| | Execute | Co-draft designs, decompose into merge trees |
| **Product** | Examine | Understand what problem codebase solves (uses spelunk) |
| | Execute | Validate designs match product expectations |
| **Coding** | Examine | Map code relationships, find relevant code |
| | Execute | Implement tasks using TDD workflow |
| **QA** | Examine | Analyze test coverage and patterns |
| | Execute | Generate tests from specs |
| **Code Review** | Examine | Check style guide compliance |
| | Execute | Review changes, can **block merge** |
| **Security** | Examine | OWASP audit, secrets detection, CVE check |
| | Execute | Audit changes, has **VETO power** |

### Agent Layer Constraints

Agents operate at different abstraction layers with different access rights:

**Documentation-layer agents:** Architect, Product, QA
- Read from `docs/`, `README.md`, config files
- Cannot read source code directly (`src/**`, `lib/**`, `*.ts`, `*.py`)
- Delegate to Coding Agent via spelunk when needing codebase info

**Code-layer agents:** Coding, Security
- Full access to source code
- Write findings to `docs/spelunk/` for documentation-layer agents

This separation ensures:
- Correct abstraction level for each agent's role
- Accumulated knowledge via spelunk docs
- Efficient context usage (no raw code in design discussions)

### Merge Tree Concept

Features decompose into dependent tasks forming a tree:

```
        [Feature Complete]           <- root
              /    \
       [Auth Done]  [UI Done]        <- merge points
        /    \        /    \
    [login] [logout] [form] [styles] <- leaves (parallelizable)
```

- Leaves execute in parallel
- When all children complete, merge up
- Target: 500 lines per task (max 1000)
- Beads tracks dependencies invisibly

---

## Plugin Structure

```
plugin/                              # <- Plugin root
├── .claude-plugin/
│   └── plugin.json                  # Plugin metadata and hooks
├── agents/                          # Agent system prompts
│   ├── orchestrator.md
│   ├── architecture.md
│   ├── product.md
│   ├── coding.md
│   ├── qa.md
│   ├── code-review.md
│   └── security.md
├── commands/                        # Slash commands (16 total)
├── skills/                          # Skills (17 total)
├── lib/                             # TypeScript utilities
│   └── spelunk/                     # Spelunk implementation
├── hooks/
│   ├── session-start.sh
│   ├── pre-push-security.sh
│   └── README.md
└── templates/
    ├── design-doc.md
    └── mr-description.md
```

When installed, spelunk documents are written to your project's `docs/spelunk/` directory:

```
your-project/
└── docs/spelunk/
    ├── _staleness.json              # Hash validation index
    ├── contracts/                   # API contracts, interfaces
    ├── flows/                       # Data and control flows
    ├── boundaries/                  # Module boundaries
    ├── interfaces/                  # Public interfaces
    └── trust-zones/                 # Security boundaries
```

---

## Hooks

### Session Start Hook

Automatically shows ready tasks when starting a Claude session in a project with beads:

```
Project has beads task tracking. 3 task(s) ready to work on.
Use /visualize to see full task tree.
```

### Pre-Push Security Hook

Runs security checks before push:
- Scans for secrets (password, api_key, token patterns)
- Blocks .env files
- Blocks private key files (.pem, .key)

### Enabling Hooks

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

See `hooks/README.md` for full configuration.

---

## GitLab Integration

### Requirements

```bash
export GITLAB_TOKEN="your-token"
export GITLAB_HOST="https://gitlab.com"  # or your self-hosted instance
```

### Commands

```bash
/gitlab-pull-comments        # Fetch MR comments for current branch
/gitlab-pull-comments 123    # Fetch comments for MR #123
/gitlab-push-mr              # Create MR for current branch
/gitlab-push-mr --update     # Update existing MR description
```

---

## Dashboard

The web dashboard provides task visualization and git diff viewing at `http://localhost:3847`.

### Starting the Dashboard

```bash
/dashboard                   # Start dashboard (opens in browser)
```

The dashboard displays:
- **Task Tree** - All beads tasks with status (ready/blocked/complete)
- **Git Diff** - Changes against main branch
- **Repository Status** - Branch info, uncommitted changes

---

## Troubleshooting

### Spelunk Issues

| Problem | Solution |
|---------|----------|
| Spelunk shows "grep fallback" warning | Update Claude Code: `npm install -g @anthropics/claude-code@latest` |
| Inaccurate symbol results | Install language server for your project's language |
| Slow spelunk performance | Use `--max-files` to limit scope, or ensure LSP is working |
| Stale spelunk documents | Use `--refresh` flag to force regeneration |

### GitLab Integration

| Problem | Solution |
|---------|----------|
| `GITLAB_TOKEN not set` | Set token: `export GITLAB_TOKEN="your-token"` |
| MR creation fails | Verify `GITLAB_HOST` is set correctly for self-hosted instances |
| Comments not appearing | Use `/gitlab-pull-comments --refresh` to sync latest feedback |

---

## Dependencies

### Required

- [beads](https://github.com/steveyegge/beads) - Git-backed task tracking for AI agents
- [Claude Code](https://claude.ai/code) - Anthropic's CLI for Claude
- Node.js 18+ (required for dashboard and TypeScript tooling)
- `jq` - JSON processing (for hooks)

### Optional

- `glab` - GitLab CLI for MR operations
- Language servers for LSP-powered spelunking:
  - **TypeScript/JavaScript:** `npm install -g typescript-language-server` (vtsls)
  - **Python:** `npm install -g pyright`
  - **Go:** `go install golang.org/x/tools/gopls@latest`
  - **Rust:** `rustup component add rust-analyzer`
  - **Java:** [Eclipse JDT.LS](https://download.eclipse.org/jdtls/snapshots/)
  - **C/C++:** [clangd](https://clangd.llvm.org/installation)

---

## Credits

- [beads](https://github.com/steveyegge/beads) by Steve Yegge - Task tracking infrastructure
- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent - Skill patterns and TDD workflow
