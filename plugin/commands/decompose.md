---
description: Break a feature into a merge tree of dependent tasks
allowed-tools: ["Bash", "Read", "Glob", "Write", "TodoWrite"]
argument-hint: "<design-doc-path or feature description>"
---

# Decompose Feature into Task Tree

Break the given feature into a merge tree of tasks with proper git worktrees and branches.

## Prerequisites

- Must be in a git repository on a branch (not detached HEAD)
- Must have `bd`, `jq` commands available
- Design doc should be approved by Product Agent before decomposing

## Process

1. Read the design document or understand the feature scope
2. Identify major components/phases
3. Break each component into ~500 line tasks
4. Define dependencies (what blocks what)
5. Create epic and tasks using the decompose scripts (NOT raw `bd create`)

## Task Sizing Guidelines

- Target: ~500 lines of changes per task
- Too big (>800 lines): Split into sub-tasks
- Too small (<100 lines): Consider combining
- Each task should be independently testable

## Creating Epic and Tasks (REQUIRED WORKFLOW)

**IMPORTANT:** Always use the decompose scripts to create proper git worktrees and branches.

### Step 1: Create the Epic (parent)

```bash
# Creates epic bead + epic branch + worktree at .worktrees/{epic_id}/
epic_id=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-init.sh "Feature Name" "Feature description from design doc")
```

This creates:
- Epic bead with `-t epic` and P0 priority
- Branch: `epic/{epic_id}`
- Worktree: `.worktrees/{epic_id}/`
- Label: `active-branch:{current-branch}` for merge-up target

### Step 2: Create Tasks (children)

```bash
# Create first task (no blockers)
task1=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 1 title" "Task 1 description")

# Create task blocked by task1
task2=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 2 title" "Task 2 description" "$task1")

# Create task blocked by multiple tasks
task3=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 3 title" "Task 3 description" "$task1" "$task2")
```

Each task creates:
- Task bead with `-t task` and P1 priority
- Branch: `task/{task_id}` (created from epic branch in worktree)
- Dependency: task blocks epic (epic waits for task)
- Blocker dependencies if specified

## Example: Full Decomposition

```bash
# 1. Create epic
epic_id=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-init.sh "Feature Name" "Feature description from design doc")

# 2. Create first task (no blockers)
task1=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 1 title" "Task 1 description")

# 3. Create task blocked by task1
task2=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 2 title" "Task 2 description" "$task1")

# 4. Create task blocked by multiple tasks
task3=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "Task 3 title" "Task 3 description" "$task1" "$task2")

# 5. Show the tree
echo "Epic: $epic_id"
echo "Tasks: $task1 (ready), $task2 (blocked by $task1), $task3 (blocked by $task1 $task2)"
```

## Output

After creating tasks, run `/visualize` to show the resulting tree with:
- Epic and task hierarchy
- Git branches created
- Worktree location
- Which tasks are ready vs blocked

## What NOT to Do

Do NOT use raw `bd create` for decomposition:
```bash
# WRONG - no worktrees, no branches, no proper epic type
bd create "feature-name" --description "..."
bd create "feature-name/subtask-1" --description "..."
```

Always use the decompose scripts to get proper git integration.
