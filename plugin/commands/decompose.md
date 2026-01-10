---
description: Break a feature into a merge tree of dependent tasks
allowed-tools: ["Bash", "Read", "Glob", "Write", "TodoWrite"]
argument-hint: "<feature description>"
---

# Decompose Feature into Task Tree

Break the given feature into a merge tree of tasks with proper dependencies.

## Process

1. Understand the feature scope
2. Identify major components/phases
3. Break each component into ~500 line tasks
4. Define dependencies (what blocks what)
5. Create beads tasks with `bd create`

## Task Sizing Guidelines

- Target: ~500 lines of changes per task
- Too big (>800 lines): Split into sub-tasks
- Too small (<100 lines): Consider combining
- Each task should be independently testable

## Creating Tasks

```bash
# Create parent task
bd create "feature-name" --description "Feature description"

# Create child tasks
bd create "feature-name/subtask-1" --description "Subtask description"
bd create "feature-name/subtask-2" --description "Another subtask" --dep "feature-name/subtask-1"
```

## Output

After creating tasks, run `/visualize` to show the resulting tree.
