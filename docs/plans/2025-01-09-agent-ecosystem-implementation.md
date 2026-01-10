# Agent Ecosystem Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a productivity system with specialized agents, merge tree workflows, and invisible task tracking via beads.

**Architecture:** Plugin-based system with orchestrator in CLAUDE.md, 6 specialist agents as Task subagents, skills for explicit invocation, and hooks for automatic quality gates. Beads provides invisible task infrastructure.

**Tech Stack:** Claude Code plugins, SKILL.md files, bash hooks, beads CLI, git worktrees

---

## Phase 1: Foundation

### Task 1: Install Beads

**Files:**
- Create: `scripts/install-ecosystem.sh`

**Step 1: Write the install script**

```bash
#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_error() { echo -e "${RED}Error:${NC} $1" >&2; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v git &> /dev/null; then
        log_error "git is required but not installed"
        exit 1
    fi

    if ! command -v claude &> /dev/null; then
        log_error "claude (Claude Code CLI) is required but not installed"
        echo "Install from: https://claude.ai/code"
        exit 1
    fi

    log_success "Prerequisites satisfied"
}

# Install beads
install_beads() {
    log_info "Installing beads..."

    if command -v bd &> /dev/null; then
        log_info "beads already installed: $(bd version 2>/dev/null || echo 'unknown version')"
        return 0
    fi

    # Try npm first (easiest)
    if command -v npm &> /dev/null; then
        log_info "Installing via npm..."
        npm install -g @anthropic-ai/bd || true
    fi

    # Try go install
    if ! command -v bd &> /dev/null && command -v go &> /dev/null; then
        log_info "Installing via go..."
        go install github.com/steveyegge/beads/cmd/bd@latest
    fi

    # Try direct download
    if ! command -v bd &> /dev/null; then
        log_info "Installing from GitHub releases..."
        curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
    fi

    if command -v bd &> /dev/null; then
        log_success "beads installed successfully"
    else
        log_error "Failed to install beads"
        exit 1
    fi
}

check_prerequisites
install_beads

log_success "Foundation installed!"
echo ""
echo "Next: Run ./scripts/setup-plugin.sh to create the plugin structure"
```

**Step 2: Make script executable and test**

Run: `chmod +x scripts/install-ecosystem.sh && ./scripts/install-ecosystem.sh`
Expected: beads installed, success message

**Step 3: Commit**

```bash
git add scripts/install-ecosystem.sh
git commit -m "feat: add ecosystem install script"
```

---

### Task 2: Create Plugin Structure

**Files:**
- Create: `scripts/setup-plugin.sh`
- Create: `~/.claude/plugins/local/agent-ecosystem/.claude-plugin/plugin.json`

**Step 1: Write plugin setup script**

```bash
#!/usr/bin/env bash
set -e

PLUGIN_DIR="$HOME/.claude/plugins/local/agent-ecosystem"

log_info() { echo -e "\033[0;34m==>\033[0m $1"; }
log_success() { echo -e "\033[0;32m==>\033[0m $1"; }

create_plugin_structure() {
    log_info "Creating plugin structure at $PLUGIN_DIR..."

    mkdir -p "$PLUGIN_DIR/.claude-plugin"
    mkdir -p "$PLUGIN_DIR/agents"
    mkdir -p "$PLUGIN_DIR/skills"
    mkdir -p "$PLUGIN_DIR/hooks"
    mkdir -p "$PLUGIN_DIR/templates"

    # Write plugin.json
    cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'EOF'
{
  "name": "agent-ecosystem",
  "description": "Specialized agents, merge tree workflows, and invisible task tracking",
  "version": "0.1.0",
  "author": {
    "name": "chrismck"
  },
  "keywords": ["agents", "beads", "merge-tree", "tdd", "workflow"]
}
EOF

    log_success "Plugin structure created"
}

create_plugin_structure

echo ""
echo "Plugin created at: $PLUGIN_DIR"
echo ""
echo "To enable, add to ~/.claude/settings.json:"
echo '  "enabledPlugins": {'
echo '    "agent-ecosystem@local": true'
echo '  }'
```

**Step 2: Run setup script**

Run: `chmod +x scripts/setup-plugin.sh && ./scripts/setup-plugin.sh`
Expected: Plugin directories created

**Step 3: Commit**

```bash
git add scripts/setup-plugin.sh
git commit -m "feat: add plugin setup script"
```

---

### Task 3: Create Orchestrator CLAUDE.md

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/orchestrator.md`

**Step 1: Write orchestrator instructions**

```markdown
# Agent Ecosystem Orchestrator

You are an orchestrator that routes requests to specialist agents. You understand the authority hierarchy and manage consensus among peer agents.

## Authority Hierarchy

1. **Human** - Ultimate authority, breaks ties, co-owns design
2. **Architecture Agent** - Drafts designs WITH human before others engage
3. **Security Agent** - VETO power, outranks all on security matters
4. **Peer Agents** (consensus): Product, Coding, QA
5. **Code Review Agent** - Validates before merge

## Routing Rules

### Design Phase (Architecture leads)
- New features → Architecture Agent first (co-draft with human)
- Design changes → Architecture Agent
- Once design approved → Product Agent validates

### Implementation Phase (Peers work)
- Implementation tasks → Coding Agent
- Test creation → QA Agent
- Code changes → both Coding + QA in parallel

### Quality Gates (Gatekeepers check)
- Before merge → Code Review Agent (style, standards)
- All changes → Security Agent (veto power)

## Task Abstraction

Users see "tasks", not beads. Translate:
- "What's ready?" → run `bd ready --json`, show plain language
- "I finished X" → run `bd close <id>`, report what's unblocked
- "Show progress" → run `bd stats`, render markdown

Only surface beads details when user explicitly asks.

## Spawning Agents

Use the Task tool with subagent_type to spawn specialists:
- `subagent_type: "general-purpose"` with agent instructions in prompt
- Include relevant context from this conversation
- Specify examine vs execute mode

## Merge Tree Awareness

Features decompose into dependent tasks forming a tree:
- Leaves are parallelizable
- When children complete, parent unblocks
- Target 500 lines per leaf, max 1000

Track merge tree state via beads. Report progress in plain language.
```

**Step 2: Verify file created**

Run: `cat ~/.claude/plugins/local/agent-ecosystem/agents/orchestrator.md | head -20`
Expected: File contents shown

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add orchestrator agent definition"
```

---

## Phase 2: Specialist Agents

### Task 4: Architecture Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/architecture.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/architect/SKILL.md`

**Step 1: Write architecture agent definition**

```markdown
# Architecture Agent

## Modes

### Examine Mode
Analyze codebases for structure and patterns.

**Capabilities:**
- Map component relationships and boundaries
- Identify architectural decisions (existing ADRs)
- Assess technical debt
- Understand data flow

**Output:** Architecture analysis report

### Execute Mode
Co-draft designs with human, decompose into merge trees.

**Process:**
1. Clarify requirements with human (iterative)
2. Explore 2-3 approaches with trade-offs
3. Draft design doc section by section
4. Decompose into task tree (target 500 lines each)
5. Create beads with blocking dependencies

**Output:** Design doc + task tree (beads created invisibly)

## Design Doc Template

```markdown
# [Feature Name] Design

## Goal
One sentence describing what this builds.

## Approach
2-3 sentences about the chosen approach and why.

## Components
- Component A: purpose
- Component B: purpose

## Task Breakdown
1. Task (blocks: none) - description
2. Task (blocks: 1) - description
```

## Merge Tree Rules

- Target 500 lines per task
- Max 1000 lines (emergency only)
- Leaves should be parallelizable
- Each task = one reviewable unit
```

**Step 2: Write architect skill**

```markdown
---
name: architect
description: Use when starting new features, making design decisions, or analyzing codebase architecture
---

# /architect

Invoke the Architecture Agent for design work.

## Usage

`/architect` - Start design session for new feature
`/architect examine` - Analyze current codebase architecture
`/architect decompose` - Break current design into task tree

## What Happens

1. Architecture Agent activates in appropriate mode
2. For new features: iterative co-design with you
3. For examine: produces architecture analysis
4. For decompose: creates merge tree of tasks

## Authority

Architecture Agent has highest authority below human. Other agents wait for design approval before engaging.
```

**Step 3: Verify files created**

Run: `ls -la ~/.claude/plugins/local/agent-ecosystem/agents/ ~/.claude/plugins/local/agent-ecosystem/skills/architect/`
Expected: Files listed

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add architecture agent and skill"
```

---

### Task 5: Product Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/product.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/product/SKILL.md`

**Step 1: Write product agent definition**

```markdown
# Product Agent

## Modes

### Examine Mode
Understand what problem a codebase solves. **Ignore code quality entirely.**

**Focus on:**
- What user problems does this solve?
- What features exist?
- What's the user journey?
- What product gaps exist?

**Output:** Product analysis (features, user value, gaps)

### Execute Mode
Validate designs match product expectations.

**Process:**
1. Review design doc
2. Check: Does this solve the stated problem?
3. Check: Does scope match user value?
4. Flag scope creep
5. Write user stories for tasks

**Output:** Validation report, user story annotations

## Validation Checklist

- [ ] Clear problem statement
- [ ] Solution addresses problem directly
- [ ] No unnecessary features (YAGNI)
- [ ] User value is clear
- [ ] Success criteria defined

## Authority

Peer level. Participates in consensus. Validates after Architecture but before implementation.
```

**Step 2: Write product skill**

```markdown
---
name: product
description: Use when validating designs match product goals, or understanding what problem a codebase solves
---

# /product

Invoke the Product Agent.

## Usage

`/product` - Validate current design against product expectations
`/product examine` - Analyze codebase from pure product lens (ignores code quality)

## What Happens

1. Product Agent activates
2. Reviews design or codebase from user-value perspective
3. Flags scope creep, validates problem-solution fit
4. Outputs validation report or product analysis
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add product agent and skill"
```

---

### Task 6: Coding Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/coding.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/code/SKILL.md`

**Step 1: Write coding agent definition**

```markdown
# Coding Agent

## Modes

### Examine Mode
Understand code relationships and patterns.

**Capabilities:**
- Map imports, calls, inheritance
- Understand data flow
- Identify patterns and conventions
- Find relevant code for tasks

**Output:** Code relationship map, pattern analysis

### Execute Mode
Implement tasks using TDD workflow.

**Process:**
1. Check task is unblocked (`bd ready`)
2. Claim task (`bd update <id> --status in_progress`)
3. **REQUIRED:** Use superpowers:test-driven-development
4. Write failing test first
5. Implement minimal code to pass
6. Refactor
7. Close task (`bd close <id>`)

**Output:** Working code with tests

## Scope Rules

- Stay within assigned task scope
- No scope creep
- If you discover new work: create new bead, link as discovered-from
- Target 500 lines, max 1000

## Authority

Peer level. Participates in consensus. Works in parallel with QA on implementation.
```

**Step 2: Write code skill**

```markdown
---
name: code
description: Use when implementing tasks, or understanding code relationships in a codebase
---

# /code

Invoke the Coding Agent.

## Usage

`/code` - Start implementing next ready task
`/code examine` - Analyze code relationships and patterns
`/code <task-description>` - Implement specific task

## What Happens

1. Coding Agent activates with TDD workflow
2. Claims task from ready queue
3. Writes tests first, then implementation
4. Closes task when complete, reports what's unblocked

**REQUIRED SUB-SKILL:** superpowers:test-driven-development
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add coding agent and skill"
```

---

### Task 7: QA Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/qa.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/qa/SKILL.md`

**Step 1: Write QA agent definition**

```markdown
# QA Agent

## Modes

### Examine Mode
Analyze existing test coverage and patterns.

**Capabilities:**
- Map test coverage
- Understand testing patterns (unit, integration, e2e)
- Identify untested paths
- Map test-to-feature relationships

**Output:** Test coverage analysis, pattern report

### Execute Mode
Generate tests from specs/design docs.

**Process:**
1. Read design doc / spec
2. Identify test scenarios:
   - Happy paths
   - Edge cases
   - Error conditions
   - Boundary values
3. Write tests following project patterns
4. Validate tests pass before task closes

**Output:** Test files, coverage report

## Test Design Principles

- One behavior per test
- Clear, descriptive names
- Test real behavior, not mocks
- Cover edge cases and errors

## Authority

Peer level. Participates in consensus. Works in parallel with Coding on test creation.
```

**Step 2: Write QA skill**

```markdown
---
name: qa
description: Use when creating tests from specs, or analyzing test coverage in a codebase
---

# /qa

Invoke the QA Agent.

## Usage

`/qa` - Generate tests for current design/task
`/qa examine` - Analyze test coverage and patterns
`/qa <spec>` - Generate tests from specific spec

## What Happens

1. QA Agent activates
2. Reads spec/design to understand requirements
3. Generates comprehensive test scenarios
4. Writes tests following project patterns
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add QA agent and skill"
```

---

### Task 8: Code Review Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/code-review.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/review/SKILL.md`

**Step 1: Write code review agent definition**

```markdown
# Code Review Agent

## Modes

### Examine Mode
Check codebase for style guide compliance and anti-patterns.

**Style Guides by Language:**
- Go: Google Go Style Guide
- TypeScript: Configurable (Airbnb, Google, Standard)
- C#: Microsoft conventions

**Output:** Style compliance report

### Execute Mode
Review changes against standards. Can **block merge**.

**Process:**
1. Identify changed files
2. Check language-specific style guide
3. Check consistency with existing codebase patterns
4. Identify anti-patterns
5. Provide specific fix suggestions
6. Decision: approve or block

**Output:** Review comments, approval/rejection

## Review Checklist

- [ ] Follows language style guide
- [ ] Consistent with codebase conventions
- [ ] No anti-patterns
- [ ] Clear naming
- [ ] Appropriate error handling
- [ ] No dead code

## Authority

**Gatekeeper.** Can block merge if standards violated. Runs via pre-push hook.
```

**Step 2: Write review skill**

```markdown
---
name: review
description: Use when reviewing code changes for style guide compliance and quality standards
---

# /review

Invoke the Code Review Agent.

## Usage

`/review` - Review current staged/uncommitted changes
`/review examine` - Analyze codebase for style compliance
`/review <files>` - Review specific files

## What Happens

1. Code Review Agent activates
2. Checks changes against language-specific style guides
3. Checks consistency with codebase patterns
4. Provides specific fix suggestions
5. Returns approval or blocking rejection

## Authority

Code Review Agent is a **gatekeeper** - can block merge.
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add code review agent and skill"
```

---

### Task 9: Security Agent

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/agents/security.md`
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/security/SKILL.md`

**Step 1: Write security agent definition**

```markdown
# Security Agent

## Modes

### Examine Mode
Security audit of codebase.

**Checks:**
- OWASP Top 10 vulnerabilities
- Dependency vulnerabilities
- Secrets detection
- Auth/authz flow analysis
- Input validation
- SQL injection, XSS, command injection

**Output:** Security audit report

### Execute Mode
Audit changes for security issues. Has **VETO power**.

**Process:**
1. Scan changed files
2. Check for introduced vulnerabilities
3. Check dependencies for known CVEs
4. Verify no secrets committed
5. Decision: approve or **VETO**

**Output:** Security report, block/approve

## VETO Rules

Security Agent can block ANY change that:
- Introduces OWASP Top 10 vulnerability
- Adds dependency with known critical CVE
- Contains secrets/credentials
- Weakens authentication/authorization
- Has command injection risk

## Authority

**VETO power.** Outranks all agents on security matters. Runs via pre-push hook.
```

**Step 2: Write security skill**

```markdown
---
name: security
description: Use when auditing code for security vulnerabilities, or before any merge involving auth/crypto
---

# /security

Invoke the Security Agent.

## Usage

`/security` - Audit current changes for security issues
`/security examine` - Full security audit of codebase
`/security <files>` - Audit specific files

## What Happens

1. Security Agent activates
2. Scans for OWASP Top 10, secrets, vulnerable dependencies
3. Returns security report
4. Can **VETO** merge if critical issues found

## Authority

Security Agent has **VETO power** - outranks all other agents on security matters.
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add security agent and skill"
```

---

## Phase 3: Merge Tree Skills

### Task 10: Decompose Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/decompose/SKILL.md`

**Step 1: Write decompose skill**

```markdown
---
name: decompose
description: Use when breaking a feature or design into a merge tree of dependent tasks
---

# /decompose

Break a feature into a merge tree of tasks with proper dependencies.

## Process

1. Read the design doc or feature description
2. Identify natural boundaries (components, layers, files)
3. Create tasks targeting 500 lines each (max 1000)
4. Establish blocking dependencies (children block parent)
5. Create beads with `bd create` (invisible to user)
6. Report task tree in plain language

## Output Format

```
Feature: [name]
├── Task A (ready) - [description]
├── Task B (ready) - [description]
└── Task C (blocked by A, B)
    ├── Task C.1 (ready) - [description]
    └── Task C.2 (ready) - [description]

Ready to work: Task A, Task B, Task C.1, Task C.2
```

## Size Guidelines

- Target: 500 lines per task
- Maximum: 1000 lines (emergency only)
- If task > 1000 lines: decompose further

## Beads Commands (invisible to user)

```bash
# Create task
bd create "Task title" -t task -p 1 -d "Description" --json

# Add blocking dependency
bd dep add <child-id> <parent-id> --type blocks

# Show tree
bd dep tree <root-id>
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add decompose skill"
```

---

### Task 11: Visualize Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/visualize/SKILL.md`

**Step 1: Write visualize skill**

```markdown
---
name: visualize
description: Use when you want to see the current task tree, progress, and what's ready to work on
---

# /visualize

Show the current merge tree in markdown format.

## Output

```
## Feature: [name]

### Progress: 3/8 tasks complete (37%)

### Tree
├── [x] Task A - Login form
├── [x] Task B - API endpoint
├── [ ] Task C - Integration (blocked by D)
│   ├── [~] Task C.1 - Frontend hook (in progress)
│   └── [ ] Task C.2 - Error handling
└── [ ] Task D - Auth middleware
    ├── [x] Task D.1 - JWT validation
    └── [ ] Task D.2 - Session management

### Ready to Work
- Task C.2: Error handling
- Task D.2: Session management

### In Progress
- Task C.1: Frontend hook

### Blocked
- Task C: Waiting on Task D
```

## Legend

- `[x]` Complete
- `[~]` In progress
- `[ ]` Pending
- `(blocked by X)` Has unmet dependencies

## Beads Commands (invisible)

```bash
bd list --json | jq  # Get all tasks
bd ready --json      # Get ready tasks
bd dep tree <id>     # Get dependency tree
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add visualize skill"
```

---

### Task 12: Merge-Up Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/merge-up/SKILL.md`

**Step 1: Write merge-up skill**

```markdown
---
name: merge-up
description: Use when leaf tasks are complete and you need to merge up to the parent level
---

# /merge-up

Handle git merge + task status updates when children complete.

## Process

1. Check all child tasks are complete
2. Perform git merge of child branches to parent branch
3. Close parent bead
4. Report what's newly unblocked

## Pre-conditions

- All child beads must be closed
- All child branches must be merged or ready to merge
- No merge conflicts (resolve first if any)

## Merge Flow

```
Child branches (complete)
    ↓ git merge
Parent branch (updated)
    ↓ bd close
Parent bead (closed)
    ↓ check
Grandparent unblocked?
```

## Commands

```bash
# Check children complete
bd show <parent-id> --json | jq '.blocking_issues'

# Merge child branches
git checkout <parent-branch>
git merge <child-branch-1>
git merge <child-branch-2>

# Close parent
bd close <parent-id> --reason "Children merged"

# Check what's unblocked
bd ready --json
```

## Conflict Resolution

If merge conflicts occur:
1. Report conflicts to user
2. Do NOT auto-resolve
3. After user resolves: re-run /merge-up
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add merge-up skill"
```

---

### Task 13: Rebalance Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/rebalance/SKILL.md`

**Step 1: Write rebalance skill**

```markdown
---
name: rebalance
description: Use when tasks are too large (over 500 lines) or too small, to rebalance the merge tree
---

# /rebalance

Rebalance merge tree to maintain 500 line target per task.

## Triggers

- Task estimated > 500 lines → Split
- Task estimated > 1000 lines → **Must split**
- Multiple tiny tasks (< 50 lines each) → Consider consolidating

## Split Process

1. Identify oversized task
2. Find natural split points:
   - Separate concerns
   - Different files
   - Independent operations
3. Create child beads
4. Update dependencies
5. Report new tree structure

## Estimation Heuristics

| Indicator | Likely Size |
|-----------|-------------|
| Single function change | < 100 lines |
| New component | 200-400 lines |
| New feature with tests | 400-600 lines |
| Multiple components | > 500 lines (split!) |
| "And" in description | Probably too big |

## Output

```
Rebalanced: Task X

Before: 1 task (~1200 lines estimated)
After: 3 tasks (~400 lines each)

New tree:
├── Task X.1 - Component A (ready)
├── Task X.2 - Component B (ready)
└── Task X.3 - Integration (blocked by X.1, X.2)
```

## Commands

```bash
# Create sub-tasks
bd create "Subtask" -t task -p 1 --json

# Link as child
bd dep add <new-id> <parent-id> --type blocks

# Update original to "epic" if needed
bd update <parent-id> -t epic
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add rebalance skill"
```

---

## Phase 4: GitLab Integration

### Task 14: GitLab Pull Comments Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/gitlab/pull-comments/SKILL.md`

**Step 1: Write pull-comments skill**

```markdown
---
name: gitlab-pull-comments
description: Use when you need to fetch and review comments from a GitLab MR
---

# /gitlab pull-comments

Fetch MR feedback from GitLab into context.

## Usage

`/gitlab pull-comments` - Pull comments from current branch's MR
`/gitlab pull-comments <mr-id>` - Pull comments from specific MR

## Process

1. Determine MR (from branch or argument)
2. Fetch MR comments via GitLab API
3. Format for review
4. Route feedback to relevant agent if actionable

## Requirements

- `GITLAB_TOKEN` environment variable set
- `GITLAB_HOST` (defaults to gitlab.com)
- Git remote configured

## Output

```
## MR #123: Add user authentication

### Comments (3)

**@reviewer** on `src/auth.ts:45`
> Consider using bcrypt instead of plain hashing

**@reviewer** on general
> Missing error handling for network failures

**@pm** on general
> LGTM, just the security concern above

### Actionable Items
1. Security: Use bcrypt (route to Security Agent)
2. Code: Add error handling (route to Coding Agent)
```

## API Call

```bash
curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_HOST/api/v4/projects/$PROJECT_ID/merge_requests/$MR_ID/notes"
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add gitlab pull-comments skill"
```

---

### Task 15: GitLab Push MR Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/gitlab/push-mr/SKILL.md`

**Step 1: Write push-mr skill**

```markdown
---
name: gitlab-push-mr
description: Use when creating or updating a GitLab MR from the current branch
---

# /gitlab push-mr

Create or update GitLab MR from current branch.

## Usage

`/gitlab push-mr` - Create MR for current branch
`/gitlab push-mr update` - Update existing MR description

## Process

1. Push current branch to remote
2. Check if MR exists for branch
3. If new: Create MR with generated description
4. If exists: Update description
5. Report MR URL

## MR Description Template

Generated from linked bead:

```markdown
## Summary

[From bead description]

## Changes

- [Generated from commits]

## Task Tree

[From /visualize if part of merge tree]

## Test Plan

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual verification

---
Tracked by: bd-xxxx
```

## Commands

```bash
# Push branch
git push -u origin $(git branch --show-current)

# Create MR (glab CLI)
glab mr create --title "Title" --description "..."

# Or via API
curl -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_HOST/api/v4/projects/$PROJECT_ID/merge_requests" \
  -d "source_branch=..." -d "target_branch=main" -d "title=..."
```
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add gitlab push-mr skill"
```

---

### Task 16: Update Claude.md Skill

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/skills/update-claude/SKILL.md`

**Step 1: Write update-claude skill**

```markdown
---
name: update-claude
description: Use when you receive feedback that should update project CLAUDE.md conventions
---

# /update-claude

Update CLAUDE.md with feedback or new conventions.

## Usage

`/update-claude <feedback>` - Incorporate feedback into CLAUDE.md
`/update-claude` - Interactive mode to gather feedback

## Process

1. Read current CLAUDE.md
2. Analyze feedback for actionable conventions
3. Determine appropriate section
4. Draft update
5. Show diff for approval
6. Apply if approved

## Feedback Types

| Type | CLAUDE.md Section |
|------|-------------------|
| Code style | Code Standards |
| Architecture decisions | Architecture |
| Testing conventions | Testing |
| Git workflow | Git Workflow |
| Tool preferences | Tools |

## Example

Input feedback:
> "We should always use structured logging, not console.log"

Update:
```markdown
## Code Standards

### Logging
- Use structured logging (e.g., pino, winston)
- Never use console.log in production code
- Include context: `logger.info({ userId, action }, 'message')`
```

## Safety

- Always show diff before applying
- Create backup: `cp CLAUDE.md CLAUDE.md.bak`
- Commit update separately
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add update-claude skill"
```

---

## Phase 5: Hooks

### Task 17: Session Start Hook

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh`

**Step 1: Write session start hook**

```bash
#!/usr/bin/env bash
# Session start hook - load context and show ready tasks

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Check if beads initialized in project
if [ -d "$CWD/.beads" ]; then
    # Get ready tasks
    READY=$(cd "$CWD" && bd ready --json 2>/dev/null)

    if [ -n "$READY" ] && [ "$READY" != "[]" ]; then
        COUNT=$(echo "$READY" | jq 'length')

        # Output context for Claude
        echo "Project has beads task tracking. $COUNT task(s) ready to work on."
        echo "Use /visualize to see full task tree."
    fi
fi

# Always exit 0 for non-blocking
exit 0
```

**Step 2: Make executable**

Run: `chmod +x ~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add session-start hook"
```

---

### Task 18: Pre-Push Hook (Quality Gates)

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/hooks/pre-push-security.sh`

**Step 1: Write pre-push security hook**

```bash
#!/usr/bin/env bash
# Pre-push hook - Security Agent gate

set -e

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')

cd "$CWD"

# Quick security checks
ISSUES=""

# Check for secrets
if git diff --cached --name-only | xargs grep -l -E "(password|secret|api_key|token)\s*[:=]" 2>/dev/null; then
    ISSUES="${ISSUES}Potential secrets detected in staged files.\n"
fi

# Check for .env files
if git diff --cached --name-only | grep -E "\.env$" 2>/dev/null; then
    ISSUES="${ISSUES}Attempting to commit .env file.\n"
fi

# Check for private keys
if git diff --cached --name-only | grep -E "\.(pem|key)$" 2>/dev/null; then
    ISSUES="${ISSUES}Attempting to commit private key file.\n"
fi

if [ -n "$ISSUES" ]; then
    echo "Security Agent VETO:"
    echo -e "$ISSUES"
    echo ""
    echo "Fix these issues before pushing."
    exit 2  # Blocking error
fi

exit 0
```

**Step 2: Make executable**

Run: `chmod +x ~/.claude/plugins/local/agent-ecosystem/hooks/pre-push-security.sh`

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add pre-push security hook"
```

---

### Task 19: Hook Registration

**Files:**
- Modify: `~/.claude/settings.json` (or project settings)

**Step 1: Document hook registration**

Add to settings.json:

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
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/pre-push-security.sh"
          }
        ]
      }
    ]
  }
}
```

**Step 2: Commit docs**

```bash
git add -A
git commit -m "docs: add hook registration instructions"
```

---

## Phase 6: Templates

### Task 20: Design Doc Template

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/templates/design-doc.md`

**Step 1: Write template**

```markdown
# [Feature Name] Design

## Goal

[One sentence: What does this build and why?]

## Background

[2-3 sentences: Context, why now, what problem]

## Approach

[2-3 sentences: Chosen approach and key trade-offs]

### Alternatives Considered

1. **[Alternative A]** - [Why not chosen]
2. **[Alternative B]** - [Why not chosen]

## Components

### [Component 1]
- Purpose: [What it does]
- Scope: [What's in/out]

### [Component 2]
- Purpose: [What it does]
- Scope: [What's in/out]

## Data Flow

```
[Input] → [Process A] → [Process B] → [Output]
```

## Task Breakdown

| Task | Blocks | Est. Lines | Description |
|------|--------|------------|-------------|
| Task 1 | - | 300 | [Description] |
| Task 2 | - | 400 | [Description] |
| Task 3 | 1, 2 | 200 | [Description] |

## Success Criteria

- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
- [ ] All tests pass
- [ ] Security review approved

## Open Questions

- [ ] [Question needing resolution]
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add design doc template"
```

---

### Task 21: MR Description Template

**Files:**
- Create: `~/.claude/plugins/local/agent-ecosystem/templates/mr-description.md`

**Step 1: Write template**

```markdown
## Summary

[1-2 sentences: What this MR does]

## Changes

- [Change 1]
- [Change 2]
- [Change 3]

## Related Tasks

- Part of: [Parent task/feature]
- Blocks: [What this unblocks]
- Tracked by: `bd-xxxx`

## Test Plan

- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual verification steps:
  1. [Step 1]
  2. [Step 2]

## Screenshots

[If UI changes]

## Checklist

- [ ] Code follows style guide
- [ ] Tests pass locally
- [ ] No secrets committed
- [ ] Documentation updated (if needed)

---
Generated by Agent Ecosystem
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add MR description template"
```

---

## Phase 7: Final Assembly

### Task 22: Main Install Script

**Files:**
- Modify: `scripts/install-ecosystem.sh`

**Step 1: Update install script to include all components**

Add to existing install script:

```bash
# After beads installation...

# Create plugin structure
log_info "Setting up plugin..."
PLUGIN_DIR="$HOME/.claude/plugins/local/agent-ecosystem"
mkdir -p "$PLUGIN_DIR"

# Copy all files from repo to plugin
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

if [ -d "$REPO_DIR/plugin" ]; then
    cp -r "$REPO_DIR/plugin/"* "$PLUGIN_DIR/"
    log_success "Plugin files installed"
fi

# Remind about settings
echo ""
echo "To enable the plugin, add to ~/.claude/settings.json:"
echo '  "enabledPlugins": {'
echo '    "agent-ecosystem@local": true'
echo '  }'
echo ""

log_success "Agent Ecosystem installed!"
echo ""
echo "Quick start:"
echo "  /architect    - Start design session"
echo "  /visualize    - See task tree"
echo "  /code         - Implement next task"
```

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: complete install script with all components"
```

---

### Task 23: Integration Test

**Step 1: Create test script**

```bash
#!/usr/bin/env bash
# Test the ecosystem installation

set -e

echo "Testing Agent Ecosystem..."

# Check beads
if ! command -v bd &> /dev/null; then
    echo "FAIL: beads not installed"
    exit 1
fi
echo "PASS: beads installed"

# Check plugin directory
PLUGIN_DIR="$HOME/.claude/plugins/local/agent-ecosystem"
if [ ! -d "$PLUGIN_DIR" ]; then
    echo "FAIL: plugin directory missing"
    exit 1
fi
echo "PASS: plugin directory exists"

# Check required files
FILES=(
    "agents/orchestrator.md"
    "agents/architecture.md"
    "agents/security.md"
    "skills/architect/SKILL.md"
    "skills/visualize/SKILL.md"
)

for file in "${FILES[@]}"; do
    if [ ! -f "$PLUGIN_DIR/$file" ]; then
        echo "FAIL: missing $file"
        exit 1
    fi
done
echo "PASS: all required files present"

echo ""
echo "All tests passed!"
```

**Step 2: Run test**

Run: `chmod +x scripts/test-ecosystem.sh && ./scripts/test-ecosystem.sh`
Expected: All tests pass

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add integration test script"
```

---

## Summary

| Phase | Tasks | Purpose |
|-------|-------|---------|
| 1 | 1-3 | Foundation: beads, plugin structure, orchestrator |
| 2 | 4-9 | Specialist agents: Architecture, Product, Coding, QA, Code Review, Security |
| 3 | 10-13 | Merge tree skills: decompose, visualize, merge-up, rebalance |
| 4 | 14-16 | GitLab integration: pull-comments, push-mr, update-claude |
| 5 | 17-19 | Hooks: session-start, pre-push security, registration |
| 6 | 20-21 | Templates: design doc, MR description |
| 7 | 22-23 | Final assembly: complete install, integration test |

Total: 23 tasks across 7 phases
