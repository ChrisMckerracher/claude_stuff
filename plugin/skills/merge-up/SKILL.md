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
- No unresolved merge state (check for MERGE_HEAD)

## Merge Flow (Worktree-Aware)

### Task -> Epic Branch

When completing a task in a worktree:

```bash
# 1. Commit work on task branch
git add -A
git commit -m "Complete ${task_id}: <description>"

# 2. Switch to epic branch
git checkout epic/${epic_root}

# 3. Merge task branch
git merge epic/${epic_root}/${task_id}

# 4. Delete task branch (after successful merge)
git branch -d epic/${epic_root}/${task_id}

# 5. Close bead from project root
project_root=$(dirname "$(git rev-parse --git-common-dir)")
bd --cwd "${project_root}" close ${task_id} --reason "Merged to epic branch"
```

### Auto-Cascade: Sibling Completion

When a task closes, check if all siblings are complete:

```bash
# Check if all siblings complete
parent_id="${task_id%.*}"  # e.g., bd-a3f8.2.1 -> bd-a3f8.2
all_children_complete=$(bd --cwd "${project_root}" show ${parent_id} --json | jq -r '.blocking_issues | length == 0')

if [[ "$all_children_complete" == "true" ]]; then
  # Auto-merge parent to grandparent
  # This cascades up the tree
  /merge-up ${parent_id}
fi
```

**Cascade behavior:**
- All leaves complete -> auto-merge sub-epic to parent
- If conflict -> spawn new leaf bead: "Resolve merge conflict for ${parent_id}"
- If resolution fails or stuck -> `/orchestrator` takes over, surfaces to human

### Epic -> Active Branch

When an epic is complete (all children closed) and review passes:

```bash
# 1. Get active branch from label
project_root=$(dirname "$(git rev-parse --git-common-dir)")
active_branch=$(bd --cwd "${project_root}" show ${epic_id} --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')

# 2. Switch to project root and active branch
cd ${project_root}
git checkout ${active_branch}

# 3. Merge epic branch to active branch
git merge epic/${epic_id}

# 4. Remove worktree
git worktree remove .worktrees/${epic_id}

# 5. Delete epic branch
git branch -d epic/${epic_id}

# 6. Close epic bead
bd close ${epic_id} --reason "Merged to ${active_branch}"
```

## Conflict Resolution Protocol

### 1. Detect Conflict

```bash
# Check for existing broken merge state FIRST
if [[ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]]; then
  echo "ERROR: Unresolved merge in progress"
  echo "Run 'git merge --abort' or resolve conflicts first"
  exit 1
fi

# Attempt merge
git merge epic/${epic_root}/${task_id}
# If exit code != 0 and "CONFLICT" in output -> conflict detected
```

### 2. Report to User (do NOT auto-resolve)

```
MERGE CONFLICT in .worktrees/${epic_root}/

Conflicting files:
- src/middleware/auth.ts
- src/types/user.ts

To resolve:
1. cd .worktrees/${epic_root}
2. Edit conflicting files
3. git add <resolved-files>
4. git commit
5. Re-run /merge-up
```

### 3. Abort Merge State (leave repo clean for user)

```bash
git merge --abort
```

### 4. Track Conflict in Bead Notes

```bash
bd update ${task_id} --notes "CONFLICT: auth.ts, user.ts"
```

### 5. Spawn Resolution Task if Stuck

```bash
bd create "Resolve merge conflict for ${task_id}" -t task -p 1
bd dep add <new-id> ${task_id} --type blocks
```

### 6. After Resolution

Re-run `/merge-up`, which detects no conflict and proceeds normally.

## Commands Reference

```bash
# Check children complete
bd show <parent-id> --json | jq '.blocking_issues'

# Find project root from anywhere
project_root=$(dirname "$(git rev-parse --git-common-dir)")

# Merge child branches (in worktree)
git checkout <parent-branch>
git merge <child-branch>

# Close parent (from project root)
bd --cwd "${project_root}" close <parent-id> --reason "Children merged"

# Check what's unblocked
bd ready --json
```

## Legacy Flow (Non-Worktree)

For repos without worktrees, the original flow still works:

```
Child branches (complete)
    | git merge
Parent branch (updated)
    | bd close
Parent bead (closed)
    | check
Grandparent unblocked?
```
