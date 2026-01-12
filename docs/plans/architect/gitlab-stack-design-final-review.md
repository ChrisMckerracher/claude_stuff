# GitLab Stack Design - Final Architecture Validation

**Design Document:** `docs/plans/architect/gitlab-stack-design.md`
**Review Date:** 2026-01-11
**Review Type:** Final validation before implementation
**Verdict:** **APPROVED**

---

## Executive Summary

The GitLab Stack Design has been updated to address all architectural concerns raised in the initial review (`gitlab-stack-design-review.md`) and product validation (`gitlab-stack-design-v2.md`). All 5 "Must Fix" items have been addressed. The design is now implementation-ready.

| Category | Previous Status | Current Status |
|----------|-----------------|----------------|
| File Content Integrity | APPROVED with gaps | COMPLETE |
| Programmatic Script Architecture | APPROVED with gaps | COMPLETE |
| Race Condition Protection | NOT ADDRESSED | COMPLETE |
| MR Description Pipeline | NEEDS REVISION | COMPLETE |
| Error Recovery | NOT SPECIFIED | COMPLETE |

---

## Validation Checklist

### 1. Binary File Detection Protocol

**Location:** Lines 596-649

**Requirement (from review):** Binary files cannot use text-based extraction tools.

**Implementation:**
- Detection via `file --mime-encoding` checking for "binary"
- Copy strategy table differentiating text vs binary handling
- `copy_file()` function routes to `git checkout` for binaries
- Manifest extension with `type` field for explicit binary marking
- Constraint documented: "Binary files cannot be split"

**Verdict:** COMPLETE

The binary protocol follows a defensive pattern - when detection fails, treat as binary (safe default). The implementation prevents corruption of images, PDFs, and other non-text assets.

---

### 2. UTF-8/CRLF Edge Cases

**Location:** Lines 651-693

**Requirement (from review):** Line splitting can fail on edge cases.

**Implementation:**
- Edge case table documents: multi-byte UTF-8, CRLF, no trailing newline, BOM markers
- `split_file_safe()` function uses `awk` instead of `sed` for safer boundary handling
- Post-split validation checks output is valid text
- Pre-split validation checklist for agent responsibility

**Verdict:** COMPLETE

The design acknowledges that perfect handling is complex and provides both runtime validation (script) and pre-flight validation (agent). The `awk` recommendation is sound - it handles character boundaries better than `sed`.

---

### 3. Stack Name Validation

**Location:** Lines 774-806

**Requirement (from review):** Prevent collision with beads namespace (`bd-*`).

**Implementation:**
- `validate_stack_name()` function with three checks:
  1. Cannot start with `bd-` (reserved for beads)
  2. Cannot contain `/` (used in branch paths)
  3. Must be valid git branch name component
- Validation runs before any operations in `create_stack()`

**Verdict:** COMPLETE

The namespace separation between beads (`bd-*`) and stacks is now enforced at the validation layer, preventing accidental collisions.

---

### 4. Error Recovery and Rollback Protocol

**Location:** Lines 808-941

**Requirement (from review):** Script needs transaction-like semantics.

**Implementation:**
- Three-phase model clearly documented:
  - Phase 1: VALIDATE (no side effects)
  - Phase 2: CREATE (with rollback on failure)
  - Phase 3: COMMIT (point of no return)
- `rollback_stack()` function handles cleanup:
  - Closes any created MRs
  - Removes worktree
  - Deletes local and remote branches
  - Removes tracking doc
- ERR trap ensures rollback on any failure during Phase 2
- `check_branch_available()` validates before creation

**Verdict:** COMPLETE

The transaction semantics are well-defined. The "point of no return" is correctly identified as the push to remote. Before that, full rollback is possible.

---

### 5. Concurrent Creation Race Condition Protection

**Location:** Lines 922-941 (`check_branch_available()`)

**Requirement (from review):** Two users running `/gitlab-stack` simultaneously on same branch.

**Implementation:**
- `check_branch_available()` checks both local and remote:
  ```bash
  git rev-parse --verify "stack/${stack_name}"  # Local
  git ls-remote --heads origin "stack/${stack_name}"  # Remote
  ```
- Clear error message with actionable advice:
  > "Use a different stack name or run 'gitlab-stack.sh abandon' first"

**Verdict:** COMPLETE

This is a check-then-act pattern, which has a small TOCTOU (time-of-check-time-of-use) window. However, for this use case:
- The window is small (milliseconds between check and `git branch`)
- If collision occurs, the subsequent `git branch` will fail safely
- User gets clear error message

For a CLI tool (not a high-concurrency service), this level of protection is appropriate.

---

### 6. Rollup Race Condition Protection

**Location:** Lines 1049-1141

**Requirement (from review):** Rollup while leaf MR still being updated.

**Implementation:**
- `rollup_commits_safe()` function with:
  1. Verification that all leaf MRs are in `merged` state via GitLab API
  2. State checking for each MR: `glab api "projects/:fullpath/merge_requests/${mr}"`
  3. Clear error if any MR is not merged, with actionable options
  4. `git fetch` before cherry-pick to ensure latest state
  5. Cherry-pick error handling with recovery instructions

**Verdict:** COMPLETE

The pre-rollup verification is thorough. The design correctly identifies that checking MR state via API is authoritative - if GitLab says it's merged, it's merged. The cherry-pick failure handling with recovery instructions is a good addition.

---

### 7. Tiered MR Description Pipeline

**Location:** Lines 1653-1680 (tier detection) + Lines 1686-1767 (implementation)

**Requirement (from review):** Full 3-agent pipeline is excessive for small changes.

**Implementation:**
- Size-based tier selection:
  | Tier | Lines Changed | Agents |
  |------|---------------|--------|
  | Small | < 50 | 1 (Spelunk only) |
  | Medium | 50-200 | 2 (Spelunk + Architect) |
  | Large | > 200 | 3 (Spelunk + Product + Architect) |
- `get_mr_size_tier()` function for detection
- Pseudocode implementation for tiered analysis
- Cost/latency comparison table

**Verdict:** COMPLETE

The tiering is sensible. Small changes (typo fixes, config tweaks) don't need product perspective. Medium changes need technical rationale. Large changes benefit from full analysis. This reduces agent invocations from 15 (for 5 MRs) to potentially 5-9 depending on size distribution.

---

### 8. Parallel Product + Architect Execution

**Location:** Lines 1769-1849

**Requirement (from review/product validation):** Parallelize when possible.

**Implementation:**
- Execution flow diagram showing:
  - Spelunk must complete first (sequential)
  - Product and Architect run concurrently (parallel)
  - Craft waits for both (sequential)
- `run_parallel()` implementation using `concurrent.futures`
- Latency analysis: reduces wall-clock time from 3 sequential to 2 sequential steps

**Verdict:** COMPLETE

The parallelization is correctly designed. Product and Architect have no dependency on each other - both read from Spelunk output. The design correctly identifies this as reducing latency even when total token cost is similar.

---

## New Technical Issues Analysis

Reviewing the updated design for any new issues introduced:

### Issue 1: `awk` vs `sed` Performance (Minor)

**Location:** Line 670

The switch to `awk` for safer splitting is correct, but `awk` can be slower for very large files.

**Assessment:** Non-blocking. The safety improvement outweighs the marginal performance cost. Files being split are typically manageable sizes (hundreds of lines, not millions).

### Issue 2: `glab api` Rate Limiting (Minor)

**Location:** Lines 1067-1088

The rollup verification queries GitLab API for each MR in a loop.

**Assessment:** Non-blocking. For typical stacks (3-10 MRs), this is well under rate limits. If stacks get larger, consider batching or parallel API calls. Document this as a known limitation for stacks > 20 MRs.

### Issue 3: Parallel Execution Implementation (Clarification Needed)

**Location:** Lines 1799-1809

The `run_parallel()` pseudocode uses Python's `concurrent.futures`. The actual skill implementation language is not specified.

**Assessment:** Non-blocking. The pseudocode is for illustration. Implementation can use whatever async/parallel mechanism is available in the skill execution environment.

---

## Transaction Semantics Completeness

Reviewing the Phase 1/2/3 model for completeness:

| Phase | Operations | Rollback Strategy | Side Effects |
|-------|------------|-------------------|--------------|
| 1: VALIDATE | Check manifest, files, auth, branch availability | None needed | None |
| 2: CREATE | Worktree, branches, files, MRs, tracking doc | Full rollback on ERR | Reversible |
| 3: COMMIT | Push to remote | None (point of no return) | Permanent |

**Assessment:** COMPLETE

The phase model is sound. The only gap is if Phase 3 (push) partially fails:
- If first branch push succeeds but second fails, partial state on remote

**Mitigation already present:** The design pushes all branches at the end. If any push fails, the script exits with error. User can manually clean up remote branches if needed. This is acceptable for a CLI tool.

---

## Race Condition Summary

| Race Condition | Protection | Residual Risk |
|----------------|------------|---------------|
| Concurrent stack creation | `check_branch_available()` | Small TOCTOU window, fails safely |
| Rollup during leaf update | `rollup_commits_safe()` with API verification | None - authoritative check |
| Parallel MR creation (multi-user) | Not in scope | Each user creates different stacks |

**Assessment:** All identified race conditions are addressed appropriately for a CLI tool.

---

## Cross-Reference: Review Findings

Mapping original review findings to design sections:

| Review Finding | Design Section | Line Numbers | Status |
|----------------|----------------|--------------|--------|
| Gap 1.1: Binary files | Binary File Protocol | 596-649 | ADDRESSED |
| Gap 1.2: File splitting boundaries | UTF-8 and Line Ending Edge Cases | 651-693 | ADDRESSED |
| Gap 2.1: Manifest commit messages | (Deferred) | - | OUT OF SCOPE |
| Gap 2.2: Script error recovery | Error Recovery and Rollback Protocol | 808-941 | ADDRESSED |
| Issue 4.1: Pipeline overhead | Tiered Description Pipeline | 1653-1849 | ADDRESSED |
| Issue 4.2: Ephemeral spelunk | (Deferred) | - | OUT OF SCOPE |
| Race 1: Concurrent creation | check_branch_available() | 922-941 | ADDRESSED |
| Race 2: Parallel rollup | Rollup Race Condition Protection | 1049-1141 | ADDRESSED |
| Stack name validation | Stack Name Validation | 774-806 | ADDRESSED |

**Deferred items are explicitly documented** in the "Remaining Items (Out of Scope)" section (lines 1962-1970).

---

## Implementation Readiness Checklist

| Criterion | Status |
|-----------|--------|
| Core workflow defined | YES |
| Human gates specified | YES |
| Agent/script boundary clear | YES |
| File integrity constraints documented | YES |
| Error handling specified | YES |
| Race conditions addressed | YES |
| Manifest schema complete | YES (enough for v1) |
| Integration points identified | YES |
| Edge cases documented | YES |
| Rollback semantics defined | YES |

---

## Final Verdict

### APPROVED

The GitLab Stack Design is implementation-ready. All "Must Fix" items from the architecture review have been addressed:

1. **Binary file detection protocol** - Prevents corruption of non-text files
2. **UTF-8/CRLF edge cases** - Safer splitting with validation
3. **Stack name validation** - Namespace protection
4. **Error recovery and rollback** - Transaction semantics with cleanup
5. **Concurrent creation protection** - Branch availability check
6. **Rollup race protection** - API-based verification
7. **Tiered MR description pipeline** - Size-based agent scaling
8. **Parallel Product+Architect** - Latency optimization

### Implementation Guidance

1. **Start with:** Script architecture (`gitlab-stack.sh`)
2. **Then:** File integrity enforcement (copy_file, split_file_safe)
3. **Then:** Core workflow (create, status, sync, rollup)
4. **Then:** Feedback cycle (comments, fix)
5. **Finally:** MR description generation (can iterate based on feedback)

### Deferred Items (for v2)

- Manifest schema versioning
- Commit message templates in manifest
- Spelunk caching for description regeneration
- CRLF normalization (document only)

These are enhancements, not blockers.

---

## Signatures

**Reviewed by:** Architecture Agent
**Review type:** Final validation
**Date:** 2026-01-11
**Result:** APPROVED for implementation

---

*This review validates that all previously identified architectural concerns have been addressed. The design follows the "agent thinks, script acts" principle consistently, maintains file content integrity, and handles edge cases appropriately for a CLI tool.*
