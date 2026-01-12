# Decompose Scripts Design

**Status:** IMPLEMENTED (retroactive documentation)
**Date:** 2026-01-11
**Implementation:** `plugin/scripts/decompose-init.sh`, `plugin/scripts/decompose-task.sh`

---

## Problem Statement

The `/decompose` skill had manual instructions for creating epics and worktrees that agents frequently skipped or executed incorrectly. During the gitlab-stack implementation:

1. Agent created `claude_stuff-ruu` as a **task** instead of **epic** (missing `-t epic`)
2. Agent skipped worktree creation entirely
3. Implementation happened directly on master instead of isolated worktree

**Root cause:** Prose instructions are unreliable. Agents may skip steps, use wrong flags, or forget validation.

---

## Solution

Apply the "agent thinks, script acts" principle from gitlab-stack:

| Before | After |
|--------|-------|
| 9-step manual process | 2 script calls |
| Agent runs each git/bd command | Script handles all commands |
| No validation | Built-in validation |
| Easy to skip steps | Can't skip - it's one command |

---

## Design

### Script 1: `decompose-init.sh`

**Purpose:** Create epic bead with worktree in one atomic operation.

**Input:**
```bash
decompose-init.sh "Feature Name" "Description"
```

**Operations:**
1. Validate environment (git repo, bd command, jq)
2. Create epic bead with `-t epic -p 0`
3. Create branch `epic/{epic_id}` from current HEAD
4. Create worktree at `.worktrees/{epic_id}/`
5. Set label `active-branch:{current_branch}`
6. Update `.gitignore` if needed
7. Validate worktree exists
8. Validate branch exists

**Output:** `epic_id` to stdout (all logs to stderr)

**Error handling:** Exits non-zero with message if any step fails.

### Script 2: `decompose-task.sh`

**Purpose:** Create task bead with branch in epic's worktree.

**Input:**
```bash
decompose-task.sh <epic_id> "Task Title" "Description" [blocker_id...]
```

**Operations:**
1. Validate epic exists and has worktree
2. Create task bead with `-t task -p 1`
3. In worktree: create branch `task/{task_id}` from `epic/{epic_id}`
4. Add dependency: task blocks epic
5. Add optional blocker dependencies
6. Validate task branch exists

**Output:** `task_id` to stdout (all logs to stderr)

**Error handling:** Exits non-zero with message if any step fails.

---

## Branch Naming Convention

```
epic/{epic_id}              # Epic branch (has worktree)
├── task/{task_id_1}        # Task branch (in epic worktree)
├── task/{task_id_2}        # Task branch (in epic worktree)
└── task/{task_id_3}        # Task branch (in epic worktree)
```

All task branches are created from the epic branch and live in the epic's worktree.

---

## Dependency Model

```
epic/{epic_id}
    ↑ blocked by
    ├── task_1 (ready - no blockers)
    ├── task_2 (ready - no blockers)
    └── task_3 (blocked by task_1, task_2)
```

- Every task blocks the epic (epic can't complete until tasks done)
- Tasks can optionally block each other
- Leaf tasks (no blockers) are "ready to work"

---

## SKILL.md Integration

The skill becomes simple:

```markdown
## Process

1. Analyze the design doc
2. Identify task boundaries
3. Create epic:
   ```bash
   epic_id=$(plugin/scripts/decompose-init.sh "Name" "Desc")
   ```
4. Create tasks:
   ```bash
   task1=$(plugin/scripts/decompose-task.sh "$epic_id" "Task 1" "Desc")
   task2=$(plugin/scripts/decompose-task.sh "$epic_id" "Task 2" "Desc" "$task1")
   ```
5. Report tree to user
```

**Agent's only responsibility:** Decide *what* tasks to create and their dependencies.

---

## Validation Built Into Scripts

### decompose-init.sh validates:
- In a git repository
- `bd` command available
- `jq` command available
- On a branch (not detached HEAD)
- Epic bead created successfully
- Branch created successfully
- Worktree created successfully
- Worktree appears in `git worktree list`

### decompose-task.sh validates:
- Epic bead exists
- Epic worktree directory exists
- Epic branch exists
- Task bead created successfully
- Task branch created successfully

---

## Error Recovery

If a script fails partway through:

| Failure Point | State | Recovery |
|---------------|-------|----------|
| Epic bead creation | Nothing created | Re-run script |
| Branch creation | Orphan bead | `bd delete {id}`, re-run |
| Worktree creation | Branch exists, no worktree | `git worktree add` manually |
| Task bead creation | Nothing created | Re-run script |
| Task branch creation | Orphan bead | `bd delete {id}`, re-run |

Scripts are not fully transactional, but failures are rare and recovery is straightforward.

---

## Comparison with gitlab-stack

| Aspect | gitlab-stack | decompose |
|--------|--------------|-----------|
| Script complexity | 1500+ lines | ~350 lines total |
| Main script | `gitlab-stack.sh` | `decompose-init.sh` + `decompose-task.sh` |
| Creates | MR stack with GitLab integration | Epic + tasks with worktree |
| External deps | `glab` CLI | `bd`, `jq` |
| Worktree location | `.worktrees/{stack-name}/` | `.worktrees/{epic_id}/` |

Both follow "agent thinks, script acts" - agent provides intent, script handles mechanics.

---

## Future Improvements

1. **Transactional rollback** - If worktree creation fails, clean up the bead
2. **decompose-cleanup.sh** - Remove failed/abandoned epics cleanly
3. **Dry-run mode** - Show what would be created without doing it
4. **JSON output mode** - For programmatic consumption

---

## Appendix: Full Script Signatures

```bash
# Create epic with worktree
# Returns: epic_id
decompose-init.sh "Feature Name" "Feature description"

# Create task in epic worktree
# Returns: task_id
decompose-task.sh <epic_id> "Task Title" "Task description" [blocker_id...]
```

---

*Note: This design document was written retroactively after implementation. The implementation preceded the documentation, which violates our standard process. Documented here for completeness.*
