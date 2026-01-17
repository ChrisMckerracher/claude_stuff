---
name: task-complete
description: Use when completing a task - commits work, merges to epic, rebases dependents, and closes the task bead
---

# /task-complete

Complete a task by atomically handling commit, merge to epic, dependent task rebase, and bead closure.

## Usage

```bash
/task-complete <task_id>
```

**Example:**
```bash
/task-complete claude_stuff-abc.1
```

## What It Does

The `task-complete.sh` script performs the following operations in sequence:

1. **Validates** the task exists and is open
2. **Derives** the epic root from the task ID (e.g., `claude_stuff-abc.1` -> `claude_stuff-abc`)
3. **Navigates** to the epic's worktree at `.worktrees/{epic_root}/`
4. **Commits** any pending changes on the task branch
5. **Merges** the task branch to the epic branch (with conflict detection)
6. **Rebases** all dependent task branches that have this task as a blocker
7. **Closes** the task bead with reason "Merged to epic, dependents rebased"
8. **Notifies bus** that worker is available (via `claude-bus notify-done`)
9. **Outputs** status JSON indicating what was merged/rebased

## Output

Returns JSON status on stdout:

```json
{
  "task_id": "claude_stuff-abc.1",
  "epic_id": "claude_stuff-abc",
  "merged": true,
  "rebased": ["claude_stuff-abc.2", "claude_stuff-abc.3"],
  "rebase_failed": [],
  "epic_commit": "a1b2c3d4"
}
```

## Integration with /code Workflow

The `/code` skill uses `task-complete.sh` as its final step when a task implementation is complete:

```bash
# After tests pass and code review approves
task-complete.sh "$task_id"
```

This replaces the previous manual `bd close` step, providing automatic merge and dependent rebase.

## Error Handling

| Error Scenario | Behavior | Recovery |
|----------------|----------|----------|
| Task not found | Exit with error | Check task ID |
| Task not open | Exit with error | Task already done? |
| Merge conflict | Commit work, don't merge, exit 1 | Resolve conflicts manually in worktree, re-run |
| Rebase conflict | Log conflict, continue to next dependent | Resolve manually, re-run |
| Worktree missing | Exit with error | Run `decompose-init` to recreate |

## Merge Conflict Recovery

When a merge conflict occurs:

```bash
# Script exits with error message showing:
cd .worktrees/{epic_root}
git status              # See conflicts
# Edit and resolve files
git add <resolved-files>
git commit
task-complete.sh $task_id   # Re-run this command
```

## Rebase Conflict Recovery

When a dependent task has rebase conflicts:

```bash
# Script logs conflict and continues
cd .worktrees/{epic_root}
git checkout task/{dependent_id}
# Resolve conflicts in affected files
git add <resolved-files>
git rebase --continue
```

If resolution fails:
```bash
git reset --hard epic/{epic_root}  # Abandon task work
bd open {dependent_id} --reason "Rebase failed, reopening"
```

## Edge Cases

### No Dependent Tasks

Script completes successfully with empty `rebased` array.

### Multiple Blockers

When a task has multiple blockers, it rebases each time a blocker completes:

```
task1 completes -> task3 rebases (now has task1 changes)
task2 completes -> task3 rebases again (now has task1 + task2 changes)
```

### Dependent Branch Missing

Script skips that task (logged to stderr).

## Bus Integration

When running in a multi-worker environment with `claude-bus`, this script automatically notifies the bus that the worker is available for the next task.

**Notification behavior:**
- Non-blocking: If the bus is not running, the script logs a warning but completes successfully
- The bus uses this to mark the worker as available in the LRU queue
- Any queued tasks are dispatched to the now-available worker

**Recovery:** If the bus notification fails, the orchestrator can recover by checking:
```bash
bd list --status in_progress  # Find orphaned tasks
```

**Manual notification:** If needed, you can manually notify the bus:
```bash
claude-bus notify-done <task_id>
```

## Dependencies

- `bd` - bead task management
- `jq` - JSON parsing
- `git` - version control
- `claude-bus` - (optional) for multi-worker coordination

## Script Location

```
plugin/scripts/task-complete.sh
```

## See Also

- `/code` - Main skill that invokes task-complete
- `/decompose` - Create epic and task structure
- `/merge-up` - Manual merge control (legacy)
