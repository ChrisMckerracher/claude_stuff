# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project Overview

Agent Ecosystem is a Claude Code plugin providing 7 specialized AI agents for software development workflows. It uses beads for task tracking and merge tree workflows for feature decomposition.

**Key Components:**
- **7 Specialist Agents:** Orchestrator, Architecture, Product, Coding, QA, Code Review, Security
- **Spelunk System:** Persistent codebase exploration with hash-based cache validation
- **Merge Tree Workflows:** Decompose features into dependent tasks
- **GitLab Integration:** Pull MR comments, push MRs

## Build and Test Commands

```bash
# Run all tests
./scripts/test-ecosystem.sh

# Dashboard (TypeScript)
cd plugin/dashboard && npm install && npm run build
cd plugin/lib && npm install && npm run build

# Verify beads installation
bd --version
bd ready  # Show available tasks
```

## Code Style Guidelines

### Markdown Files
- Use ATX-style headers (`#` not underlines)
- Tables for structured data (commands, options, mappings)
- Code blocks with language hints
- Keep lines under 100 characters where practical

### TypeScript (plugin/lib/, plugin/dashboard/)
- ES modules with `.ts` extension
- Explicit type annotations for function parameters and returns
- Use interfaces over type aliases for object shapes
- Tests use `.test.ts` suffix

### Shell Scripts (scripts/, plugin/hooks/)
- Bash with `#!/bin/bash` shebang
- Use `set -e` for fail-fast behavior
- Quote variables: `"$VAR"` not `$VAR`

## Agent Ecosystem Patterns

### Authority Hierarchy
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

### Agent Modes
Most agents support two modes:
- **examine:** Read-only exploration, no changes
- **execute:** Take action (implement, review, etc.)

### Agent Layer Constraints
**Documentation-layer agents** (Architect, Product, QA):
- Read from `docs/`, `README.md`, config files
- Cannot read source code directly
- Delegate to Coding Agent via spelunk for codebase info

**Code-layer agents** (Coding, Security):
- Full source code access
- Write findings to `docs/spelunk/` for other agents

### Task Scope Rules
- Target 500 lines per task, max 1000
- No scope creep - if you discover new work, create a new bead
- Stay within assigned task boundaries

## LSP Usage Patterns

LSP is enabled by default in Claude Code 2.0.74+. Use LSP tool calls for:
- `documentSymbol` - Get symbols from a file
- `findReferences` - Find all references to a symbol
- `hover` - Get type information at a position
- `goToDefinition` - Navigate to symbol definition

**Tool Delegation Pattern:**
```
1. Plan: Determine what LSP calls are needed
2. Execute: Make LSP tool calls (you execute them)
3. Process: Filter results through lens specifications
```

Fallback chain: LSP -> AST (ast-grep/semgrep) -> Grep

## Important File Locations

| Path | Purpose |
|------|---------|
| `plugin/.claude-plugin/plugin.json` | Plugin manifest |
| `plugin/agents/*.md` | Agent system prompts |
| `plugin/skills/*/SKILL.md` | Skill definitions |
| `plugin/commands/*.md` | Slash command definitions |
| `plugin/hooks/` | Git and session hooks |
| `plugin/lib/spelunk/` | Spelunk TypeScript implementation |
| `docs/plans/architect/` | Architecture design documents |
| `docs/spelunk/` | Generated codebase exploration docs |
| `docs/spelunk/_staleness.json` | Hash validation for spelunk docs |
| `docs/specs/features/` | Gherkin feature specs (BDD) |
| `docs/specs/reviews/` | QA spec review reports |

## Task Tracking with Beads

Beads is the invisible task tracking infrastructure. Users see "tasks", not `bd` commands.

```bash
bd ready              # Find available work
bd show <id>          # View task details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Human Validation Gates

Three mandatory approval points where agents pause:

| Gate | When | Agent Says |
|------|------|------------|
| Design Review | After architect writes design doc | "Design draft complete. Review and approve/revise/discuss." |
| Pre-Implementation | After decompose creates task tree | "Task tree created. Want me to spawn N Coding Agents?" |
| Pre-Commit | After implementation complete | "Ready to commit?" |

**Rules:**
- Never skip mandatory gates
- Silence is not approval - wait for explicit response
- Human can always request changes at any gate

## Session Completion Protocol

When ending a work session, complete ALL steps:

1. File issues for remaining work
2. Run quality gates (if code changed)
3. Update task status
4. **PUSH TO REMOTE** (mandatory):
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # Must show "up to date with origin"
   ```
5. Clean up stashes, prune branches
6. Verify all changes committed AND pushed
7. Hand off context for next session

Work is NOT complete until `git push` succeeds.

## Common Workflows

### Start New Feature
```
/product            # Write feature spec (optional, recommended for user-facing)
/architect          # Co-design with human (checks for spec first)
/decompose          # Create task tree
/visualize          # See what's ready
```

### Implement Task
```
/code               # Implement task (TDD)
/review             # Check quality
/security           # Security gate
/merge-up           # Merge to parent
```

### GitLab Operations
```
/gitlab-pull-comments    # Fetch MR feedback
/gitlab-push-mr          # Create/update MR
```

## Plugin Development Notes

- Plugin root is `plugin/` directory
- Commands in `plugin/commands/` are exposed as `/command-name`
- Skills in `plugin/skills/*/SKILL.md` are invocable
- Hooks registered in `plugin/hooks/hooks.json`
- Test changes with `./scripts/test-ecosystem.sh`
