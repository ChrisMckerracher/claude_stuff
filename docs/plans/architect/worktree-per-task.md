# Worktree-per-Task Design

**Status:** Draft - Product Concerns Addressed
**Date:** 2026-01-11
**Author:** Architecture Agent
**Supersedes:** Partial update to `epic-worktree-integration.md`

---

## Problem Statement

### Problem 1: Single Worktree Blocks Parallel Execution

The current `decompose-task.sh` creates task branches inside the epic's worktree:

```
.worktrees/
  epic-id/           # Single worktree
    ├── (checkout task/task-1)   # Can only have ONE checked out
    └── (checkout task/task-2)   # Conflicts with above
```

When two `/code` agents run in parallel on different tasks, they fight over which branch is checked out. Only one task can be worked on at a time per epic.

**Evidence:** Attempting to run `/code claude_stuff-bu8` and `/code claude_stuff-z1g` in parallel resulted in both agents working in the same directory without proper branch isolation.

### Problem 2: Agent Prompts Lack Worktree Instructions

The `/code` command prompt (`plugin/commands/code.md`) has **zero** worktree or git workflow instructions:

```markdown
# Current /code prompt (lines 1-48)
- Pre-flight: bd show, bd ready, check design doc
- Implementation: TDD workflow
- Completion: bd close
# NO MENTION OF:
- Navigating to worktree
- Checking out branch
- Where to make edits
```

The worktree awareness logic in `plugin/skills/code/SKILL.md` is never injected into the agent prompt. The agent works wherever it happens to start.

---

## Solution

### Part 1: Create Worktree per Task

**After:**
```
.worktrees/
  epic-id/           # Epic worktree (merge target for tasks)
  task-id-1/         # Task worktree (parallel work)
  task-id-2/         # Task worktree (parallel work)
```

Each task gets its own worktree, enabling true parallel execution.

### Part 2: Update Agent Prompts with Mandatory Worktree Navigation

Add explicit, non-optional worktree navigation to the `/code` command prompt.

---

## Design Changes

### 1. `plugin/scripts/decompose-task.sh`

**Current behavior (lines 114-127):**
- Creates task branch in epic worktree
- Checks out task branch in epic worktree
- No separate task worktree

**New behavior:**
```bash
# After creating task branch in epic worktree...

# Create task worktree from the task branch
log_info "Creating task worktree..."
git worktree add "${project_root}/.worktrees/${task_id}" "task/${task_id}"

log_info "  Task worktree: .worktrees/${task_id}/"
```

**Updated output:**
```
[INFO] Task created successfully!
[INFO]   Task ID: claude_stuff-bu8
[INFO]   Branch: task/claude_stuff-bu8
[INFO]   Worktree: .worktrees/claude_stuff-bu8/    # NEW
[INFO]   Epic worktree: .worktrees/claude_stuff-mm6/
```

### 2. `plugin/commands/code.md` (THE ACTUAL AGENT PROMPT)

**Add new section after Pre-flight Checks:**

```markdown
### Navigate to Task Worktree (REQUIRED)

Before ANY implementation, you MUST navigate to the task's worktree:

1. **Get project root:**
   ```bash
   project_root=$(git rev-parse --show-toplevel)
   # If in a worktree, find the main repo:
   project_root=$(dirname "$(git rev-parse --git-common-dir)")
   ```

2. **Navigate to task worktree:**
   ```bash
   cd "${project_root}/.worktrees/<task-id>"
   ```

3. **Verify correct branch:**
   ```bash
   git branch --show-current
   # Should show: task/<task-id>
   ```

4. **If worktree doesn't exist:**
   - Error: "No worktree found. Was this task created via /decompose?"
   - Do NOT proceed with implementation

**CRITICAL:** All file edits MUST happen in the task worktree, not the main repo or epic worktree.
```

### 3. `plugin/agents/coding.md`

**Add to Execute Mode section after step 3:**

```markdown
3b. **Navigate to task worktree:**
    ```bash
    cd .worktrees/<task-id>/
    ```
    Verify: `git branch --show-current` shows `task/<task-id>`
```

### 4. `plugin/skills/code/SKILL.md`

**Update Worktree Awareness section (lines 16-48):**

```markdown
## Worktree Awareness

Before starting work on a task:

1. **Find project root** (works from any worktree or main repo)
   ```bash
   project_root=$(dirname "$(git rev-parse --git-common-dir)")
   ```

2. **Navigate to task worktree** (NOT epic worktree)
   ```bash
   cd "${project_root}/.worktrees/${task_id}"
   ```

3. **Verify correct branch**
   Branch should already be `task/${task_id}` (worktree is on this branch)

4. **Run bd commands from project root**
   ```bash
   bd --cwd "${project_root}" update ${task_id} --status in_progress
   ```
```

---

## Directory Structure (Updated)

```
${project_root}/                    # Main repo (merge target)
├── .worktrees/
│   ├── epic-id/                    # Epic worktree (on epic/epic-id branch)
│   ├── task-id-1/                  # Task worktree (on task/task-id-1 branch)
│   └── task-id-2/                  # Task worktree (on task/task-id-2 branch)
├── .beads/                         # Beads data (only in main repo)
└── (rest of repo files)
```

---

## Branch Naming (Updated)

```
main                                # Active branch
├── epic/{epic-id}                  # Epic branch (has worktree)
│   ├── task/{task-id-1}            # Task branch (has worktree)
│   └── task/{task-id-2}            # Task branch (has worktree)
```

Task branches are created from the epic branch. Each has its own worktree.

---

## Workflow Changes

### Task Creation (`/decompose`)

```bash
# 1. Create epic (unchanged)
epic_id=$(decompose-init.sh "Feature" "Description")

# 2. Create task (UPDATED - now creates worktree)
task_id=$(decompose-task.sh "$epic_id" "Task" "Description")
# Creates:
#   - Branch: task/${task_id} (from epic/${epic_id})
#   - Worktree: .worktrees/${task_id}/
```

### Task Implementation (`/code`)

```bash
# 1. Get task info
bd show ${task_id}

# 2. Navigate to task worktree (NEW - MANDATORY)
cd .worktrees/${task_id}/

# 3. Verify branch
git branch --show-current  # task/${task_id}

# 4. Implement (TDD)
# ... all edits in this worktree ...

# 5. Close task
bd close ${task_id}
```

### Task Merge (`/merge-up`)

```bash
# 1. From task worktree, commit work
cd .worktrees/${task_id}/
git add -A && git commit -m "Complete ${task_id}"

# 2. Navigate to epic worktree
cd .worktrees/${epic_id}/

# 3. Merge task branch
git merge task/${task_id}

# 4. Delete task branch
git branch -d task/${task_id}

# 5. Remove task worktree
git worktree remove .worktrees/${task_id}

# 6. Close task bead
bd close ${task_id}
```

---

## Merge Topology

### Task Branch Base: Current Epic HEAD

Task branches are ALWAYS created from the **current** epic HEAD, not a stale snapshot:

```bash
# In decompose-task.sh, when creating task branch:
cd "${epic_worktree}"
git checkout "epic/${epic_id}"
git pull --ff-only  # Ensure we have latest epic state
git checkout -b "task/${task_id}"
```

This means:
- Task-1 created at epic T0
- Task-1 merges → epic now at T1
- Task-2 created at epic T1 (has Task-1's changes)

### Sibling Conflict Resolution

When parallel tasks exist and one merges first:

```
Time T0: epic HEAD = A
         task-1 branches from A
         task-2 branches from A

Time T1: task-1 completes, merges → epic HEAD = B
         task-2 still based on A (stale)

Time T2: task-2 tries to merge into B
         → Potential conflict if both touched same files
```

**Resolution strategy:** The merging task handles conflicts.

```bash
# In /merge-up for task-2:
cd .worktrees/${epic_id}/
git merge task/${task_id}

# If conflict:
#   Option A: Resolve inline and commit
#   Option B: Abort, rebase task branch, retry
#
# Agent chooses. Either works.
```

**Conflict prevention (preferred):** `/decompose` should allocate files to avoid overlap. See `epic-worktree-integration.md` Gap 1 for file allocation rules.

---

## Parallel Execution (Enabled)

```
Claude A → .worktrees/task-1/ → task/task-1 branch → edits files
Claude B → .worktrees/task-2/ → task/task-2 branch → edits files (parallel!)
Claude C → .worktrees/task-3/ → task/task-3 branch → edits files (parallel!)
```

No conflicts during work because each Claude has:
- Own worktree directory
- Own branch already checked out
- Own copy of all files

Conflicts (if any) are resolved at merge-up time, not during parallel work.

---

## Bug Fix: Unbound Variable

While implementing, discovered bug in `decompose-task.sh` line 138:

```bash
# BROKEN: Empty array causes "unbound variable" with set -u
for blocker in "${blockers[@]}"; do

# FIXED: Check length first
if [[ ${#blockers[@]} -gt 0 ]]; then
    for blocker in "${blockers[@]}"; do
        ...
    done
fi
```

---

## Files to Modify

| File | Change |
|------|--------|
| `plugin/scripts/decompose-task.sh` | Add worktree creation, fix unbound variable |
| `plugin/commands/code.md` | Add mandatory worktree navigation section |
| `plugin/agents/coding.md` | Add worktree step to Execute Mode |
| `plugin/skills/code/SKILL.md` | Update to use task worktree |
| `plugin/scripts/statusline.sh` | Create (already done in worktree) |

---

## Testing Plan

| Test Case | Expected Result |
|-----------|-----------------|
| Create task via decompose | Task worktree created at `.worktrees/{task-id}/` |
| Run `/code` on task | Agent navigates to task worktree before editing |
| Two parallel `/code` agents | Each works in own worktree, no conflicts |
| `/code` without worktree | Error: "Was this task created via /decompose?" |
| Merge-up after task complete | Task worktree removed cleanly |

---

## Migration

Existing tasks without worktrees:
- Manual: `git worktree add .worktrees/{task-id} task/{task-id}`
- Or re-create via `/decompose`

Existing epics continue to work (epic worktrees unchanged).

---

## Success Criteria

1. Parallel `/code` agents work without conflicts
2. Each task has isolated worktree
3. Agent prompts explicitly require worktree navigation
4. Error if worktree missing (fail-fast)
5. Clean merge-up removes task worktrees

---

## Product Validation Response

The Product Agent noted that `epic-worktree-integration.md` Gap 3 (lines 536-607) already specifies worktree navigation for `/code` - it was designed but never implemented.

**This design implements Gap 3** by adding the navigation logic to the actual agent prompt (`plugin/commands/code.md`), not just the reference documentation.

Additionally, this design goes beyond Gap 3:
- **Gap 3** assumed one worktree per epic (navigate to epic worktree, checkout task branch)
- **This design** creates one worktree per task (navigate directly to task worktree)

The worktree-per-task approach solves the parallel execution problem that Gap 3 alone cannot address.

---

## Disk Usage Consideration

Product Agent raised concern about disk usage (10 tasks = 10 repo clones).

**Mitigation:**
- Task worktrees are temporary (removed on merge-up)
- Typical epic has 3-5 concurrent tasks, not 10+
- Git worktrees share `.git` objects (only working files duplicated)
- `/decompose` can warn if creating >5 parallel tasks

**Acceptable tradeoff** for parallel execution capability.

---

## References

- `docs/plans/architect/epic-worktree-integration.md` - Original epic worktree design (Gap 3 referenced)
- `docs/plans/architect/decompose-scripts-design.md` - Decompose script architecture
- `plugin/commands/code.md` - Current /code agent prompt (to be updated)
