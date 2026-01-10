# Agent Ecosystem for Claude Code

A productivity system for Claude Code built on specialized agents, merge tree workflows, and invisible task tracking via [beads](https://github.com/steveyegge/beads).

> **This is a Claude Code Plugin** - Install it to add specialized agents, spelunking, and workflow automation to your Claude Code sessions.

## Overview

This plugin provides:

- **7 Specialist Agents** - Orchestrator, Architecture, Product, Coding, QA, Code Review, Security
- **Spelunk System** - Persistent codebase exploration with hash-based cache validation
- **Dashboard** - Web UI for visualizing tasks and git diffs (localhost:3847)
- **Merge Tree Workflows** - Decompose features into dependent tasks, track progress
- **Invisible Task Tracking** - Beads infrastructure hidden from user (you see "tasks", not `bd` commands)
- **GitLab Integration** - Pull MR comments, push MRs, sync feedback
- **Quality Gates** - Automatic security and code review hooks
- **15 Commands** - Direct agent invocation and workflow management

## Installation

### Quick Install

```bash
# Clone this repo
git clone git@github.com:ChrisMckerracher/claude_stuff.git
cd claude_stuff

# Run the install script
./scripts/install-ecosystem.sh
```

This will:
1. Install [beads](https://github.com/steveyegge/beads) (`bd` CLI)
2. Create symlink at `~/.claude/plugins/local/agent-ecosystem/` → `./plugin/`

### Enable the Plugin

Add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Bash(npm:*)", "Bash(npx:*)", "Bash(bd:*)"]
  },
  "enabledPlugins": {
    "agent-ecosystem@local": true
  }
}
```

### Verify Installation

```bash
./scripts/test-ecosystem.sh
```

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
- **Hash-based cache validation** - Documents are validated against SHA-256 hashes of source files
- **Automatic staleness detection** - Know instantly if a spelunk doc is FRESH, STALE, MISSING, or ORPHANED

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
4. **FRESH**: All hashes match → reuse the document (saves tokens)
5. **STALE**: Hash mismatch → regenerate only stale sections

This enables:
- Cross-session knowledge persistence
- Multi-agent sharing of exploration results
- Automatic invalidation when code changes
- Significant token savings on large codebases

### Typical Workflow

```
1. /architect          → Co-design with human
2. /product            → Validate design
3. /decompose          → Create task tree
4. /visualize          → See what's ready
5. /code               → Implement task (TDD)
6. /review             → Check quality
7. /security           → Security gate
8. /merge-up           → Merge to parent
9. Repeat 4-8 until done
```

## Architecture

### Authority Hierarchy

```
                [Human]
                   ↑ (ultimate authority)
                   |
          [Architecture Agent]  ← drafts design first
                   |
            [Security Agent]    ← VETO power
                   |
    ┌──────────────┼──────────────┐
    ↓              ↓              ↓
[Product]     [Coding]        [QA]     ← peer consensus
    |              |              |
    └──────────────┴──────────────┘
                   ↓
         [Code Review Agent]    ← gatekeeper
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

### Merge Tree Concept

Features decompose into dependent tasks forming a tree:

```
        [Feature Complete]           ← root
              /    \
       [Auth Done]  [UI Done]        ← merge points
        /    \        /    \
    [login] [logout] [form] [styles] ← leaves (parallelizable)
```

- Leaves execute in parallel
- When all children complete, merge up
- Target: 500 lines per task (max 1000)
- Beads tracks dependencies invisibly

## Plugin Structure

This is a valid Claude Code plugin. The structure:

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
├── commands/                        # Slash commands (15 total)
│   ├── orchestrator.md
│   ├── architect.md
│   ├── product.md
│   ├── code.md
│   ├── qa.md
│   ├── review.md
│   ├── security.md
│   ├── decompose.md
│   ├── visualize.md
│   ├── merge-up.md
│   ├── rebalance.md
│   ├── dashboard.md
│   ├── gitlab-pull-comments.md
│   ├── gitlab-push-mr.md
│   └── update-claude.md
├── skills/                          # Skills (14 total)
│   ├── architect/SKILL.md
│   ├── product/SKILL.md
│   ├── code/SKILL.md
│   ├── qa/SKILL.md
│   ├── review/SKILL.md
│   ├── security/SKILL.md
│   ├── spelunk/SKILL.md             # Codebase exploration
│   ├── decompose/SKILL.md
│   ├── visualize/SKILL.md
│   ├── merge-up/SKILL.md
│   ├── rebalance/SKILL.md
│   ├── gitlab-pull-comments/SKILL.md
│   ├── gitlab-push-mr/SKILL.md
│   └── update-claude/SKILL.md
├── lib/                             # TypeScript utilities
│   └── spelunk/                     # Spelunk implementation
│       ├── persistence.ts           # Write docs, hash computation
│       ├── staleness-check.ts       # FRESH/STALE/MISSING/ORPHANED
│       ├── orchestrator.ts          # Coordination logic
│       ├── types.ts                 # Type definitions
│       └── *.test.ts                # Test coverage
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

## GitLab Integration

### Requirements

```bash
export GITLAB_TOKEN="your-token"
export GITLAB_HOST="https://gitlab.com"  # or your self-hosted instance
```

### Commands

```bash
/gitlab pull-comments        # Fetch MR comments for current branch
/gitlab pull-comments 123    # Fetch comments for MR #123
/gitlab push-mr              # Create MR for current branch
/gitlab push-mr update       # Update existing MR description
```

## Templates

### Design Doc

Used by `/architect` when creating designs:
- Goal, Background, Approach
- Alternatives Considered
- Components with scope
- Task Breakdown table
- Success Criteria

### MR Description

Used by `/gitlab push-mr`:
- Summary, Changes
- Related Tasks (with bead tracking)
- Test Plan
- Checklist

## Dependencies

- [beads](https://github.com/steveyegge/beads) - Git-backed task tracking for AI agents
- [Claude Code](https://claude.ai/code) - Anthropic's CLI for Claude
- `jq` - JSON processing (for hooks)
- `glab` (optional) - GitLab CLI for MR operations

## Development

### Running Tests

```bash
./scripts/test-ecosystem.sh
```

### Scripts

| Script | Purpose |
|--------|---------|
| `install-ecosystem.sh` | Full installation (beads + plugin) |
| `setup-plugin.sh` | Create plugin structure only |
| `test-ecosystem.sh` | Verify installation |

## License

MIT

## Credits

- [beads](https://github.com/steveyegge/beads) by Steve Yegge - Task tracking infrastructure
- [superpowers](https://github.com/obra/superpowers) by Jesse Vincent - Skill patterns and TDD workflow
