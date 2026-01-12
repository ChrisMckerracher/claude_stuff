# Worktree-Per-Task Validation Report

**Design reviewed:** `docs/plans/architect/worktree-per-task.md` (not yet created)
**Related design:** `docs/plans/architect/epic-worktree-integration.md` (current implementation)
**Date:** 2026-01-11
**Status:** NEEDS_REVISION

---

## User Need Statement

The user identified two problems:
1. **Parallel task blocking:** Current decompose creates one worktree per epic - all tasks in an epic share the same worktree, blocking parallel task execution
2. **Agent directory confusion:** The `/code` agent prompt has no worktree navigation - agents work in wrong directory

**Desired outcome:** Parallel task execution across multiple Claude instances.

---

## Checklist

- [x] Clear problem statement
- [x] Solution addresses problem directly
- [ ] No unnecessary features (YAGNI) - **partial concern**
- [x] User value is clear
- [ ] Success criteria defined - **missing**

---

## Findings

### Current Architecture Analysis

The existing design (`epic-worktree-integration.md`) provides:

| Element | Current State |
|---------|---------------|
| Worktree granularity | **1 worktree per epic** |
| Task isolation | Branches within shared worktree |
| Parallel support | Tasks on different branches, same worktree |
| Git locking | `index.lock` serializes operations in same worktree |

**Key limitation confirmed:** When two Claudes work on tasks in the same epic, git operations are serialized because they share the same worktree. Only cross-epic work is truly parallel.

### Problem 1: Parallel Task Blocking

**Assessment: VALID PROBLEM**

The user correctly identified that:
- One worktree per epic means tasks within an epic cannot run in true parallel
- Git's `index.lock` serializes operations when multiple Claudes work in same worktree
- This blocks the use case of spawning N Coding Agents on N ready tasks within one epic

**Proposed solution (worktree-per-task) would address this.**

### Problem 2: Agent Directory Confusion

**Assessment: VALID PROBLEM - PARTIALLY ADDRESSED IN CURRENT DESIGN**

Reviewing `/code` agent prompt (`plugin/commands/code.md`):
- No worktree awareness currently exists
- No directory verification before file operations
- Agent could modify files in wrong location

The current design (`epic-worktree-integration.md`) already specifies:
- Gap 3 mitigation: "Agent Working Directory Verification"
- A verification protocol for `/code` to navigate to correct worktree
- Session start context addition

**This gap mitigation was designed but not implemented.** The `/code` prompt needs to be updated regardless of worktree-per-task decision.

---

## Concerns

### Concern 1: Worktree-Per-Task May Be Overkill

**One worktree per epic** is already designed. The blocking issue occurs only when:
- Multiple Claudes work on tasks in the **same** epic
- They perform git operations simultaneously

Consider: How often does this actually happen in practice?
- If epics are well-scoped (3-5 tasks each), parallelism across epics may be sufficient
- The orchestrator could avoid assigning tasks from same epic to parallel Claudes

**Recommendation:** Before committing to worktree-per-task, validate that cross-epic parallelism is insufficient for the user's workflow.

### Concern 2: Resource Multiplication

Worktree-per-task means:
- 10 tasks = 10 full repo clones on disk
- For large repos, this could be 10s of GB of disk usage
- More worktrees = more cleanup complexity

**Mitigation needed:** Explicit disk space consideration and cleanup automation.

### Concern 3: Merge Complexity Increases

Current flow: `task-branch -> epic-branch -> active-branch` (2-level merge)

With worktree-per-task, what's the merge flow?
- Does each task worktree merge to epic worktree, then to active?
- Or does each task merge directly to active?

**Design must clarify merge topology.**

### Concern 4: Simpler Alternative Exists

The second problem (agent directory confusion) can be solved WITHOUT worktree-per-task:

**Just update `/code` prompt with worktree awareness:**
```markdown
## Worktree Awareness (REQUIRED)

Before ANY file operation:
1. Get task's epic: epic_root="${task_id%%.*}"
2. Navigate to worktree: cd .worktrees/${epic_root}/
3. Create/switch to task branch
4. Only then proceed
```

This was already designed in `epic-worktree-integration.md` Gap 3 but not implemented.

---

## Scope Creep Flags

| Flag | Assessment |
|------|------------|
| Worktree-per-task | May be premature optimization - validate need first |
| Agent prompt updates | Required regardless - not scope creep |

---

## Recommendation

**NEEDS_REVISION** - Split into two separate concerns:

### Immediate Action (Validated)

Update `/code` agent prompt with worktree awareness. This is already designed in the existing `epic-worktree-integration.md` (Gap 3) and should be implemented now. This alone solves Problem 2.

**Deliverable:** Update `plugin/commands/code.md` and `plugin/skills/code/SKILL.md` with worktree navigation.

### Deferred Pending Validation (Problem 1)

Before designing worktree-per-task:

1. **Validate the need:** Run parallel tasks within same epic using current design (branch-per-task in shared worktree). Measure actual blocking frequency.

2. **If blocking is frequent:** Then design worktree-per-task with:
   - Clear merge topology
   - Disk usage limits
   - Cleanup automation
   - Success criteria for parallelism improvement

3. **If blocking is rare:** Current design is sufficient. Cross-epic parallelism may meet needs.

---

## Summary

| Problem | Validated? | Solution Needed? |
|---------|------------|------------------|
| Agent directory confusion | Yes | Yes - implement existing Gap 3 design |
| Parallel task blocking | Yes | Maybe - validate frequency first |

The design document `docs/plans/architect/worktree-per-task.md` should not be created until Problem 1 is validated as a frequent real-world issue. The existing `epic-worktree-integration.md` design already has a solution for Problem 2 that just needs implementation.

---

## Next Steps

1. **Implement Gap 3 from existing design** - Update `/code` prompt with worktree awareness
2. **Test parallel execution** - Spawn 2+ Coding Agents on same-epic tasks
3. **Measure blocking** - If git lock contention is frequent, proceed with worktree-per-task design
4. **If needed:** Create `docs/plans/architect/worktree-per-task.md` with full design addressing concerns above
