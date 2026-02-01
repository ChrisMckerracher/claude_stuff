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
4. **Create epic** with worktree (see Worktree Flow below)
5. **Create tasks** with dependencies
6. **Report** task tree to user

## Worktree Flow

### Epic Creation

```bash
# 1. Record active branch
active_branch=$(git branch --show-current)
project_root=$(git rev-parse --show-toplevel)

# 2. Create epic bead with design doc reference
epic_json=$(bd create "Epic: Feature Name" -t epic -p 0 \
  -d "Description" \
  --design="docs/plans/architect/feature.md" \
  --json)
epic_id=$(echo "$epic_json" | jq -r '.id')

# 3. Create epic branch + worktree
git branch "epic/${epic_id}"
mkdir -p "${project_root}/.worktrees"
git worktree add "${project_root}/.worktrees/${epic_id}" "epic/${epic_id}"

# 4. Set active-branch label (for merge-up later)
bd update "$epic_id" --add-label "active-branch:${active_branch}"

# 5. Update .gitignore
grep -q "^\.worktrees/$" .gitignore || echo ".worktrees/" >> .gitignore
```

### Task Creation

**Unblocked tasks** (no dependencies) - create worktree immediately:

```bash
# Get design doc from epic
epic_design=$(bd show "$epic_id" --json | jq -r '.design // empty')

# Create task bead
task_json=$(bd create "Task title" -t task -p 1 \
  -d "Description" \
  --design="$epic_design" \
  --json)
task_id=$(echo "$task_json" | jq -r '.id')

# Add dependency: task blocks epic
bd dep add "$epic_id" "$task_id"

# Create task branch from epic
cd "${project_root}/.worktrees/${epic_id}"
git checkout "epic/${epic_id}"
git checkout -b "task/${task_id}"

# Create task worktree
cd "$project_root"
git worktree add ".worktrees/${task_id}" "task/${task_id}"
```

**Blocked tasks** (has dependencies) - bead only, NO worktree:

```bash
# Create task bead only
task_json=$(bd create "Task title" -t task -p 1 \
  -d "Description" \
  --design="$epic_design" \
  --json)
task_id=$(echo "$task_json" | jq -r '.id')

# Add dependencies
bd dep add "$epic_id" "$task_id"      # Task blocks epic
bd dep add "$task_id" "$blocker_id"   # Blocker blocks this task

# NO branch, NO worktree - created when blockers complete
```

**Key rule:** Blocked tasks get NO branch and NO worktree until their blockers merge to epic.

### Why Blocked Tasks Wait

When a blocker completes:
1. Blocker merges to epic branch
2. Newly unblocked task creates branch from **updated** epic HEAD
3. Task worktree contains all previously merged work

This ensures dependent tasks always start with their dependencies' changes.

## Output Format

Report to user in plain language:

```
Feature: Auth System
├── middleware (ready) - JWT validation layer
├── routes (blocked by middleware) - User API endpoints
└── tests (blocked by middleware, routes) - Integration tests

Worktree: .worktrees/{epic-id}/
Ready to work: middleware
```

## Size Guidelines

| Lines | Action |
|-------|--------|
| < 500 | Good task size |
| 500-1000 | Acceptable |
| > 1000 | Split further |

## After Decompose

Once tasks exist:
- Use `/code` to implement tasks (in `.worktrees/{task-id}/`)
- Tasks merge to epic when complete
- Epic merges to original branch when all tasks done
