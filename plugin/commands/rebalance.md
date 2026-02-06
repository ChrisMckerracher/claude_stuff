---
description: Rebalance task tree when tasks are too large or too small
allowed-tools: ["Bash", "Read", "Write", "TodoWrite"]
argument-hint: "[task-id]"
---

# Rebalance Task Tree

Adjust task sizes to maintain ~500 line target per task.

## Triggers for Rebalancing

- Task estimated >800 lines → Split into subtasks
- Task estimated <100 lines → Consider combining with sibling
- Task scope changed significantly during implementation

## Process

### For Oversized Tasks

1. Identify logical split points
2. Create new child tasks: `bd create <parent>/<new-child>`
3. Move relevant work to new tasks
4. Update dependencies

### For Undersized Tasks

1. Identify related sibling tasks
2. Combine if they form a logical unit
3. Update task description
4. Close the absorbed task

## Guidelines

- Keep tasks independently testable
- Maintain clear boundaries
- Update documentation to reflect changes
- Run `/visualize` after rebalancing to verify tree structure
