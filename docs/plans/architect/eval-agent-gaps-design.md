# Eval Agent: Critical Gaps in Agent Ecosystem

**Status:** Draft - Awaiting Human Review
**Date:** 2026-02-06
**Author:** Architecture Agent (eval pass)

---

## Goal

Identify and prioritize critical gaps discovered by evaluating all 7 agents and 14 skills across their defined scenarios, then propose an Eval Agent to continuously monitor agent ecosystem health.

## Background

The Agent Ecosystem (v0.13.0) comprises 7 specialist agents coordinated via Claude Code's experimental teammate feature, 14 operational skills, and supporting infrastructure (spelunk, verify cycles, beads). A systematic evaluation of each agent against its documented behaviors, boundary constraints, communication patterns, and skill integrations reveals structural gaps that undermine reliability. No automated or systematic evaluation mechanism exists today - gaps are discovered reactively when agents fail in production workflows.

---

## Evaluation Methodology

Each agent was evaluated across 5 dimensions:

| Dimension | What We Checked |
|-----------|----------------|
| **Boundary Compliance** | Does the agent respect its layer constraints? |
| **Communication Contracts** | Are message patterns between teammates well-defined and bidirectional? |
| **Skill Integration** | Do skills invoke agents correctly and handle all states? |
| **Error Recovery** | What happens when a step fails? |
| **Gate Enforcement** | Are human validation gates actually enforceable? |

---

## Critical Gaps Found

### Gap 1: No Enforcement Mechanism for Documentation-Layer Isolation

**Severity:** CRITICAL
**Agents affected:** Architecture, Product, QA

**Finding:** Documentation-layer agents (Architecture, Product, QA) have `<CRITICAL-BOUNDARY>` blocks that say "NEVER read source code." But enforcement is purely prompt-based - there is no tool-level restriction, no pre-tool hook, and no post-hoc audit. If an agent reads `src/auth.ts` in violation, nothing stops it and nothing logs it.

**Evidence:**
- `plugin/agents/architecture.md:12-29` - Constraint is stated but relies on self-policing: "If you catch yourself about to Read/Glob/Grep a source file, STOP."
- `plugin/agents/product.md:14-29` - Same pattern
- `plugin/agents/qa.md:14-20` - Same pattern

**Impact:** Agents may silently read source code, bypassing the spelunk system, leading to context bloat, duplicated exploration, and wrong abstraction levels for documentation-layer decisions.

**Proposed Fix:**
1. Implement a pre-tool hook in `plugin/hooks/` that intercepts Read/Glob/Grep calls from documentation-layer agents and blocks source file patterns
2. Log violations to `docs/eval/boundary-violations.log` for audit
3. Eval Agent validates no source file reads appear in documentation-layer agent sessions

---

### Gap 2: Teammate Message Contracts Are Unvalidated

**Severity:** CRITICAL
**Agents affected:** All 7

**Finding:** Every agent defines message patterns (e.g., "Message lead: 'Design draft complete...'"), but there is no schema or contract for these messages. The receiving agent must parse free-text messages to extract task IDs, file paths, status, and verdicts. No validation exists for:
- Required fields in messages (task ID, file paths, verdict)
- Message acknowledgment (sender doesn't know if receiver processed the message)
- Message ordering (no sequence guarantees between teammates)

**Evidence:**
- `plugin/agents/orchestrator.md:152-175` - Message patterns are documented as examples
- `plugin/agents/coding.md:27-55` - Messages contain structured data embedded in prose
- `plugin/agents/code-review.md:28-51` - Verdicts like `ITERATE:INTERNAL` vs `ESCALATE:ARCHITECTURE` are conventions, not enforced types

**Impact:** Silent message drops, misrouted escalations, or agents acting on malformed messages. A Coding agent sending "ITERATE" instead of "ITERATE:INTERNAL" could confuse Code Review's routing logic.

**Proposed Fix:**
1. Define message schemas per agent pair (e.g., `CodingToReview`, `SecurityToLead`)
2. Include required fields: `{task_id, verdict, files[], summary}`
3. Eval Agent periodically validates message format compliance in session logs

---

### Gap 3: Overlapping Task Completion Skills (`/task-complete` vs `/merge-up`)

**Severity:** HIGH
**Skills affected:** task-complete, merge-up

**Finding:** Both `/task-complete` and `/merge-up` handle merging task branches to epic branches. Their responsibilities overlap:

| Capability | `/task-complete` | `/merge-up` |
|-----------|-----------------|------------|
| Merge task → epic | Yes | Yes |
| Rebase dependents | Yes | No |
| Auto-cascade | No | Yes |
| Conflict detection | Yes | Yes |
| Bead closure | Yes | Yes |

Neither skill documents when to use it versus the other. CLAUDE.md references `/task-complete` in the implementation workflow but `/merge-up` in the "Implement Task" quick reference.

**Evidence:**
- `plugin/skills/task-complete/SKILL.md` - Atomic: commit, merge, rebase, close
- `plugin/skills/merge-up/SKILL.md` - Manual: merge child to parent, auto-cascade
- `CLAUDE.md:81-86` - References both in different workflow sections

**Impact:** Agents may invoke the wrong skill, leading to skipped rebases (if using `/merge-up` instead of `/task-complete`) or missed auto-cascades (if using `/task-complete` instead of `/merge-up`).

**Proposed Fix:**
1. Consolidate into a single `/complete` skill that handles both atomic completion and cascade
2. Deprecate `/merge-up` with a redirect to `/complete`
3. Or clearly document: `/task-complete` for leaf tasks, `/merge-up` for epic-level merges only

---

### Gap 4: No Feedback Loop Between QA and Coding for Test Iteration

**Severity:** HIGH
**Agents affected:** QA, Coding

**Finding:** The workflow is defined as one-directional: Coding messages QA to generate tests, QA generates tests and hands back. But there is no defined re-iteration loop when:
- Tests fail against the implementation
- Coding changes break previously passing QA tests
- QA tests need `data-testid` attributes that Coding hasn't added yet

The QA agent's handoff message mentions "Elements needing test IDs" but there's no protocol for Coding to signal back "test IDs added, re-run tests" or for QA to signal "tests updated after your implementation changes."

**Evidence:**
- `plugin/agents/qa.md:136-147` - Handoff to Coding for test IDs, but no return loop
- `plugin/agents/coding.md:148-150` - Receives QA tests but no re-request protocol
- `plugin/skills/code/SKILL.md` - TDD workflow says "Verify all tests pass (yours + QA teammate's)" but doesn't define what happens when QA's tests fail

**Impact:** Stale tests, broken test infrastructure, or agents waiting indefinitely for handoffs that never come.

**Proposed Fix:**
1. Define a bidirectional test iteration protocol:
   - Coding → QA: "Implementation changed, please re-verify tests"
   - QA → Coding: "Tests updated, please re-run"
   - Max iteration count (3) before escalating to lead
2. Eval Agent tracks test handoff completion rates

---

### Gap 5: Security VETO Lacks Severity Definitions

**Severity:** HIGH
**Agent affected:** Security

**Finding:** The Security agent can VETO any change, but "critical" severity is not defined. The VETO rules list categories (OWASP Top 10, CVEs, secrets, auth weakening, command injection) but don't differentiate between:
- A SQL injection in a public-facing endpoint (block immediately)
- A missing CSRF token on an internal admin page (advisory?)
- A dependency with a medium-severity CVE and no known exploit (VETO or warn?)

**Evidence:**
- `plugin/agents/security.md:115-121` - VETO rules list categories without severity thresholds
- VETO report template has a "Severity" column but no defined scale
- No guidance on when to APPROVE with advisory notes vs VETO

**Impact:** Inconsistent blocking behavior. Either too many VETOs (developer frustration, workflow stalls) or too few (real vulnerabilities slip through).

**Proposed Fix:**
1. Define severity scale: CRITICAL (auto-VETO), HIGH (VETO unless mitigated), MEDIUM (advisory), LOW (informational)
2. Map each VETO rule to a default severity
3. Allow human override for MEDIUM/LOW findings
4. Eval Agent tracks VETO rate and false-positive rate over time

---

### Gap 6: Spelunk Output Quality Is Never Validated

**Severity:** HIGH
**Agents affected:** All documentation-layer agents (consumers), Coding (producer)

**Finding:** The spelunk system generates structured documentation for documentation-layer agents. But no validation exists to verify that spelunk output is:
- Complete (covers all interfaces/boundaries in the focus area)
- Accurate (correctly describes the code it analyzed)
- Sufficient (provides enough detail for the requesting agent's needs)

A stale or incomplete spelunk doc could cause Architecture Agent to design against wrong assumptions, Product Agent to miss user-facing flows, or QA to generate tests against wrong contracts.

**Evidence:**
- `plugin/skills/spelunk/SKILL.md` - Staleness checking only validates file hashes, not content quality
- `docs/spelunk/_staleness.json` - Tracks freshness, not correctness
- No agent or skill validates spelunk output before consumption

**Impact:** Garbage-in-garbage-out at the documentation layer. Wrong architectural decisions based on incomplete spelunk docs.

**Proposed Fix:**
1. Add a `confidence` field to spelunk output metadata: `{confidence: "high"|"medium"|"low", files_analyzed: N, symbols_found: N}`
2. Documentation-layer agents check confidence before relying on spelunk docs
3. Eval Agent periodically re-runs spelunk on known areas and compares output for drift

---

### Gap 7: Task Scope Enforcement Is Aspirational Only

**Severity:** MEDIUM
**Skills affected:** decompose, rebalance, code

**Finding:** The system targets 500 lines per task (max 1000) but this is never measured or enforced:
- `/decompose` says "Plan tasks targeting ~500 lines" - estimation only, no validation
- `/rebalance` provides heuristics but no actual line counting
- `/code` has no scope guard that warns when implementation exceeds the task's estimated size
- No post-implementation audit compares actual vs estimated lines

**Evidence:**
- `plugin/skills/decompose/SKILL.md` - No line counting, pure estimation
- `plugin/skills/rebalance/SKILL.md` - Heuristics like "single function < 100 lines" but no `wc -l` equivalent
- `CLAUDE.md:47` - "Target 500 lines per task, max 1000" stated as rule

**Impact:** Tasks balloon in scope, making code review harder, increasing merge conflicts, and reducing parallelization benefits.

**Proposed Fix:**
1. `/code` emits a warning when `git diff --stat` exceeds 500 lines added
2. `/task-complete` blocks with a warning if diff exceeds 1000 lines
3. Eval Agent tracks actual-vs-estimated task sizes

---

### Gap 8: Human Validation Gates Have No Timeout or Escalation

**Severity:** MEDIUM
**Agent affected:** Orchestrator

**Finding:** Three mandatory gates require human approval (Design Review, Pre-Implementation, Pre-Commit). The protocol says "wait for human response" but defines no:
- Timeout behavior (what if human doesn't respond for hours?)
- Reminder mechanism
- Escalation path
- State persistence (can the session resume after a long gap?)

**Evidence:**
- `plugin/agents/orchestrator.md:276-290` - "Never skip a mandatory gate. Never assume approval from silence. Pause means pause."
- No timeout or reminder logic in any agent definition
- Session context may be lost if human returns after long delay

**Impact:** Workflows stall indefinitely at gates. Teammates sit idle consuming resources. Context may be lost if sessions expire.

**Proposed Fix:**
1. Define gate timeout behavior: after N minutes of no response, save full context to `docs/gates/<gate-name>-<timestamp>.md` and notify
2. When human returns, context can be rehydrated from saved gate file
3. Eval Agent tracks gate wait times and identifies bottlenecks

---

### Gap 9: GitLab Skills Referenced But Not Implemented

**Severity:** MEDIUM
**Skills affected:** gitlab-pull-comments, gitlab-push-mr

**Finding:** CLAUDE.md documents `/gitlab pull-comments` and `/gitlab push-mr` as available workflows, and `test-ecosystem.sh` checks for their SKILL.md files. But the actual skill files do not exist in the codebase.

**Evidence:**
- `CLAUDE.md:90-91` - References both skills
- `scripts/test-ecosystem.sh:51-65` - Checks for both SKILL.md files
- `plugin/skills/` - Neither `gitlab-pull-comments/SKILL.md` nor `gitlab-push-mr/SKILL.md` exists

**Impact:** `test-ecosystem.sh` will fail on these checks. Users following CLAUDE.md workflow docs will encounter missing skills.

**Proposed Fix:**
1. Either implement the skills or remove references from CLAUDE.md and test script
2. Eval Agent detects documentation-vs-reality drift

---

### Gap 10: Worktree Lifecycle for Newly Unblocked Tasks Is Fragmented

**Severity:** MEDIUM
**Skills affected:** decompose, task-complete, code

**Finding:** When `/decompose` creates a blocked task, no worktree is created. When the blocking task completes, the newly unblocked task needs a worktree. This logic is scattered across three skills:
- `/decompose` creates worktrees for initially unblocked tasks only
- `/task-complete` mentions "create worktrees for unblocked tasks" but implementation details are unclear
- `/code` says "if worktree doesn't exist: create it"

No single skill owns the "create worktree for newly unblocked task" lifecycle event.

**Evidence:**
- `plugin/skills/decompose/SKILL.md` - Explicitly skips blocked tasks: "NO worktree for blocked tasks"
- `plugin/skills/task-complete/SKILL.md` - References unblocking but doesn't detail worktree creation
- `plugin/agents/coding.md:131-133` - Fallback: "If worktree doesn't exist, create worktree"

**Impact:** Race conditions or duplicate worktree creation if multiple agents detect an unblocked task simultaneously.

**Proposed Fix:**
1. Make worktree creation atomic in `/task-complete`: when closing a task, create worktrees for all newly unblocked dependents
2. `/code` retains its fallback but logs a warning if it has to create a worktree (indicates `/task-complete` missed it)
3. Eval Agent validates worktree existence matches expected task state

---

## Proposed Solution: Eval Agent

### Overview

Introduce an 8th agent - the **Eval Agent** - as a continuous quality monitor for the agent ecosystem itself. Unlike other agents that operate on user code, the Eval Agent operates on the agent ecosystem's own behaviors, contracts, and outputs.

### Eval Agent Role

| Property | Value |
|----------|-------|
| Name | eval |
| Authority | Advisory (no VETO, no blocking) |
| Layer | Meta-layer (reads agent definitions, session logs, skill outputs) |
| Teammate Role | Specialist |
| Trigger | On-demand (`/eval`) or post-session hook |

### Eval Agent Capabilities

```
/eval                    # Full ecosystem health check
/eval agent <name>       # Evaluate specific agent against its contract
/eval boundaries         # Check documentation-layer boundary compliance
/eval messages           # Validate teammate message format compliance
/eval spelunk            # Audit spelunk output quality and freshness
/eval gates              # Check gate enforcement and timing
/eval drift              # Compare docs vs implementation reality
/eval task-sizes         # Audit actual vs estimated task sizes
```

### Evaluation Scenarios

#### Scenario 1: Boundary Compliance Audit

```
For each documentation-layer agent (Architecture, Product, QA):
  1. Scan session logs for Read/Glob/Grep tool calls
  2. Check if any target paths match source patterns (src/**, lib/**, *.ts, *.py)
  3. Report violations with session ID and timestamp
  4. Calculate compliance rate: (clean_sessions / total_sessions) * 100

Expected: 100% compliance
Threshold: < 95% triggers warning, < 90% triggers alert
```

#### Scenario 2: Message Contract Validation

```
For each agent pair with defined message patterns:
  1. Extract messages from session logs
  2. Validate against expected schema:
     - Contains required fields (task_id, verdict/status)
     - Uses correct verdict values (APPROVED, ITERATE:INTERNAL, etc.)
     - Includes file paths where expected
  3. Report malformed messages and missing acknowledgments

Expected: > 98% schema compliance
Threshold: < 95% triggers warning
```

#### Scenario 3: Spelunk Quality Audit

```
For each spelunk doc in docs/spelunk/:
  1. Check staleness via _staleness.json
  2. Re-run spelunk on same focus area
  3. Compare output:
     - Symbol count delta
     - Missing interfaces/boundaries
     - New interfaces not in original doc
  4. Calculate drift score

Expected: < 10% drift for FRESH docs
Threshold: > 20% drift triggers regeneration
```

#### Scenario 4: Gate Timing Analysis

```
For each human validation gate occurrence:
  1. Record timestamp of gate presentation
  2. Record timestamp of human response
  3. Calculate wait time
  4. Track distribution of wait times
  5. Identify sessions where gates were skipped

Expected: All gates enforced, median wait < 5 minutes
Threshold: Any skipped gate is critical, median > 30 min triggers process review
```

#### Scenario 5: Task Size Validation

```
For each completed task:
  1. Get estimated size from decompose
  2. Get actual size from git diff --stat
  3. Calculate ratio: actual / estimated
  4. Flag tasks exceeding 1000 lines
  5. Track estimation accuracy over time

Expected: 80% of tasks within 0.5x-2x of estimate
Threshold: > 20% exceeding 1000 lines triggers rebalance process review
```

#### Scenario 6: Documentation Drift Detection

```
Compare documented capabilities vs actual implementation:
  1. For each skill in CLAUDE.md, verify SKILL.md exists
  2. For each agent in CLAUDE.md, verify agent .md exists
  3. For each hook reference, verify hook file exists
  4. For each template reference, verify template exists
  5. Compare agent counts, skill counts, command counts

Expected: 100% match
Threshold: Any drift is a bug
```

#### Scenario 7: Skill Dependency Chain Validation

```
For the full feature lifecycle:
  1. Trace: /product spec → QA review → /architect → /decompose → /code → /review → /security → /task-complete
  2. Verify each handoff produces expected output artifact
  3. Verify downstream skills can consume upstream outputs
  4. Identify broken links in the chain

Expected: Complete chain works end-to-end
Threshold: Any broken link is critical
```

### Eval Agent Definition

```yaml
---
name: eval
description: Evaluates agent ecosystem health by auditing boundary compliance, message contracts, spelunk quality, gate enforcement, and documentation drift. Advisory role only.
tools: Read, Glob, Grep, Bash, TodoWrite
teammate_role: specialist
---
```

### File Locations

| Type | Path | Purpose |
|------|------|---------|
| Agent definition | `plugin/agents/eval.md` | Eval agent system prompt |
| Skill definition | `plugin/skills/eval/SKILL.md` | `/eval` skill invocation |
| Eval reports | `docs/eval/` | Audit reports and trend data |
| Boundary violations | `docs/eval/boundary-violations.log` | Agent boundary violation log |
| Drift reports | `docs/eval/drift/` | Documentation vs reality reports |
| Gate timing | `docs/eval/gates/` | Gate enforcement timing data |

### Data Flow

```
Session logs ──► Eval Agent ──► docs/eval/<report>.md
                    │
Agent definitions ──┤
                    │
Skill outputs ──────┤
                    │
Spelunk docs ───────┤
                    │
Beads data ─────────┘

Reports feed back to:
  ├── Human (review ecosystem health)
  ├── Architecture Agent (design improvements)
  └── Orchestrator (routing adjustments)
```

### Integration Points

| System | How Eval Agent Integrates |
|--------|--------------------------|
| Orchestrator | Spawns Eval Agent after feature completion for post-mortem |
| Hooks | `post-session` hook triggers `/eval` automatically |
| Beads | Reads task data for size/timing analysis |
| Spelunk | Reads staleness index and doc content for quality audit |
| Verify Cycles | New verify cycle: `eval-ecosystem-health.md` |

---

## Alternatives Considered

### Alternative A: Static Linting of Agent Definitions

Lint agent `.md` files for structural compliance (required sections, message patterns, boundary declarations). Rejected because it only catches syntactic issues, not behavioral gaps like boundary violations or message format drift at runtime.

### Alternative B: Extend Code Review Agent

Add eval responsibilities to the existing Code Review Agent. Rejected because Code Review already has a full responsibility set (engineering principles, verify cycles, security coordination) and adding meta-evaluation would violate SRP. The eval concern is architecturally distinct.

### Alternative C: Manual Periodic Audits

Human manually reviews agent behaviors periodically. Rejected because it's unsustainable as the ecosystem grows, prone to human error, and doesn't provide continuous monitoring.

---

## Task Breakdown

| Task | Blocks | Est. Lines | Description |
|------|--------|------------|-------------|
| 1. Define Eval Agent | - | 200 | Create `plugin/agents/eval.md` with full agent definition |
| 2. Create `/eval` skill | - | 300 | Create `plugin/skills/eval/SKILL.md` with all subcommands |
| 3. Fix boundary enforcement | - | 150 | Add pre-tool hook for documentation-layer agents |
| 4. Define message schemas | 1 | 200 | Structured message contracts per agent pair |
| 5. Consolidate task-complete/merge-up | - | 250 | Unify into single completion skill |
| 6. Add QA-Coding iteration protocol | 1, 4 | 150 | Bidirectional test handoff with max iterations |
| 7. Define security severity scale | - | 100 | CRITICAL/HIGH/MEDIUM/LOW with VETO thresholds |
| 8. Add spelunk confidence metadata | - | 100 | Confidence field in spelunk output headers |
| 9. Fix GitLab skill references | - | 50 | Remove or implement gitlab skill references |
| 10. Unify worktree lifecycle | 5 | 150 | Atomic worktree creation in task-complete |
| 11. Add eval post-session hook | 1, 2 | 100 | Hook that triggers `/eval` after session end |
| 12. Create eval report templates | 1, 2 | 100 | Templates for each eval scenario output |

---

## Success Criteria

- [ ] Eval Agent can detect boundary violations in documentation-layer agents
- [ ] Eval Agent can validate message format compliance
- [ ] Eval Agent can audit spelunk output quality via drift detection
- [ ] Eval Agent can identify documentation-vs-reality drift
- [ ] Eval Agent can report task size accuracy
- [ ] All 10 critical/high gaps have remediation implemented
- [ ] Eval reports generated to `docs/eval/` with actionable findings
- [ ] No agent definition references nonexistent skills or files

---

## Open Questions

- [ ] Should the Eval Agent have VETO power for ecosystem-level issues (e.g., block deployment if boundary compliance < 90%)?
- [ ] How do we collect session logs from teammate sessions for analysis? (Depends on Claude Code's agent teams logging capabilities)
- [ ] Should eval run on every session or only on a cadence (daily/weekly)?
- [ ] How do we handle eval findings that require human judgment (e.g., "is this spelunk doc sufficient?")?

---

## References

- `docs/plans/architect/documentation-layer-agents.md` - Layer separation design
- `docs/plans/architect/agent-ecosystem-enhancements.md` - Previous gap remediation
- `docs/plans/product/gap-analysis-readme-vs-reality.md` - Documentation drift analysis
- `docs/plans/architect/verify-cycle-skill.md` - Verification system design
- `docs/plans/architect/bdd-spec-workflow.md` - Testing workflow gaps
