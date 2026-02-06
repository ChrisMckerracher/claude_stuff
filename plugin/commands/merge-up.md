---
description: Handle git merge and task status when child tasks complete
allowed-tools: ["Bash", "Read"]
argument-hint: "<parent-task-id>"
---

# Merge Up

Handle git merge and task status updates when all children of a task are complete.

## Process

1. Verify all child tasks are closed: `bd show <parent-task-id>`
2. Check for merge conflicts in child branches
3. Merge child branches into parent branch
4. Run tests to verify integration
5. If tests pass, close parent task: `bd close <parent-task-id>`
6. Check if grandparent is now ready: `bd ready`

## Git Commands

```bash
# Switch to parent branch
git checkout <parent-branch>

# Merge each child
git merge <child-branch-1>
git merge <child-branch-2>

# Run tests
npm test  # or appropriate test command

# If successful, mark complete
bd close <parent-task-id>
```

## On Conflict

If merge conflicts occur:
1. List conflicting files
2. Show conflict markers
3. Ask for resolution guidance
4. Do NOT auto-resolve without approval
