# Epic-Worktree Integration Validation Report

**Design reviewed:** `docs/plans/architect/epic-worktree-integration.md`
**Date:** 2026-01-10
**Status:** NEEDS_REVISION

## Checklist
- [x] Clear problem statement
- [x] Solution addresses problem directly
- [ ] No unnecessary features (YAGNI) - *concerns about `/worktree` command*
- [ ] User value is clear - *partially hidden behind complexity*
- [x] Success criteria defined

---

## Executive Summary

The design solves a real problem (parallel Claude instances stepping on each other), but the **claimed invisibility is not fully achieved**. Users will encounter worktree concepts in error messages, recovery flows, and the new `/worktree` command. The escalation ladder shows promise but has gaps that could leave users stuck.

**Verdict:** Solid foundation, but needs UX polish before users will trust it.

---

## User Value Analysis

### Does this solve a real problem?

**YES, definitively.** The problem statement is clear and painful:

> "Parallel Claude Code instances working on the same repo risk stepping on each other."

For users running multiple Claude agents on complex features, file conflicts are a real blocker. Current workarounds (manual coordination, sequential work) waste the parallel potential of the agent ecosystem.

**However:** The design document doesn't quantify how often this happens or the severity. Is this a daily pain point or an edge case? The investment in worktree infrastructure is significant - the justification should be proportional.

### User Value Rating: 8/10

High value for power users running parallel agents. Lower value for users doing sequential work (they get complexity they don't need).

---

## User Experience Analysis

### Claim: "Users don't need to understand worktrees - it's invisible infrastructure"

**PARTIALLY FALSE.** The design leaks worktree concepts in several places:

#### 1. Error Messages Expose Implementation

From the design (Gap 3, line 592-594):
```
ERROR: Worktree not found: ${expected_worktree}
Run: /worktree create ${epic_root}
```

Users who see this error must now understand:
- What a worktree is
- Why it's missing
- That they need to run a command to create one

**This violates the "invisible" claim.**

#### 2. Conflict Recovery Requires Git Knowledge

From Gap 2 (lines 528-535):
```
MERGE CONFLICT in .worktrees/bd-a3f8/

To resolve:
1. cd .worktrees/bd-a3f8
2. Edit conflicting files
3. git add <resolved-files>
4. git commit
5. Re-run /merge-up
```

Users must:
- Navigate to a worktree directory
- Understand git merge conflict markers
- Manually resolve conflicts
- Know the correct git commands

**This is NOT invisible infrastructure.** Power users can handle it, but typical users will be confused.

#### 3. New `/worktree` Command Contradicts Invisibility

The design proposes a new `/worktree` skill with `list`, `create`, `remove`, `status` commands. If worktrees are invisible, why does the user need commands to manage them?

**This is scope creep.** Either worktrees are invisible (no user-facing commands) or they're a power-user feature (commands exist but are optional).

### User Experience Rating: 5/10

The happy path may be smooth, but the unhappy path exposes too much implementation detail.

---

## Failure Mode Analysis

### Claim: "The escalation ladder is self-healing"

**PARTIALLY TRUE.** The escalation ladder (line 76-80) is well-designed in principle:

```
1. All leaves complete -> auto-merge sub-epic to parent
2. If conflict -> spawn new leaf bead: "Resolve merge conflict for bd-a3f8.1"
3. If resolution fails or blocked -> /orchestrator takes over, surfaces to human
```

**However, gaps exist:**

#### Gap 1: What triggers "resolution fails"?

The design says if resolution "fails or blocked," escalate to orchestrator. But:
- How does the system detect a failed resolution attempt?
- How long does it wait before escalating?
- What if the spawned resolution task also conflicts?

**Users could end up with cascading resolution tasks** (resolve conflict A, which conflicts with B, which conflicts with C...).

#### Gap 2: Human escalation is vague

"Orchestrator takes over, surfaces to human" - but how?
- Is there a notification?
- Does the dashboard show it prominently?
- What actions can the human take?

The design doesn't specify the human handoff experience.

#### Gap 3: Orphaned worktrees

If an epic is abandoned mid-flight:
- Worktree remains in `.worktrees/`
- Branch remains in git
- Disk space accumulates

The `/worktree remove` command has safety checks, but there's no automatic cleanup for stale epics. Users must manually manage these.

### Recovery Rating: 6/10

Good escalation design, but incomplete specification of failure states and human handoff.

---

## Adoption Barriers

### Barrier 1: Mental Model Shift

Users currently think in terms of branches. This design introduces:
- Epics as first-class concepts (not just beads)
- Worktrees as physical locations (not just branches)
- Branch naming conventions (epic/{id}/{task-id})

**Risk:** Users may struggle to answer "where is my code?" when it's in `.worktrees/bd-a3f8/` instead of the main repo.

### Barrier 2: Disk Space

Each epic creates a full repo checkout. For large repos:
- 10 epics = 10x disk space (minus shared .git)
- SSD-constrained users will hit limits fast

**The design doesn't address disk space limits or cleanup policies.**

### Barrier 3: Git Expertise Required

Conflict resolution, branch management, and worktree navigation all require git proficiency. The target user (someone using Claude Code) may not have deep git knowledge.

**Mitigation needed:** Claude agents should handle more of the git work, with clearer guidance when human intervention is required.

### Barrier 4: Learning Curve

The design adds:
- New bead ID semantics (bd-a3f8.1.1 parsed to derive paths)
- New directory structure (.worktrees/)
- New commands (/worktree)
- New workflow (epic branches merge to active branch)

For a feature claiming to be "invisible," this is significant new surface area.

---

## Findings

### Aligned with Product Goals

1. **Parallel execution is unlocked.** Multiple Claudes CAN work on separate epics without conflicts. This is the core value proposition and it's achieved.

2. **Beads single source of truth.** All `bd` commands run from project root, solving the sync problem elegantly.

3. **Structured merge flow.** Task -> epic -> active branch is clear and auditable.

4. **Good research foundation.** The validated research on git worktree behavior (index.lock, tracked files) shows technical rigor.

### Concerns

1. **Invisibility claim is overstated.** Error paths, conflict recovery, and the /worktree command all expose implementation details.

2. **Conflict resolution UX is weak.** Asking users to `cd .worktrees/...` and manually edit files is not a polished experience.

3. **Human escalation is underspecified.** "Surfaces to human" needs concrete UI/UX design.

4. **Disk space not addressed.** Large repos with multiple epics will consume significant disk.

5. **No progressive disclosure.** Users get all complexity at once rather than gradually.

### Scope Creep Flags

- **`/worktree` command:** If worktrees are truly invisible, this command shouldn't exist. If it's needed for power users, document that worktrees are an advanced feature, not invisible infrastructure.

---

## Recommendations

### REVISE with the following changes:

#### 1. Rethink "invisible" claim

Either:
- **Option A:** Make worktrees truly invisible by having Claude agents handle ALL worktree operations, including conflict resolution. Users never see worktree paths.
- **Option B:** Acknowledge worktrees are a power-user feature. Document the mental model clearly. Keep `/worktree` command but mark it as advanced.

I recommend **Option A** for most users with Option B as an escape hatch.

#### 2. Design human-friendly conflict resolution

Instead of:
```
cd .worktrees/bd-a3f8
Edit conflicting files
git add...
```

Provide:
```
MERGE CONFLICT in task bd-a3f8.1

Conflicting files:
- src/auth/handler.ts (lines 45-52)

Options:
1. /resolve bd-a3f8.1  <- Claude helps resolve interactively
2. /abort bd-a3f8.1    <- Abandon this task's changes
3. Manual resolution   <- [detailed instructions if needed]
```

#### 3. Add disk space management

- Document expected disk usage (repo size x active epics)
- Add `/worktree gc` command for cleanup
- Consider shallow clones for large repos (if git supports worktree + shallow)

#### 4. Specify human escalation UX

- Dashboard should show escalated conflicts prominently
- Consider notifications (terminal, system)
- Document what human should do when escalated

#### 5. Remove or deprecate `/worktree` command

If worktrees are invisible, the command shouldn't exist as a user-facing feature. Keep the implementation internal; let agents use it, but don't expose it to users unless they explicitly ask.

---

## Conclusion

The design solves the right problem and the technical approach is sound. However, the **user experience for failure cases undermines the "invisible infrastructure" promise**. Before implementing, revise the conflict resolution flow and human escalation paths to match the elegance of the happy path.

**Status: NEEDS_REVISION**

Next steps:
1. Revise conflict resolution UX (recommendation #2)
2. Clarify human escalation design (recommendation #4)
3. Decide on /worktree command visibility (recommendation #1)
4. Re-validate after revisions
