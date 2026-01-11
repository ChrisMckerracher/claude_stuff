---
name: code
description: Use when implementing tasks, or understanding code relationships in a codebase
---

# /code

Invoke the Coding Agent.

## Usage

`/code` - Start implementing next ready task
`/code examine` - Analyze code relationships and patterns
`/code <task-description>` - Implement specific task

## Worktree Awareness

Before starting work on a task:

1. **Derive epic root from task ID**
   ```bash
   epic_root="${task_id%%.*}"  # e.g., bd-a3f8.2.1 -> bd-a3f8
   ```

2. **Find project root** (works from any worktree or main repo)
   ```bash
   project_root=$(dirname "$(git rev-parse --git-common-dir)")
   ```

3. **Check for worktree and navigate**
   ```bash
   if [[ -d "${project_root}/.worktrees/${epic_root}" ]]; then
     # Work in the epic's worktree
     cd "${project_root}/.worktrees/${epic_root}"
   fi
   ```

4. **Create or switch to task branch**
   ```bash
   git checkout "epic/${epic_root}/${task_id}" 2>/dev/null || \
     git checkout -b "epic/${epic_root}/${task_id}" "epic/${epic_root}"
   ```

5. **Run bd commands from project root**
   ```bash
   bd --cwd "${project_root}" update ${task_id} --status in_progress
   bd --cwd "${project_root}" close ${task_id} --reason "Done"
   ```

## What Happens

1. Coding Agent activates with TDD workflow
2. Claims task from ready queue
3. Writes tests first, then implementation
4. Closes task when complete, reports what's unblocked

**REQUIRED SUB-SKILL:** superpowers:test-driven-development
