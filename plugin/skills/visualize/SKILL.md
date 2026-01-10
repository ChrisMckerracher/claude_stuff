---
name: visualize
description: Use when you want to see the current task tree, progress, and what's ready to work on
---

# /visualize

Show the current merge tree in markdown format.

## Output

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

## Legend

- `[x]` Complete
- `[~]` In progress
- `[ ]` Pending
- `(blocked by X)` Has unmet dependencies

## Beads Commands (invisible)

bd list --json | jq  # Get all tasks
bd ready --json      # Get ready tasks
bd dep tree <id>     # Get dependency tree
