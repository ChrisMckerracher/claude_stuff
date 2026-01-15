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
   ```

6. **Complete task using task-complete.sh**
   ```bash
   # When implementation and tests pass:
   ${CLAUDE_PLUGIN_ROOT}/plugin/scripts/task-complete.sh ${task_id}
   ```

## What Happens

1. Coding Agent activates with TDD workflow
2. Claims task from ready queue
3. Writes tests first, then implementation
4. On completion, `task-complete.sh`:
   - Commits work on task branch
   - Merges task branch to epic branch
   - Rebases all dependent task branches
   - Closes the task bead
   - Reports what was merged/rebased

**REQUIRED SUB-SKILL:** superpowers:test-driven-development

## Task Completion Workflow

When completing a task, use `/task-complete <task_id>` or call `task-complete.sh` directly:

```bash
# From within the epic worktree
task-complete.sh claude_stuff-abc.1
```

This replaces the manual `bd close` step with automatic:
- Merge to epic branch
- Dependent task rebase
- Bead closure

If merge conflicts occur, resolve them in the worktree and re-run the command.

## Examples

### Complete a task with automatic merge

```bash
/code claude_stuff-abc.1
# ... agent implements task ...
# On completion, runs:
task-complete.sh claude_stuff-abc.1
# Output: {"merged": true, "rebased": ["claude_stuff-abc.2"]}
```

### Handle merge conflict

```bash
task-complete.sh claude_stuff-abc.1
# ERROR: MERGE CONFLICT
# cd .worktrees/claude_stuff-abc
# git status
# [resolve conflicts]
# git add resolved-files
# git commit
# task-complete.sh claude_stuff-abc.1  # Re-run
```
