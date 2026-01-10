# Agent Ecosystem Design

## Overview

A productivity system for Claude Code built on specialized agents, merge trees, and invisible task tracking via beads.

**Environment:** Local-first development with GitLab integration
**Interface:** Claude Code (orchestrator baked into CLAUDE.md)
**Task Tracking:** Beads (invisible infrastructure, user sees "tasks")

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR                            │
│  (CLAUDE.md - routes requests, manages authority hierarchy)     │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
   [Skills Layer]       [Hooks Layer]        [Beads Layer]
   - Explicit invoke    - Auto-triggers      - Merge trees
   - /architect         - pre-commit         - Dependencies
   - /qa-review         - pre-push           - Work tracking
   - /security-audit    - post-merge         - (invisible)
```

## Authority Model

```
                    [Human]
                       ↑ (co-owns, breaks ties)
                       |
              [Architecture Agent]  ←── drafts design WITH human first
                       |
                       ↓
              [Security Agent]  ←── veto power, outranks all
                       |
            ┌──────────┼──────────┐
            ↓          ↓          ↓
        [Product]   [Coding]   [QA]   ←── consensus among peers
            |          |          |
            └──────────┴──────────┘
                       ↓
              [Code Review Agent]  ←── validates before merge
```

## Merge Tree Concept

Features decompose into dependent tasks forming a tree. Work flows bottom-up:

```
        [Feature Complete]           <- root (merge point)
              /    \
       [Auth Done]  [UI Done]        <- merge points
        /    \        /    \
    [login] [logout] [form] [styles] <- leaves (parallelizable)
```

- Leaves execute in parallel
- When all children complete, merge that level
- Repeat until root
- Target: 500 lines per leaf, max 1000 (emergency only)

**Beads are invisible.** User sees tasks, not bd commands.

## Agents

### Architecture Agent
```
Modes:     examine | execute
Authority: Highest (below human). Drafts before others engage.
Triggers:  New feature request, design changes, /architect skill

EXAMINE:
- Analyze codebase structure, patterns, boundaries
- Identify architectural decisions (ADRs)
- Map component relationships
- Assess technical debt

EXECUTE:
- Co-draft design docs with human (iterative)
- Decompose features into merge trees
- Define task boundaries (target 500 lines)
- Create dependency structure
- Output: design doc + task tree
```

### Product Agent
```
Modes:     examine | execute
Authority: Peer (participates in consensus)
Triggers:  Design validation, codebase onboarding, /product skill

EXAMINE:
- Understand what problem a codebase solves
- Map features to user value
- Identify product gaps
- Ignore code quality entirely - pure product lens

EXECUTE:
- Validate designs match product expectations
- Write user stories for tasks
- Flag scope creep
- Output: product validation report, user story annotations
```

### Coding Agent
```
Modes:     examine | execute
Authority: Peer (participates in consensus)
Triggers:  Implementation tasks, codebase exploration, /code skill

EXAMINE:
- Map code relationships (imports, calls, inheritance)
- Understand data flow
- Identify patterns and conventions in use
- Find relevant code for a given task

EXECUTE:
- Implement tasks using TDD workflow
- Follow existing patterns
- Stay within bead scope (no scope creep)
- Output: working code, tests, closes task when done
```

### QA Agent
```
Modes:     examine | execute
Authority: Peer (participates in consensus)
Triggers:  Test creation, test analysis, /qa skill

EXAMINE:
- Analyze existing test coverage
- Understand testing patterns (unit, integration, e2e)
- Identify untested paths
- Map test-to-feature relationships

EXECUTE:
- Generate tests from specs/design docs
- Write edge cases and failure scenarios
- Validate tests pass before task closes
- Output: test files, coverage report
```

### Code Review Agent
```
Modes:     examine | execute
Authority: Gatekeeper (blocks merge if standards violated)
Triggers:  pre-push hook, MR creation, /review skill

EXAMINE:
- Check language-specific style guides:
  - Go: Google Go Style Guide
  - TypeScript: configurable (Airbnb, Google, etc.)
  - C#: Microsoft conventions
- Identify anti-patterns
- Check for consistency with codebase

EXECUTE:
- Review changes against standards
- Provide specific fix suggestions
- Block or approve merge
- Output: review comments, approval/rejection
```

### Security Agent
```
Modes:     examine | execute
Authority: VETO (outranks all, can block anything)
Triggers:  pre-push hook, /security skill, any auth/crypto changes

EXAMINE:
- OWASP Top 10 scan
- Dependency vulnerability check
- Secrets detection
- Auth/authz flow analysis

EXECUTE:
- Audit changes for security issues
- Flag and block vulnerable code
- Require fixes before merge
- Output: security report, block/approve decision
```

## Hooks

### Git Hooks
| Hook | Actions |
|------|---------|
| pre-commit | Lint check, beads export (bd sync) |
| pre-push | Security audit (blocking), Code Review style check (blocking), QA test verification (blocking) |
| post-merge | Beads status update, parent unblock check, next ready notification |

### Claude Hooks
| Hook | Actions |
|------|---------|
| session-start | Load merge tree context, show ready tasks |
| pre-tool | Architecture validation on file creation, scope check |
| post-tool | Track changes against task, line count monitoring |

## Communication Flow

```
Human: "Add user authentication"
           │
           ▼
    ┌─────────────────┐
    │   Orchestrator  │  (CLAUDE.md)
    │   "This needs   │
    │   design first" │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Architecture    │◄──── Human iterates here
    │ Agent           │
    │ Drafts design   │
    └────────┬────────┘
             │ Design doc ready
             ▼
    ┌─────────────────┐
    │ Product Agent   │  "Does this match product goals?"
    │ Validates       │
    └────────┬────────┘
             │ Approved
             ▼
    ┌─────────────────┐
    │ Architecture    │  Creates merge tree
    │ Decomposes      │  → 4 tasks, 2 ready
    └────────┬────────┘
             │
             ▼
    ┌─────────────────────────────────────┐
    │         PARALLEL WORK               │
    │  ┌──────────┐    ┌──────────┐      │
    │  │ Coding   │    │ Coding   │      │
    │  │ Task A   │    │ Task B   │      │
    │  └────┬─────┘    └────┬─────┘      │
    │       │               │             │
    │       ▼               ▼             │
    │  ┌──────────┐    ┌──────────┐      │
    │  │ QA Agent │    │ QA Agent │      │
    │  │ Tests A  │    │ Tests B  │      │
    │  └──────────┘    └──────────┘      │
    └─────────────────────────────────────┘
             │
             ▼ (pre-push)
    ┌─────────────────┐
    │ Code Review     │  Style check
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │ Security Agent  │  Final gate
    └────────┬────────┘
             │ All clear
             ▼
        [Merge up]
        [Parent unblocks]
        [Next tasks ready]
```

## File Structure

```
~/.claude/
├── plugins/
│   └── agent-ecosystem/              # Our plugin
│       ├── plugin.json               # Plugin manifest
│       │
│       ├── agents/                   # Agent definitions
│       │   ├── orchestrator.md
│       │   ├── architecture.md
│       │   ├── product.md
│       │   ├── coding.md
│       │   ├── qa.md
│       │   ├── code-review.md
│       │   └── security.md
│       │
│       ├── skills/                   # User-invocable skills
│       │   ├── architect/SKILL.md
│       │   ├── product/SKILL.md
│       │   ├── code/SKILL.md
│       │   ├── qa/SKILL.md
│       │   ├── review/SKILL.md
│       │   ├── security/SKILL.md
│       │   ├── decompose/SKILL.md
│       │   ├── visualize/SKILL.md
│       │   ├── merge-up/SKILL.md
│       │   ├── rebalance/SKILL.md
│       │   └── gitlab/
│       │       ├── pull-comments/SKILL.md
│       │       ├── push-mr/SKILL.md
│       │       └── sync-feedback/SKILL.md
│       │
│       ├── hooks/                    # Claude hooks
│       │   ├── session-start.sh
│       │   ├── pre-tool.sh
│       │   └── post-tool.sh
│       │
│       └── templates/                # Output templates
│           ├── design-doc.md
│           ├── mr-description.md
│           ├── task-breakdown.md
│           └── security-report.md

<project>/
├── .claude/settings.local.json      # Project-specific overrides
├── .beads/                          # Task data (invisible)
├── .beads-hooks/                    # Git hooks
└── docs/plans/                      # Design docs
```

## Merge Tree Operations

| Skill | Purpose |
|-------|---------|
| `/decompose` | Break feature into merge tree of tasks |
| `/visualize` | Show tree in markdown (what's done, blocked, ready) |
| `/parallelize` | Spawn worktrees/agents for independent leaves |
| `/merge-up` | Handle git merge + task status when leaves complete |
| `/rebalance` | Split heavy branches, collapse trivial ones (500 line target) |

## GitLab Integration

| Skill | Purpose |
|-------|---------|
| `/gitlab pull-comments` | Fetch MR feedback into context |
| `/gitlab push-mr` | Create/update MR from current branch |
| `/gitlab sync-feedback` | Route feedback to relevant agent, address, update MR |

## Additional Workflows

1. **Codebase Onboarding** - Point agents at repo in examine mode for instant context
2. **Spec-to-Tests Pipeline** - Design doc → QA generates tests → Coding implements
3. **MR Splitting** - Giant branch → rebalance → sub-MRs with dependency tracking
4. **Feedback Loop** - Pull comments → route to agent → address → push update
5. **Context Handoff** - Tasks + design docs persist across sessions
6. **Parallel Feature Work** - Multiple worktrees with own task subtrees
7. **Audit Trail** - Design doc → tasks → commits → MRs (traceable)
8. **Style Guide Learning** - Code Review learns project conventions over time

## Installation

```bash
# install.sh does:
1. Check prerequisites (go, git, claude-code)
2. Install bd: go install github.com/steveyegge/beads/cmd/bd@latest
3. Create ~/.claude/plugins/agent-ecosystem/ structure
4. Write agent definitions
5. Write skill files
6. Create hook templates
7. Print next steps
```

## Next Steps

1. Create install script for beads
2. Scaffold plugin structure
3. Write orchestrator CLAUDE.md
4. Implement Architecture agent (first, since it leads)
5. Add remaining agents as stubs
6. Implement merge tree skills
7. Add GitLab integration
8. Test end-to-end workflow
