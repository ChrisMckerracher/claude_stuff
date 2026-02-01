# Worktree Flow v2 Design

**Status:** Draft
**Date:** 2026-02-01
**Author:** Architecture Agent
**Supersedes:** `worktree-per-task.md`, `epic-worktree-integration.md`

---

## Goal

Nail down the explicit worktree flow for the agent ecosystem:
1. Each task has its own worktree (true isolation)
2. Dependent tasks wait for blockers to merge before creating their worktree
3. Design docs are stored in beads for retrieval
4. All agent prompts and skills explicitly document this flow
5. Scripts work reliably OR agents can execute manually

---

## Worktree Topology

```
{project_root}/                     # Main repo on active branch (e.g., master)
├── .worktrees/
│   ├── {epic-id}/                  # Epic worktree (branch: epic/{epic-id})
│   ├── {task-id-1}/                # Task worktree (branch: task/{task-id-1})
│   └── {task-id-2}/                # Task worktree (branch: task/{task-id-2})
├── .beads/                         # Beads database (only in main repo)
└── docs/plans/architect/           # Design docs
```

### Branch Naming

```
master (or main)                    # Active branch - merge target for epics
├── epic/{epic-id}                  # Epic branch - merge target for tasks
│   ├── task/{task-id-1}            # Task branch (has own worktree)
│   └── task/{task-id-2}            # Task branch (has own worktree)
```

### Merge Flow

```
task/{id} → epic/{epic-id} → active branch (master/main)
```

---

## Script Strategy

**No script dependency.** Agents execute commands directly. Scripts exist as optional reference implementations at `plugin/scripts/` but skills document the explicit commands.

This avoids path resolution issues and keeps agents flexible.

---

## Lifecycle

### Phase 1: Epic Creation

```bash
# 1. Record active branch
active_branch=$(git branch --show-current)
project_root=$(git rev-parse --show-toplevel)

# 2. Create epic bead
epic_json=$(bd create "Epic: Feature Name" -t epic -p 0 \
  -d "Description" \
  --design="docs/plans/architect/feature.md" \
  --json)
epic_id=$(echo "$epic_json" | jq -r '.id')

# 3. Create epic branch
git branch "epic/${epic_id}"

# 4. Create worktree
mkdir -p "${project_root}/.worktrees"
git worktree add "${project_root}/.worktrees/${epic_id}" "epic/${epic_id}"

# 5. Set active-branch label
bd update "$epic_id" --add-label "active-branch:${active_branch}"

# 6. Update .gitignore
grep -q "^\.worktrees/$" .gitignore || echo ".worktrees/" >> .gitignore
```

### Phase 2: Task Creation

**For UNBLOCKED tasks (no dependencies):**

```bash
# 1. Create task bead (inherits design from epic)
epic_design=$(bd show "$epic_id" --json | jq -r '.design // empty')
task_json=$(bd create "Task title" -t task -p 1 \
  -d "Description" \
  --design="$epic_design" \
  --json)
task_id=$(echo "$task_json" | jq -r '.id')

# 2. Add dependency: task blocks epic
bd dep add "$epic_id" "$task_id"

# 3. Create task branch from epic
cd "${project_root}/.worktrees/${epic_id}"
git checkout "epic/${epic_id}"
git checkout -b "task/${task_id}"

# 4. Create task worktree
git worktree add "${project_root}/.worktrees/${task_id}" "task/${task_id}"
```

**For BLOCKED tasks (has dependencies):**

```bash
# 1. Create task bead only - NO branch, NO worktree
task_json=$(bd create "Task title" -t task -p 1 \
  -d "Description" \
  --design="$epic_design" \
  --json)
task_id=$(echo "$task_json" | jq -r '.id')

# 2. Add dependency: task blocks epic
bd dep add "$epic_id" "$task_id"

# 3. Add blocker dependencies
bd dep add "$task_id" "$blocker1"
bd dep add "$task_id" "$blocker2"

# 4. NO branch or worktree created yet
# These are created when blockers complete
```

**Key rule:** Blocked tasks get NO branch and NO worktree at creation time.

### Phase 3: Task Unblocking

When a blocker completes (via task-complete), check for newly unblocked tasks:

```bash
# After merging blocker to epic...

# Find tasks that were blocked only by the completed task
for task in $(bd list --blocked-by "$completed_task" --json | jq -r '.[].id'); do
  # Check if task has other blockers
  other_blockers=$(bd show "$task" --json | jq -r '.blocked_by | length')

  if [[ "$other_blockers" -eq 0 ]]; then
    # Task is now unblocked - create branch and worktree from UPDATED epic
    cd "${project_root}/.worktrees/${epic_id}"
    git checkout "epic/${epic_id}"
    git checkout -b "task/${task}"
    git worktree add "${project_root}/.worktrees/${task}" "task/${task}"

    # Update status
    bd update "$task" --status open
  fi
done
```

**Result:** Unblocked tasks branch from latest epic HEAD (includes all merged work from completed blockers).

### Phase 4: Task Implementation

See Coding Agent section below.

### Phase 5: Task Completion

```bash
project_root=$(git rev-parse --show-toplevel)
epic_id="${task_id%%.*}"  # Extract epic root

# 1. Commit pending changes
cd "${project_root}/.worktrees/${task_id}"
git add -A
git diff --staged --quiet || git commit -m "Complete ${task_id}"

# 2. Merge to epic
cd "${project_root}/.worktrees/${epic_id}"
git checkout "epic/${epic_id}"
git merge --no-ff "task/${task_id}" -m "Merge ${task_id}"
# If conflict: resolve it. If too gnarly, abort and ask human.

# 3. Remove task worktree and branch
git worktree remove "${project_root}/.worktrees/${task_id}"
git branch -d "task/${task_id}"

# 4. Check for newly unblocked tasks (see Phase 3)

# 5. Close task bead
bd close "$task_id" --reason "Merged to epic"
```

### Phase 6: Epic Completion

```bash
project_root=$(git rev-parse --show-toplevel)
active_branch=$(bd show "$epic_id" --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')

# 1. Merge epic to active branch
cd "$project_root"
git checkout "$active_branch"
git merge --no-ff "epic/${epic_id}" -m "Merge epic ${epic_id}"

# 2. Remove epic worktree and branch
git worktree remove "${project_root}/.worktrees/${epic_id}"
git branch -d "epic/${epic_id}"

# 3. Close epic bead
bd close "$epic_id" --reason "Merged to ${active_branch}"
```

---

## Design Doc Storage

Store in bead's `--design` field:

```bash
# Create with design doc
bd create "Epic: Feature" -t epic --design="docs/plans/architect/feature.md"

# Update existing
bd update {id} --design="docs/plans/architect/feature.md"

# Retrieve
bd show {task-id} --json | jq -r '.design // empty'
```

Tasks inherit design doc from epic at creation time.

---

## Merge Conflict Handling

When a merge conflict occurs:

1. **Try to resolve it** - Most conflicts are straightforward (parallel edits to same file, import ordering, etc.)
2. **If you can't figure it out** - Abort and ask the human for help

No rigid rules. Use judgment. If it looks gnarly or you're unsure about intent, just ask.

---

## Explicit Agent/Skill Updates

### plugin/skills/decompose/SKILL.md

**ADD "Worktree Flow" section** with the epic/task creation commands from Phase 1 and Phase 2 above. Key points:
- Epic: create bead, branch, worktree, set active-branch label
- Unblocked task: create bead, branch, worktree immediately
- Blocked task: create bead + deps only, NO branch/worktree yet

---

### plugin/skills/code/SKILL.md

**REPLACE "Worktree Awareness" section** with:
- Navigate to `.worktrees/{task-id}/`, verify branch is `task/{task-id}`
- If worktree missing: check if blocked (wait) or unblocked (create it)
- Retrieve design doc: `bd show {task-id} --json | jq -r '.design'`
- Task completion: commit, merge to epic, handle conflicts, cleanup worktree, close bead
- Check for newly unblocked tasks after merge

---

### plugin/skills/architect/SKILL.md

**ADD to end of file:**

```markdown
## Design Doc Linkage

When decomposing features, the design doc is stored in the epic bead for agent retrieval:

```bash
# Stored at epic creation
bd update {epic-id} --design="docs/plans/architect/{feature}.md"

# Inherited by tasks at task creation
epic_design=$(bd show "$epic_id" --json | jq -r '.design')
bd create "Task" --design="$epic_design" ...

# Retrieved by Coding Agent
design_doc=$(bd show {task-id} --json | jq -r '.design')
```

This ensures any agent working on a task can find the authoritative design doc.
```

---

### plugin/agents/orchestrator.md

**REPLACE "Worktree-Aware Delegation" section with:**

```markdown
## Worktree-Aware Delegation

### Worktree Structure

```
{project_root}/
└── .worktrees/
    ├── {epic-id}/           # Epic worktree (branch: epic/{epic-id})
    ├── {task-id-1}/         # Task worktree (branch: task/{task-id-1})
    └── {task-id-2}/         # Task worktree (branch: task/{task-id-2})
```

### Merge Topology

```
task/{id} → epic/{epic-id} → {active-branch}
```

### Task Worktree Lifecycle

| Task State | Worktree Exists? | When Created |
|------------|------------------|--------------|
| Unblocked (no deps) | Yes | Immediately at decompose |
| Blocked (has deps) | No | After ALL blockers merge to epic |
| Completed | No | Removed after merge |

**Key insight:** Blocked tasks get their worktree AFTER dependencies merge, so they branch from the updated epic HEAD (containing all merged work).

### Delegation Context

When spawning Coding Agent, include:

```
Task(
  subagent_type: "agent-ecosystem:coding",
  prompt: "/code {task-id}

Design doc: {path from bd show --json | jq '.design'}
Worktree: .worktrees/{task-id}/ (exists: yes/no)
Status: ready/blocked by [list]"
)
```

### Design Doc Retrieval

```bash
# Get design doc path from bead
bd show {task-id} --json | jq -r '.design'
```
```

---

### plugin/agents/architecture.md

**ADD after "Worktree Topology" section:**

```markdown
### Design Doc Storage in Beads

When creating an epic via `/decompose`, the design doc path is stored:

```bash
bd update {epic-id} --design="docs/plans/architect/{feature}.md"
```

Tasks inherit this reference at creation. Any agent can retrieve:

```bash
design_path=$(bd show {task-id} --json | jq -r '.design // empty')
```

This replaces embedding the path in description text - it's now a first-class field.
```

---

### plugin/agents/coding.md

**REPLACE "Execute Mode" steps 1-3 with:**

```markdown
### Execute Mode

**Process:**
1. **Retrieve task and design doc:**
   ```bash
   bd show {task-id} --json
   design_doc=$(bd show {task-id} --json | jq -r '.design // empty')
   ```
   - If no design found: STOP and say "Run `/architect` first"
   - Read the design doc for implementation guidance

2. **Navigate to task worktree (REQUIRED):**
   ```bash
   project_root=$(git rev-parse --show-toplevel)
   cd "${project_root}/.worktrees/{task-id}/"
   git branch --show-current  # Verify: task/{task-id}
   ```
   - If worktree doesn't exist:
     - Check `bd show {task-id} --json | jq '.blocked_by'`
     - If blocked: STOP - "Task blocked by [list]. Wait for blockers to complete."
     - If not blocked: Create worktree manually (see /decompose manual steps)
   - All edits MUST happen in the task worktree, NOT main repo

3. **Claim task:**
   ```bash
   bd update {task-id} --status in_progress
   ```
```

---

## Files to Modify

| File | Change |
|------|--------|
| `plugin/skills/decompose/SKILL.md` | Add "Worktree Flow" section |
| `plugin/skills/code/SKILL.md` | Replace "Worktree Awareness" section |
| `plugin/skills/architect/SKILL.md` | Add "Design Doc Linkage" section |
| `plugin/agents/orchestrator.md` | Replace "Worktree-Aware Delegation" section |
| `plugin/agents/architecture.md` | Add "Design Doc Storage" section |
| `plugin/agents/coding.md` | Update Execute Mode steps 1-3 |
| `plugin/scripts/decompose-task.sh` | Update to skip worktree for blocked tasks (optional - scripts are reference only) |

---

## Testing Plan

| Test | Expected |
|------|----------|
| Create epic | Epic worktree + branch created |
| Create unblocked task | Task worktree + branch created immediately |
| Create blocked task | NO worktree, NO branch, bead only |
| Complete blocker | Blocked task gets worktree from updated epic |
| `/code` on ready task | Agent navigates to `.worktrees/{task-id}/` |
| `/code` on blocked task | Agent reports "blocked by [list]" |
| Script unavailable | Agent executes manual steps successfully |
| Retrieve design doc | `bd show --json | jq '.design'` returns path |
| Merge conflict | Agent tries to resolve; asks human if stuck |

---

## Success Criteria

1. Each task has isolated worktree (no branch switching in shared worktree)
2. Blocked tasks don't get worktrees until dependencies merge
3. Newly unblocked tasks branch from latest epic HEAD
4. Design docs retrievable via `bd show --json | jq '.design'`
5. Merge conflicts: agent tries to resolve, asks human if stuck
6. All agents/skills explicitly document the worktree flow
