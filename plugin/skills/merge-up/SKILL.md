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

Child branches (complete)
    ↓ git merge
Parent branch (updated)
    ↓ bd close
Parent bead (closed)
    ↓ check
Grandparent unblocked?

## Commands

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

## Conflict Resolution

If merge conflicts occur:
1. Report conflicts to user
2. Do NOT auto-resolve
3. After user resolves: re-run /merge-up
