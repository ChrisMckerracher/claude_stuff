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

Feature: [name]
├── Task A (ready) - [description]
├── Task B (ready) - [description]
└── Task C (blocked by A, B)
    ├── Task C.1 (ready) - [description]
    └── Task C.2 (ready) - [description]

Ready to work: Task A, Task B, Task C.1, Task C.2

## Size Guidelines

- Target: 500 lines per task
- Maximum: 1000 lines (emergency only)
- If task > 1000 lines: decompose further

## Beads Commands (invisible to user)

# Create task
bd create "Task title" -t task -p 1 -d "Description" --json

# Add blocking dependency
bd dep add <child-id> <parent-id> --type blocks

# Show tree
bd dep tree <root-id>
