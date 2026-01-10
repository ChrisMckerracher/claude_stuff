# Agent Ecosystem for Claude Code

A productivity system for Claude Code built on specialized agents, merge tree workflows, and invisible task tracking via [beads](https://github.com/steveyegge/beads).

## Overview

This plugin provides:

- **6 Specialist Agents** - Architecture, Product, Coding, QA, Code Review, Security
- **Orchestrator** - Routes requests to appropriate agents based on authority hierarchy
- **Merge Tree Workflows** - Decompose features into dependent tasks, track progress
- **Invisible Task Tracking** - Beads infrastructure hidden from user (you see "tasks", not `bd` commands)
- **GitLab Integration** - Pull MR comments, push MRs, sync feedback
- **Quality Gates** - Automatic security and code review hooks

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
2. Create the plugin structure at `~/.claude/plugins/local/agent-ecosystem/`

### Enable the Plugin

Add to `~/.claude/settings.json`:

```json
{
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

### Skills (Commands)

| Skill | Purpose |
|-------|---------|
| `/architect` | Start design session, analyze architecture |
| `/architect examine` | Analyze codebase structure |
| `/architect decompose` | Break design into task tree |
| `/product` | Validate design matches product goals |
| `/product examine` | Understand what problem codebase solves |
| `/code` | Implement next ready task (TDD) |
| `/code examine` | Analyze code relationships |
| `/qa` | Generate tests from specs |
| `/qa examine` | Analyze test coverage |
| `/review` | Code review for style/quality |
| `/security` | Security audit (OWASP, secrets, CVEs) |
| `/decompose` | Break feature into merge tree |
| `/visualize` | Show task tree with progress |
| `/merge-up` | Merge completed children to parent |
| `/rebalance` | Split large tasks, consolidate small ones |
| `/gitlab pull-comments` | Fetch MR feedback |
| `/gitlab push-mr` | Create/update MR |
| `/update-claude` | Update CLAUDE.md with feedback |

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
| **Architecture** | Examine | Analyze codebase structure, patterns, boundaries |
| | Execute | Co-draft designs, decompose into merge trees |
| **Product** | Examine | Understand what problem codebase solves (ignores code quality) |
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

```
~/.claude/plugins/local/agent-ecosystem/
├── .claude-plugin/
│   └── plugin.json
├── agents/
│   ├── orchestrator.md
│   ├── architecture.md
│   ├── product.md
│   ├── coding.md
│   ├── qa.md
│   ├── code-review.md
│   └── security.md
├── skills/
│   ├── architect/SKILL.md
│   ├── product/SKILL.md
│   ├── code/SKILL.md
│   ├── qa/SKILL.md
│   ├── review/SKILL.md
│   ├── security/SKILL.md
│   ├── decompose/SKILL.md
│   ├── visualize/SKILL.md
│   ├── merge-up/SKILL.md
│   ├── rebalance/SKILL.md
│   ├── gitlab/
│   │   ├── pull-comments/SKILL.md
│   │   └── push-mr/SKILL.md
│   └── update-claude/SKILL.md
├── hooks/
│   ├── session-start.sh
│   ├── pre-push-security.sh
│   └── README.md
└── templates/
    ├── design-doc.md
    └── mr-description.md
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
