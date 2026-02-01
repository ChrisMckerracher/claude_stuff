---
name: code
description: Use when implementing tasks, or understanding code relationships in a codebase
---

# /code

Invoke the Coding Agent.

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
   - If blocked: STOP - wait for blockers to complete
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

### Task Completion

After implementation and tests pass:

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
# (Tasks that were blocked only by this task)

# 6. Close task bead
bd close "${task_id}" --reason "Merged to epic"
```

## What Happens

1. Coding Agent activates with TDD workflow
2. Navigates to task worktree
3. Retrieves design doc from bead
4. Writes tests first, then implementation
5. On completion: merges to epic, creates worktrees for unblocked tasks

**REQUIRED SUB-SKILL:** superpowers:test-driven-development

## Merge Conflicts

If merge conflict occurs:
- Try to resolve it (most are straightforward)
- If too gnarly or unclear, ask human for help

## Examples

### Implement a task

```bash
/code claude_stuff-abc.1

# Agent:
# 1. cd .worktrees/claude_stuff-abc.1/
# 2. Reads design doc from bd show --json | jq '.design'
# 3. Implements with TDD
# 4. Merges to epic, cleans up worktree
```

### Task is blocked

```bash
/code claude_stuff-abc.2
# Agent checks: blocked_by: ["claude_stuff-abc.1"]
# Response: "Task blocked by claude_stuff-abc.1. Wait for it to complete."
```
