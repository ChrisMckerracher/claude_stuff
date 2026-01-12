# GitLab Stack Design Validation Report

**Design reviewed:** `docs/plans/architect/gitlab-stack-design.md`
**Date:** 2026-01-11
**Status:** APPROVED

## Checklist

- [x] Clear problem statement
- [x] Solution addresses problem directly
- [x] No unnecessary features (YAGNI)
- [x] User value is clear
- [x] Success criteria defined

---

## Executive Summary

This design solves a real, painful problem for developers managing large features that require multiple MRs. The tree-based approach (vs. linear stacking) combined with agent-assisted breakdown and cherry-pick roll-up provides genuine differentiation from existing tools. The design integrates cleanly with the existing ecosystem.

**Recommendation: APPROVE**

---

## 1. Does This Solve a Real User Problem?

**Verdict: YES - High value problem**

### The Problem is Real

Stacked MRs are a known pain point in GitLab/GitHub workflows:

| Pain Point | How Design Addresses |
|------------|---------------------|
| Linear chains cascade rebases on any change | Tree structure - parallel leaves don't cascade |
| Manual splitting is error-prone | Agent-assisted breakdown (Architect + Product) |
| Tracking stack state across sessions | Persistent `docs/mr-stacks/{name}.md` tracking |
| Messy merge history | Cherry-pick roll-up creates clean N commits |
| No visibility into what blocks what | Tree visualization with MR status |

### User Value

1. **Reduced cognitive load** - Agent analyzes boundaries, user approves
2. **Faster reviews** - Smaller, focused MRs are easier to review
3. **Parallel development** - Team members can work on different leaves
4. **Clean history** - Cherry-pick roll-up avoids merge commit noise
5. **Recoverable state** - Tracking doc survives sessions and agent handoffs

---

## 2. Is the Workflow Intuitive?

**Verdict: YES - with minor clarifications needed**

### Strengths

1. **Single entry point**: `/gitlab-stack` as primary command
2. **Human validation gate before action**: User approves breakdown before branches are created
3. **Familiar concepts**: Uses existing git/MR mental models
4. **Clear status aliases**: `/gitlab-stack-status` and `/gitlab-stack-rollup` are self-explanatory

### Concerns (Minor)

| Concern | Severity | Recommendation |
|---------|----------|----------------|
| "Stack" terminology vs "Tree" | Low | Keep "stack" - industry standard term, tree is implementation detail |
| User needs to understand cherry-pick | Low | Most devs know this; hide complexity in automation |
| When to use `/gitlab-stack` vs `/decompose` | Medium | See recommendation below |

**Recommendation on decompose vs gitlab-stack:**

The design correctly identifies this distinction on line 50:
> "/gitlab-stack is MR-focused, while /decompose is task-focused. They can work together or independently."

Suggest adding a decision flowchart to user-facing docs:

```
Q: Do you need GitLab MRs?
├── YES → /gitlab-stack (MRs first, optional beads linking)
└── NO → /decompose (beads tasks, optional MRs later)
```

---

## 3. Does It Integrate Well with Existing Features?

**Verdict: YES - Clean integration**

### Integration Points Analysis

| Existing System | Integration | Assessment |
|-----------------|-------------|------------|
| `.worktrees/` | Reuses existing worktree infrastructure | Excellent - no duplication |
| `/decompose` + beads | Optional linking via labels | Clean - works together or apart |
| `/gitlab-push-mr` | Uses same `glab` commands | Consistent |
| `/review` + `/security` | Runs on root branch before main merge | Proper gate placement |
| Human validation gates | 3 gates defined (breakdown, pre-rollup, pre-main) | Follows ecosystem pattern |

### Namespace Separation

The design explicitly avoids collision with epic-worktree:

- Epic worktrees: `.worktrees/bd-xxxx/` with branches `epic/{id}/*`
- Stack worktrees: `.worktrees/{stack-name}/` with branches `stack/{name}/*`

This is a thoughtful design decision.

### Tracking Document Pattern

Using `docs/mr-stacks/{name}.md` follows the established pattern of:
- `docs/spelunk/` for codebase exploration
- `docs/plans/` for designs
- `docs/mr-stacks/` for MR coordination

Consistent with ecosystem conventions.

---

## 4. UX Concerns

### 4.1 The Collaborative Breakdown Dialog (Lines 116-138)

**Concern:** The mock dialog shows Architect and Product agents presenting sequential analysis. In practice, will this feel conversational or like reading two reports?

**Recommendation:** Consider presenting a unified summary with attributed insights:

```
Proposed MR Tree for auth-system:

[MR] auth-system -> main
├── [MR] 1-middleware (200 lines) - enables other teams immediately
├── [MR] 2-routes (350 lines) - user-facing value, requires middleware
└── [MR] 3-tests (150 lines) - gates final merge

Rationale:
- Architect: Natural boundaries at module level
- Product: #1 unblocks downstream teams; ship incrementally

Approve? [y/n/discuss]
```

This presents the same information more compactly.

### 4.2 Error Recovery UX

The design covers edge cases well (conflict during merge, leaf update after merge, abandoning stack). However, the error messages could be more actionable.

**Example improvement for conflict recovery (line 456-460):**

Current:
> "Report conflict to user. Abort merge, leave clean state."

Suggested messaging:
```
CONFLICT: Cannot merge 1-middleware into auth-system

Conflicting files:
  - src/middleware/auth.ts (both modified)

Next steps:
  1. cd .worktrees/auth-system
  2. git merge stack/auth-system/1-middleware
  3. Resolve conflicts in your editor
  4. git add . && git commit
  5. Run /gitlab-stack-rollup to continue
```

### 4.3 Status Visibility

The `/gitlab-stack-status` output (lines 370-380) is well-designed:

```
Stack: auth-system
Status: 2/3 MRs merged

[x] !101 1-middleware (merged)
[~] !102 2-routes (in review - 2 comments)
[_] !103 3-tests (draft)

Root MR !100: Awaiting !102, !103
```

**Minor suggestion:** Add GitLab URL shortcut for quick access:

```
Stack: auth-system | https://gitlab.com/org/repo/-/merge_requests?scope=all&search=auth-system
```

---

## 5. Scope Creep Assessment

### In Scope (Appropriate)

- MR tree creation with agent analysis
- Cherry-pick roll-up
- Tracking documents
- Status commands
- Integration with existing skills

### Not In Scope (Correctly Deferred)

The design avoids scope creep by NOT including:
- Automatic conflict resolution (reports, doesn't fix)
- GitLab Premium-only features (MR dependencies noted but not required)
- Complex multi-repo scenarios
- Notification/webhook integrations

### YAGNI Compliance

The design follows YAGNI principles. Features are practical and necessary for the core workflow.

---

## 6. Open Questions / Gaps

| Question | Severity | Recommendation |
|----------|----------|----------------|
| What if user wants linear chain, not tree? | Low | Tree is superset; single-child tree = chain. No action needed. |
| GitLab vs GitHub support? | Medium | Design is GitLab-specific (glab). Consider abstraction layer in V2. |
| Large diffs may overwhelm agent analysis | Low | Document recommended max diff size; suggest pre-splitting for huge features |

---

## Findings Summary

### Aligned with Product Goals

1. **Solves real pain** - Stacked MRs are a known developer frustration
2. **Leverages agent strengths** - Boundary analysis is where AI adds value
3. **Respects human authority** - 3 validation gates, never auto-merges to main
4. **Persistent state** - Tracking docs survive sessions (key ecosystem pattern)
5. **Composable** - Works with or without beads, integrates with existing skills

### Minor Concerns (Non-Blocking)

1. **Decision guidance needed** - When to use `/gitlab-stack` vs `/decompose`
2. **Error messaging** - Could be more actionable (minor polish)
3. **GitHub coverage** - Future consideration, not blocking for GitLab-focused users

---

## Recommendation

**APPROVE** - This design is ready for implementation.

The `/gitlab-stack` skill addresses a real workflow pain point with a well-architected solution. The tree-based approach is genuinely innovative compared to linear stacking tools. Integration with the existing agent ecosystem is clean and follows established patterns.

Suggested implementation priority:
1. Core workflow (create, status, rollup)
2. Agent-assisted breakdown
3. Tracking document generation
4. Integration polish (beads linking, review gates)

---

## Appendix: Competitive Context

For reference, existing stacking tools:

| Tool | Approach | Limitation `/gitlab-stack` addresses |
|------|----------|--------------------------------------|
| ghstack | Linear chain | Cascading rebases |
| git-machete | Tree structure | No agent assistance |
| graphite.dev | Linear, SaaS | GitLab not supported, no self-host |
| spr | Linear chain | GitHub only |

The agent-assisted breakdown is the key differentiator - no existing tool has AI analyze boundaries and propose splits.
