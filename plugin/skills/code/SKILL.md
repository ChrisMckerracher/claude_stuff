---
name: code
description: Use when implementing tasks, or understanding code relationships in a codebase
---

# /code

Invoke the Coding Agent.

> **Teammates:** When running as a teammate in an agent team, this skill uses inter-agent messaging instead of Task() subagent spawning. The Orchestrator (team lead) spawns you and you communicate results via messages.

## Usage

`/code` - Start implementing next ready task
`/code examine` - Analyze code relationships and patterns
`/code <task-id>` - Implement specific task

## Worktree Flow

### Before Implementation

1. **Check task is ready:**
   ```bash
   bd show {task-id} --json
   # Check status is "open" and blocked_by is empty
   ```

2. **Navigate to task worktree:**
   ```bash
   project_root=$(git rev-parse --show-toplevel)
   cd "${project_root}/.worktrees/{task-id}/"
   ```

3. **Verify correct branch:**
   ```bash
   git branch --show-current
   # Should show: task/{task-id}
   ```

4. **If worktree doesn't exist:**
   - Check if task is blocked: `bd show {task-id} --json | jq '.blocked_by'`
   - If blocked: STOP - message lead: "Task blocked by [list]. Waiting."
   - If unblocked but missing worktree: create it (see /decompose)

5. **Retrieve design doc:**
   ```bash
   design_doc=$(bd show {task-id} --json | jq -r '.design // empty')
   # Read the design doc for implementation guidance
   ```

6. **Claim task:**
   ```bash
   bd update {task-id} --status in_progress
   ```

7. **Message QA teammate** for parallel test generation:
   ```
   Message QA teammate: "Generate tests for task {task-id}.
   Design doc: {design-doc-path}
   Focus on: [key behaviors to test]"
   ```

### Implementation (TDD)

**REQUIRED SUB-SKILL:** superpowers:test-driven-development

1. Write failing test first (coordinate with QA teammate's tests)
2. Implement minimal code to pass
3. Refactor
4. Verify all tests pass

### Code Review via Teammate Messaging

After implementation passes tests:

```
Message Code Review teammate: "Code review needed for task {task-id}.
Changed files: [list]
Worktree: .worktrees/{task-id}/
Branch: task/{task-id}"
```

Handle feedback received via messages:
- APPROVED -> proceed to pre-commit gate
- ITERATE:INTERNAL -> fix issues, re-request review
- ESCALATE:ARCHITECTURE -> message lead about architecture concern

### Pre-Commit Gate

```
Message lead: "Implementation complete for task {task-id}.
Files modified: [list]
Summary: [brief description]
Ready to commit?"
```

**CRITICAL:** NEVER auto-commit. Wait for lead to relay human approval.

### Task Completion

After human approves commit:

```bash
project_root=$(git rev-parse --show-toplevel)
epic_id="${task_id%%.*}"  # Extract epic root from task ID

# 1. Commit work in task worktree
cd "${project_root}/.worktrees/${task_id}"
git add -A
git commit -m "Complete ${task_id}: <description>"

# 2. Switch epic worktree to epic branch
cd "${project_root}/.worktrees/${epic_id}"
git checkout "epic/${epic_id}"

# 3. Merge task to epic
git merge --no-ff "task/${task_id}" -m "Merge ${task_id}"
# If conflict: try to resolve it. If too gnarly, ask human.

# 4. Cleanup task worktree and branch
cd "$project_root"
git worktree remove ".worktrees/${task_id}"
git branch -d "task/${task_id}"

# 5. Check for newly unblocked tasks - create their worktrees

# 6. Close task bead
bd close "${task_id}" --reason "Merged to epic"
```

## What Happens

1. Coding Agent activates with TDD workflow
2. Navigates to task worktree
3. Retrieves design doc from bead
4. Messages QA teammate for parallel test generation
5. Writes tests first, then implementation
6. Messages Code Review teammate for review
7. On approval: messages lead for pre-commit gate
8. On human approval: merges to epic, creates worktrees for unblocked tasks

## Spelunk Mode (for Other Teammates)

When other teammates (Architect, Product, QA, Security) message requesting codebase exploration:

```
Message received: "Need spelunk: /code spelunk --for=<agent> --focus='<area>'"

Process:
1. Run spelunk exploration with specified lens and focus
2. Write results to docs/spelunk/{lens}/{focus-slug}.md
3. Message requesting teammate: "Spelunk complete.
   Docs ready at: docs/spelunk/{lens}/{focus-slug}.md
   Summary: [key findings]"
```

## Merge Conflicts

If merge conflict occurs:
- Try to resolve it (most are straightforward)
- If too gnarly or unclear, message lead for human help

## Examples

### Implement a task

```bash
/code claude_stuff-abc.1

# Agent:
# 1. cd .worktrees/claude_stuff-abc.1/
# 2. Reads design doc from bd show --json | jq '.design'
# 3. Messages QA teammate for parallel tests
# 4. Implements with TDD
# 5. Messages Code Review for review
# 6. On approval, messages lead for commit gate
# 7. Merges to epic, cleans up worktree
```

### Task is blocked

```bash
/code claude_stuff-abc.2
# Agent checks: blocked_by: ["claude_stuff-abc.1"]
# Messages lead: "Task blocked by claude_stuff-abc.1. Wait for it to complete."
```
