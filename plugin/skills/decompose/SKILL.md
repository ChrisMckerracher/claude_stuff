---
name: decompose
description: Use when breaking a feature or design into a merge tree of dependent tasks
---

# /decompose

Break a feature into a merge tree of tasks with proper dependencies.

## Process

**CRITICAL**: This skill creates an EPIC (not a task) with its own worktree.
Do NOT skip steps 5-7 or agents will work directly on the current branch.

1. Read the design doc or feature description
2. Identify natural boundaries (components, layers, files)
3. Create tasks targeting 500 lines each (max 1000)
4. Establish blocking dependencies (children block parent)
5. **Create epic bead** (MUST use `-t epic` type):
   ```bash
   bd create "Epic: ${feature_name}" -t epic -p 0 -d "${description}" --json
   ```
   Store the returned ID as `${epic_id}`.

6. **Create worktree for epic** (after epic bead creation):
   ```bash
   # Variables (set these first)
   epic_id="<id from step 5>"
   active_branch=$(git branch --show-current)
   project_root=$(git rev-parse --show-toplevel)

   # Create epic branch from current HEAD
   git branch "epic/${epic_id}"

   # Create worktree in .worktrees/ subfolder
   git worktree add "${project_root}/.worktrees/${epic_id}" "epic/${epic_id}"

   # Store active branch in bead metadata
   bd update "${epic_id}" --add-label "active-branch:${active_branch}"

   # Add .worktrees/ to .gitignore if not present
   grep -q "^\.worktrees/$" .gitignore || echo ".worktrees/" >> .gitignore
   ```

7. **Verify worktree creation** (REQUIRED before proceeding):
   ```bash
   # Confirm worktree exists
   git worktree list | grep -q "${epic_id}" || { echo "ERROR: Worktree creation failed"; exit 1; }

   # Confirm label was added
   bd show "${epic_id}" | grep -q "active-branch:" || { echo "ERROR: Label not set"; exit 1; }
   ```
   If verification fails, do NOT proceed. Report error to user.

8. Create child task beads with `bd create -t task`
9. Report task tree in plain language

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
