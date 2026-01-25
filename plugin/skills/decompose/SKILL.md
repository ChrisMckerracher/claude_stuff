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
4. **Link architecture doc** - each task description MUST include:
   ```
   **Architecture doc:** docs/plans/architect/<feature>.md
   ```
5. **Create epic** with worktree:
   ```bash
   epic_id=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-init.sh "Feature Name" "Description")
   ```
6. **Create tasks** with dependencies (include arch doc in description):
   ```bash
   # Task description includes architecture doc reference
   desc="Implement X

**Architecture doc:** docs/plans/architect/feature-name.md"

   # Independent tasks (can run in parallel)
   task1=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 1" "$desc")
   task2=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 2" "$desc")

   # Dependent task (blocked by task1)
   task3=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 3" "$desc" "$task1")

   # Task blocked by multiple
   task4=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Task 4" "$desc" "$task1" "$task2")
   ```
7. **Report** task tree to user

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
# User asks: "Decompose the auth feature from docs/plans/architect/auth-design.md"

# 1. Agent reads design, identifies 3 tasks
arch_doc="docs/plans/architect/auth-design.md"

# 2. Create epic
epic_id=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-init.sh "Auth System" "JWT-based user authentication")
# Output: claude_stuff-abc

# 3. Create tasks (each description includes architecture doc reference)
middleware=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Auth Middleware" "JWT validation middleware

**Architecture doc:** $arch_doc")
# Output: claude_stuff-def

routes=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "User Routes" "User API endpoints

**Architecture doc:** $arch_doc" "$middleware")
# Output: claude_stuff-ghi

tests=$(${CLAUDE_PLUGIN_ROOT}/plugin/scripts/decompose-task.sh "$epic_id" "Auth Tests" "Integration tests

**Architecture doc:** $arch_doc" "$middleware" "$routes")
# Output: claude_stuff-jkl

# 4. Report to user
# "Created epic claude_stuff-abc with 3 tasks..."
```

## After Decompose

Once tasks exist:
- Use `/code` to implement tasks (in `.worktrees/{epic_id}/`)
- Use `/merge-up` when leaf tasks complete
- Epic merges to original branch when all tasks done
