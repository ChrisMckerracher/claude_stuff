# CLAUDE.md

This file provides guidance for Claude Code when working in this repository.

## Project Overview

Agent Ecosystem is a Claude Code plugin providing 7 specialized AI agents for software development workflows. It uses the **teammates feature** for inter-agent coordination, beads for task tracking, and merge tree workflows for feature decomposition.

**Key Components:**
- **7 Specialist Agents (Teammates):** Orchestrator (team lead), Architecture, Product, Coding, QA, Code Review, Security
- **Teammates Coordination:** Agents communicate via messaging and shared task lists instead of Task() subagent spawning
- **Spelunk System:** Persistent codebase exploration with hash-based cache validation
- **Merge Tree Workflows:** Decompose features into dependent tasks
- **GitLab Integration:** Pull MR comments, push MRs

> **Experimental:** Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled.

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

### Teammate Communication Model
Agents coordinate via **inter-agent messaging** and **shared task lists**:
- **Orchestrator (Team Lead):** Spawns specialist teammates, enforces gates, monitors progress
- **Specialist Teammates:** Receive work via spawn prompts, communicate via messages
- **Shared Task List:** Teammates self-claim tasks, report completion to lead
- **Direct Messaging:** Teammates message each other (e.g., Coding -> QA for test generation)

### Agent Modes
Most agents support two modes:
- **examine:** Read-only exploration, no changes
- **execute:** Take action (implement, review, etc.)

### Agent Layer Constraints
**Documentation-layer agents** (Architect, Product, QA):
- Read from `docs/`, `README.md`, config files
- Cannot read source code directly
- Delegate to Coding Agent via teammate messaging for spelunk

**Code-layer agents** (Coding, Security):
- Full source code access
- Write findings to `docs/spelunk/` for other agents
- Respond to spelunk requests from documentation-layer teammates

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
| `tests/e2e/` | Playwright e2e tests generated from specs |
| `tests/e2e/playwright.config.ts` | Playwright config with video recording |

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
| Pre-Implementation | After decompose creates task tree | "Task tree created. Want me to spawn N Coding teammates?" |
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
/product spec       # Write Gherkin feature spec (QA reviews)
/architect          # Co-design with human (reads spec if exists)
/decompose          # Create task tree
/visualize          # See what's ready
```

### BDD Feature Spec Workflow
```
/product spec                    # Product writes Gherkin spec
                                 # QA reviews (conversational approval)
/architect                       # Architect reads spec, designs solution
/decompose                       # Break into tasks
/code                            # Implement features
/qa generate-tests <spec-path>   # QA generates Playwright tests from spec
                                 # Tests run with video recording
```

Gherkin specs → Playwright tests flow:
- Given/When/Then → arrange/act/assert
- Background → beforeEach hook
- Scenario Outline → parameterized tests
- Video captured on test retry for debugging

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

## Teammates Feature

Agents use Claude Code's experimental **agent teams** feature for coordination:

### How It Works
- **Orchestrator** is the team lead; spawns specialist teammates
- Each teammate is a full Claude Code session with its own context
- Teammates communicate via **messages** (not Task() subagent spawning)
- **Shared task list** tracks work assignments and progress

### Teammate Roles
| Agent | Role | Spawned When |
|-------|------|-------------|
| Orchestrator | Team lead | Always active |
| Architect | Specialist | New feature, design |
| Product | Specialist | Spec, brief, validation |
| Coding | Specialist | Implementation, spelunk |
| QA | Specialist | Test generation, coverage |
| Code Review | Specialist | Pre-merge review |
| Security | Specialist | Security audit (VETO) |

### Communication Flow
```
Lead spawns teammates -> Teammates claim tasks -> Teammates message each other
-> Teammates report to lead -> Lead enforces gates with human
```

### Requirements
- Enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` in settings.json or environment

## Plugin Development Notes

- Plugin root is `plugin/` directory
- Commands in `plugin/commands/` are exposed as `/command-name`
- Skills in `plugin/skills/*/SKILL.md` are invocable
- Agent definitions in `plugin/agents/*.md` include `teammate_role` field
- Hooks registered in `plugin/hooks/hooks.json`
- Test changes with `./scripts/test-ecosystem.sh`
