# Epic-Worktree Integration Design

## Problem

Currently, parallel Claude Code instances working on the same repo risk stepping on each other. There's no isolation between epics, and the merge workflow doesn't account for worktree-based development.

## Solution

Map each beads epic to a git worktree at `.worktrees/{epic-id}/`, enabling:
- Parallel Claude Codes working on isolated epics
- Semantic branch naming that agents can derive from bead IDs
- Structured merge flow: task → epic branch → active branch

## Architecture

### Directory Structure

```
${project_root}/                    # Active branch checked out (merge target for all epics)
├── .worktrees/                     # Subfolder containing epic worktrees
│   ├── bd-a3f8/                    # Worktree for epic bd-a3f8
│   │   └── (full repo checkout on epic/bd-a3f8 branch)
│   └── bd-b2c9/                    # Worktree for epic bd-b2c9
│       └── (full repo checkout on epic/bd-b2c9 branch)
├── .beads/                         # Beads data (ONLY here - agents run bd from project root)
└── (rest of repo files)
```

**Key relationship**: The project root's checked-out branch (e.g., `main`, `develop`, `feature/foo`) is the **active branch** - the merge target for all completed epics. Epic worktrees are subfolders that merge UP into this active branch.

### Branch Naming Convention

```
epic/{epic-id}                      # Epic branch (e.g., epic/bd-a3f8)
epic/{epic-id}/{task-id}            # Task branch (e.g., epic/bd-a3f8/bd-a3f8.1)
epic/{epic-id}/{subtask-id}         # Subtask branch (e.g., epic/bd-a3f8/bd-a3f8.1.1)
```

**Derivation rule**: Given a bead ID, agents can compute:
- Worktree path: `.worktrees/{epic-root-id}/`
- Branch name: `epic/{epic-root-id}/{bead-id}`

Example: Working on `bd-a3f8.2.1`:
- Epic root: `bd-a3f8`
- Worktree: `.worktrees/bd-a3f8/`
- Branch: `epic/bd-a3f8/bd-a3f8.2.1`

### Sub-Epic Mapping

Sub-epics (e.g., `bd-a3f8.1` with its own children) stay within the parent epic's worktree but get their own branch namespace:

```
.worktrees/bd-a3f8/                 # Single worktree for entire epic tree
├── branch: epic/bd-a3f8            # Epic root branch
├── branch: epic/bd-a3f8/bd-a3f8.1  # Sub-epic branch
├── branch: epic/bd-a3f8/bd-a3f8.1.1  # Leaf task
└── branch: epic/bd-a3f8/bd-a3f8.1.2  # Leaf task
```

Sub-epic completion merges into parent epic branch, not directly to active branch.

### Sub-Epic Auto-Completion Flow

When all children of a sub-epic complete, the system auto-attempts merge:

```
bd-a3f8.1.1 closes → check: all siblings complete?
                     ├── NO → wait
                     └── YES → auto-merge bd-a3f8.1 to epic/bd-a3f8
                               ├── SUCCESS → close bd-a3f8.1, check parent
                               └── CONFLICT → create leaf "resolve bd-a3f8.1 merge"
                                              ├── RESOLVED → retry merge
                                              └── STUCK → escalate to orchestrator/human
```

**Escalation ladder:**
1. All leaves complete → auto-merge sub-epic to parent
2. If conflict → spawn new leaf bead: "Resolve merge conflict for bd-a3f8.1"
3. If resolution fails or blocked → `/orchestrator` takes over, surfaces to human

This keeps the merge tree self-healing without requiring manual `/merge-up` for every level.

---

## Research Findings (Validated)

### Git Worktree Behavior

| Aspect | Finding |
|--------|---------|
| **Concurrent merges** | Git uses `index.lock` per-worktree. Two Claudes in SAME worktree = serialized (one blocks). Two DIFFERENT worktrees = parallel OK. |
| **Finding main worktree** | `dirname "$(git rev-parse --git-common-dir)"` returns project root from any worktree |
| **Tracked files** | **DUPLICATED** - each worktree has independent copies. (Not an issue for `.beads/` since we run `bd` from project root) |

### Beads Metadata

| Aspect | Finding |
|--------|---------|
| **`bd update --set key=value`** | Does NOT exist |
| **Custom metadata** | Use labels: `--add-label "key:value"` |
| **Data location** | `.beads/beads.db` (local, gitignored) syncs to `.beads/issues.jsonl` (git-tracked) |

### Beads: Single Source of Truth

All `bd` commands run from **project root**, not from within worktrees.

```bash
# Get project root from anywhere (including worktrees)
project_root=$(dirname "$(git rev-parse --git-common-dir)")

# All bd commands target project root
bd --cwd "${project_root}" ready --json
bd --cwd "${project_root}" update ${task_id} --status in_progress
bd --cwd "${project_root}" close ${task_id} --reason "Done"
```

**Result**: Single `.beads/` directory, all Claudes see same state instantly, no sync needed.

---

## Workflow

### 1. Decompose Creates Worktree

When `/decompose` creates an epic:

```bash
# 0. Record active branch (merge target)
active_branch=$(git branch --show-current)

# 1. Create epic branch from current HEAD of active branch
git branch epic/{epic-id}

# 2. Create worktree in .worktrees/ subfolder
git worktree add .worktrees/{epic-id} epic/{epic-id}

# 3. Store active_branch in beads metadata (using labels since --set doesn't exist)
bd update {epic-id} --add-label "active-branch:${active_branch}"

# 4. Add to .gitignore if not present
grep -q "^\.worktrees/$" .gitignore || echo ".worktrees/" >> .gitignore
```

**Note**: Worktree path is derivable from epic ID (`.worktrees/{epic-id}`), so no need to store it.

### 2. Agent Claims Task

When an agent starts work on a task:

```bash
# 1. Derive epic root from bead ID
epic_root="${bead_id%%.*}"  # bd-a3f8.2.1 → bd-a3f8

# 2. Find project root (works from any worktree)
project_root=$(dirname "$(git rev-parse --git-common-dir)")

# 3. Mark bead in progress (from project root)
bd --cwd "${project_root}" update ${task_id} --status in_progress

# 4. Navigate to worktree
cd "${project_root}/.worktrees/${epic_root}"

# 5. Create or switch to task branch (safe pattern)
git checkout "epic/${epic_root}/${task_id}" 2>/dev/null || git checkout -b "epic/${epic_root}/${task_id}" "epic/${epic_root}"
```

### 3. Task Completion → Merge to Epic Branch

When a task is complete:

```bash
# 1. Commit work on task branch
git add -A
git commit -m "Complete ${task_id}: <description>"

# 2. Switch to epic branch and merge
git checkout epic/${epic_root}
git merge epic/${epic_root}/${task_id}

# 3. Delete task branch
git branch -d epic/${epic_root}/${task_id}

# 4. Close bead (from project root)
project_root=$(dirname "$(git rev-parse --git-common-dir)")
bd --cwd "${project_root}" close ${task_id} --reason "Merged to epic branch"
```

### 4. Epic Review

When all epic children are complete:

```bash
# 1. Get project root and active branch
project_root=$(dirname "$(git rev-parse --git-common-dir)")
active_branch=$(bd --cwd "${project_root}" show ${epic_root} --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')

# 2. /review runs on epic branch in worktree
cd "${project_root}/.worktrees/${epic_root}"
git checkout epic/${epic_root}

# 3. Review compares against active branch
git diff ${active_branch}...epic/${epic_root}

# 4. Security audit
# 5. Human validation gate
```

### 5. Epic Merge + Cleanup

After review passes and human approves:

```bash
# 1. Get project root and active branch
project_root=$(dirname "$(git rev-parse --git-common-dir)")
active_branch=$(bd --cwd "${project_root}" show ${epic_id} --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')

# 2. Switch to project root and active branch
cd ${project_root}
git checkout ${active_branch}

# 3. Merge epic branch to active branch
git merge epic/${epic_id}

# 4. Delete epic branch
git branch -d epic/${epic_id}

# 5. Remove worktree
git worktree remove .worktrees/${epic_id}

# 6. Close epic bead
bd close ${epic_id} --reason "Merged to ${active_branch}"
```

---

## Skill Updates Required

### `/decompose` (update)

Add worktree creation:

```markdown
## Process

1. Read the design doc or feature description
2. Identify natural boundaries (components, layers, files)
3. Create tasks targeting 500 lines each (max 1000)
4. Establish blocking dependencies (children block parent)
5. **NEW: Create worktree for epic**
   - `git branch epic/{epic-id}`
   - `git worktree add .worktrees/{epic-id} epic/{epic-id}`
   - `bd update {epic-id} --add-label "active-branch:${current_branch}"`
6. Create beads with `bd create` (invisible to user)
7. Report task tree in plain language
```

### `/code` (update)

Add worktree awareness:

```markdown
## Worktree Awareness

Before starting work:
1. Derive epic root from task ID: `{task-id}` → `{epic-root}`
2. Find project root: `dirname "$(git rev-parse --git-common-dir)"`
3. If `.worktrees/{epic-root}/` exists:
   - Work in that worktree
   - Create branch `epic/{epic-root}/{task-id}`
4. Otherwise: work in main repo (legacy behavior)
```

### `/merge-up` (update)

Add worktree merge flow:

```markdown
## Merge Flow (Worktree-Aware)

### Task → Epic Branch
If working in worktree:
1. Export beads, commit
2. Merge task branch into epic branch
3. Delete task branch
4. Close task bead, export, commit
5. Check if all epic children complete → trigger auto-merge cascade

### Epic → Active Branch
If epic is complete (all children closed):
1. Invoke `/review` on epic branch
2. Wait for human validation
3. Merge epic branch to active branch (from project root)
4. Remove worktree
5. Delete epic branch
6. Close epic bead
```

### `/review` (update)

Add multi-epic awareness:

```markdown
## Multi-Epic Review

When invoked without arguments:
1. List all epic branches with pending changes:
   ```bash
   project_root=$(dirname "$(git rev-parse --git-common-dir)")
   for wt in ${project_root}/.worktrees/*/; do
     epic_id=$(basename $wt)
     active=$(bd show $epic_id --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')
     echo "$epic_id: $(cd $wt && git rev-list --count ${active}..HEAD) commits ahead of ${active}"
   done
   ```
2. Ask user which epic to review (or "all")

When reviewing specific epic:
1. `cd .worktrees/{epic-id}`
2. Compare against active branch: `git diff ${active_branch}...epic/{epic-id}`
3. Run code review checks
4. Report findings
```

### New: `/worktree` skill (V2 - DEFERRED)

> **Deferred to V2**: Worktrees are invisible infrastructure in V1. Users don't need management commands - `/decompose` creates them automatically, `/merge-up` cleans them up.

V2 scope (if users request visibility):
- `/worktree list` - Show all epic worktrees with status
- `/worktree status` - Show current worktree context
- `/worktree remove <epic-id>` - Manual cleanup with safety checks

---

## Agent Derivation Logic

All agents need this shared logic:

```bash
# Given: bead_id (e.g., "bd-a3f8.2.1")

# Extract epic root (first segment with prefix)
epic_root="${bead_id%%.*}"  # bd-a3f8

# Find project root (works from any worktree or main repo)
project_root=$(dirname "$(git rev-parse --git-common-dir)")

# Worktree path
worktree_path="${project_root}/.worktrees/${epic_root}"

# Branch name
branch_name="epic/${epic_root}/${bead_id}"

# Check if worktree exists
if [[ -d "${worktree_path}" ]]; then
  work_dir="${worktree_path}"
else
  work_dir="${project_root}"  # Main repo (legacy or no epic)
fi
```

---

## Beads Metadata Storage

**Note**: `bd update --set key=value` does not exist. Use labels:

```bash
# Store active branch as label
bd update {epic-id} --add-label "active-branch:main"

# Retrieve active branch
bd show {epic-id} --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://'
```

Worktree path is derivable from epic ID, no storage needed:
```bash
worktree_path=".worktrees/${epic_id}"
```

---

## .gitignore Update

Add to project's `.gitignore`:

```
# Epic worktrees (generated, not tracked)
.worktrees/
```

---

## Human Validation Gates

1. **Pre-Merge Gate**: Before `epic/{epic-id}` merges to active branch
   - Review agent must pass
   - Security agent must pass
   - Human must explicitly approve

2. **Cleanup Confirmation**: Before worktree removal
   - Confirm all work is merged
   - No orphaned branches

---

## Parallel Claude Coordination

Multiple Claude instances can work on different epics:

```
Claude A → .worktrees/bd-a3f8/ → epic/bd-a3f8/bd-a3f8.1
Claude B → .worktrees/bd-a3f8/ → epic/bd-a3f8/bd-a3f8.2  (same epic, different task)
Claude C → .worktrees/bd-b2c9/ → epic/bd-b2c9/bd-b2c9.1  (different epic)
```

**Conflict prevention:**
- Beads `--status in_progress` marks claimed tasks (single `.beads/` in project root)
- Git branch per task prevents file-level conflicts
- Merge to epic branch is serialized by git's `index.lock`
- All `bd` commands run from project root = instant visibility across all Claudes

---

## Migration

Existing repos without worktrees:
- `/decompose` on new epics creates worktrees
- Existing epics: manually create worktree with `git worktree add .worktrees/{epic-id} epic/{epic-id}`
- No breaking changes to current workflow

---

## Summary

| Action | Location | Branch |
|--------|----------|--------|
| Create epic | Project root (active branch) | Creates `epic/{id}` + worktree |
| Work on task | `.worktrees/{epic}/` | `epic/{epic}/{task}` |
| Complete task | `.worktrees/{epic}/` | Merge to `epic/{epic}` |
| Review epic | `.worktrees/{epic}/` | Review `epic/{epic}` vs active branch |
| Merge epic | Project root | Merge `epic/{epic}` to active branch |
| Cleanup | Project root | Remove worktree + branch |

---

## Gap Mitigations

### Gap 1: Conflict Prevention in Decompose

When `/decompose` creates tasks, it MUST ensure tasks touch different files to prevent merge conflicts when parallel Claudes work on the same epic.

**Decompose file allocation rules:**

1. **Analyze file boundaries**: Before creating tasks, map which files each task will modify
2. **No file overlap**: Each file should belong to exactly ONE task (exceptions: shared types/interfaces)
3. **Document ownership**: Each task description includes "Files: X, Y, Z"
4. **Shared file protocol**: If multiple tasks must touch the same file:
   - Create a parent task that owns the file
   - Child tasks become sequential (blocked by each other)
   - OR split the file first, then parallelize

```bash
# Example decompose output with file ownership
Task bd-a3f8.1 (ready) - Add auth middleware
  Files: src/middleware/auth.ts, src/types/auth.ts

Task bd-a3f8.2 (ready) - Add user routes
  Files: src/routes/user.ts, src/controllers/user.ts

Task bd-a3f8.3 (blocked by .1, .2) - Integration tests
  Files: tests/integration/auth.test.ts
```

### Gap 2: Merge Conflict Recovery

When merging task branch to epic branch (or epic to active), conflicts may occur.

**Conflict handling in `/merge-up`:**

```markdown
## Conflict Resolution Protocol

1. **Detect conflict**
   ```bash
   git merge epic/${epic_root}/${task-id}
   # If exit code != 0 and "CONFLICT" in output
   ```

2. **Report to user** (do NOT auto-resolve)
   ```
   MERGE CONFLICT in .worktrees/bd-a3f8/

   Conflicting files:
   - src/middleware/auth.ts
   - src/types/user.ts

   To resolve:
   1. cd .worktrees/bd-a3f8
   2. Edit conflicting files
   3. git add <resolved-files>
   4. git commit
   5. Re-run /merge-up
   ```

3. **Abort merge state** (leave repo clean for user)
   ```bash
   git merge --abort
   ```

4. **Track conflict in bead** (using notes since --set doesn't exist)
   ```bash
   bd update ${task-id} --notes "CONFLICT: auth.ts, user.ts"
   ```

5. **Spawn resolution task if stuck**
   ```bash
   bd create "Resolve merge conflict for ${task-id}" -t task -p 1
   bd dep add <new-id> ${task-id} --type blocks
   ```

6. **After resolution**: Re-run `/merge-up`, which detects no conflict and proceeds
```

**Recovery from partially failed merge:**

```bash
# Check for broken merge state
if [[ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]]; then
  echo "ERROR: Unresolved merge in progress"
  echo "Run 'git merge --abort' or resolve conflicts first"
  exit 1
fi
```

### Gap 3: Agent Working Directory Verification

Before `/code` makes ANY file changes, it MUST verify it's in the correct worktree context.

**Verification protocol for `/code`:**

```markdown
## Working Directory Assertion (REQUIRED)

Before ANY file operation:

1. **Get task's epic root**
   ```bash
   task_id="bd-a3f8.2.1"
   epic_root="${task_id%%.*}"  # bd-a3f8
   ```

2. **Find project root and expected location**
   ```bash
   project_root=$(dirname "$(git rev-parse --git-common-dir)")
   expected_worktree="${project_root}/.worktrees/${epic_root}"
   ```

3. **Verify worktree exists**
   ```bash
   if [[ ! -d "${expected_worktree}" ]]; then
     echo "ERROR: Worktree not found: ${expected_worktree}"
     echo "Worktree missing. Re-run /decompose or manually: git worktree add .worktrees/${epic_root} epic/${epic_root}"
     exit 1
   fi
   ```

4. **Navigate to worktree**
   ```bash
   cd "${expected_worktree}"
   ```

5. **Verify/create correct branch**
   ```bash
   current_branch=$(git branch --show-current)
   expected_branch="epic/${epic_root}/${task_id}"

   if [[ "$current_branch" != "$expected_branch" ]]; then
     echo "Switching to task branch: $expected_branch"
     git checkout "$expected_branch" 2>/dev/null || git checkout -b "$expected_branch" "epic/${epic_root}"
   fi
   ```

6. **Only then proceed with file operations**
```

**Agent session start context:**

When a Claude session starts and picks up a task:

```bash
# Session start hook addition
if [[ -n "$CURRENT_TASK_ID" ]]; then
  epic_root="${CURRENT_TASK_ID%%.*}"
  project_root=$(dirname "$(git rev-parse --git-common-dir)")
  worktree="${project_root}/.worktrees/${epic_root}"

  if [[ -d "$worktree" ]]; then
    echo "Context: Working in epic worktree"
    echo "  Epic: $epic_root"
    echo "  Worktree: $worktree"
    echo "  Task: $CURRENT_TASK_ID"
    echo ""
    echo "Commands will execute in: $worktree"
  fi
fi
```
