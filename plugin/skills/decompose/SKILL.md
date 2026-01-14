---
name: decompose
description: Use when breaking a feature or design into a merge tree of dependent tasks
---

# /decompose

Break a feature into a merge tree of tasks with proper dependencies.

## Process

1. **Analyze** the design doc or feature description
2. **Identify** natural boundaries (components, layers, files)
3. **Plan** tasks targeting ~500 lines each (max 1000)
4. **Create epic** with worktree:
   ```bash
   epic_id=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-init.sh "Feature Name" "Description")
   ```
5. **Create tasks** with dependencies:
   ```bash
   # Independent tasks (can run in parallel)
   task1=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 1" "Description")
   task2=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 2" "Description")

   # Dependent task (blocked by task1)
   task3=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 3" "Description" "$task1")

   # Task blocked by multiple
   task4=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 4" "Description" "$task1" "$task2")
   ```
6. **Report** task tree to user

## Scripts

### `decompose-init.sh`

Creates epic bead + worktree. Handles:
- Epic bead with `-t epic`
- Branch `epic/{epic_id}`
- Worktree at `.worktrees/{epic_id}/`
- Label `active-branch:{current_branch}`
- Updates `.gitignore`
- Validates everything

**Output:** `epic_id` to stdout

### `decompose-task.sh`

Creates task bead + branch in epic worktree. Handles:
- Task bead with `-t task`
- Branch `task/{task_id}` in worktree
- Dependency: task blocks epic
- Optional blocker dependencies

**Output:** `task_id` to stdout

## Output Format

Report to user in plain language:

```
Feature: Auth System
├── middleware (ready) - JWT validation layer
├── routes (blocked by middleware) - User API endpoints
└── tests (blocked by middleware, routes) - Integration tests

Worktree: .worktrees/claude_stuff-xxx/
Ready to work: middleware
```

## Size Guidelines

| Lines | Action |
|-------|--------|
| < 500 | Good task size |
| 500-1000 | Acceptable |
| > 1000 | Split further |

## Example

```bash
# User asks: "Decompose the auth feature from docs/plans/auth-design.md"

# 1. Agent reads design, identifies 3 tasks

# 2. Create epic
epic_id=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-init.sh "Auth System" "JWT-based user authentication")
# Output: claude_stuff-abc

# 3. Create tasks
middleware=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Auth Middleware" "JWT validation")
# Output: claude_stuff-def

routes=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "User Routes" "API endpoints" "$middleware")
# Output: claude_stuff-ghi

tests=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Auth Tests" "Integration tests" "$middleware" "$routes")
# Output: claude_stuff-jkl

# 4. Report to user
# "Created epic claude_stuff-abc with 3 tasks..."
```

## After Decompose

Once tasks exist:
- Use `/code` to implement tasks (in `.worktrees/{epic_id}/`)
- Use `/merge-up` when leaf tasks complete
- Epic merges to original branch when all tasks done
