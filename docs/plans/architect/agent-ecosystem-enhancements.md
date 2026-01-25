# Agent Ecosystem Enhancements Design

**Status:** Draft - Awaiting Human Review
**Date:** 2026-01-25
**Author:** Architecture Agent

---

## Problem Statement

The agent ecosystem has several inconsistencies and missing capabilities:

1. **Architecture Agent isolation:** The architect should not concern itself with claude-bus infrastructure - that's an orchestration/coding concern.

2. **Task-to-design linkage:** When agents pick up tasks from `/decompose`, they have no reference to the architecture design document that spawned them.

3. **Worktree consistency:** The worktree model is documented but agents lack clear, consistent instructions about the merge topology.

4. **Non-coding agent quality gap:** Product and Security agents lack the structured documentation layer patterns that make the Architecture agent effective.

---

## Solution Overview

### Enhancement 1: Remove claude-bus from All Agent Documentation

Remove all claude-bus references from agent skills and documentation. The bus is infrastructure that agents shouldn't be aware of - if bus coordination is needed, it happens at a layer below the agent prompts.

**Files affected:**
- `plugin/skills/code/SKILL.md` - Remove "Bus Worker Mode" section (lines 110-148)
- `plugin/skills/task-complete/SKILL.md` - Remove bus notification step and "Bus Integration" section
- `plugin/scripts/task-complete.sh` - Remove `notify_bus_worker_done()` function and its call

### Enhancement 2: Link Architecture Docs in Tasks

When `/decompose` creates tasks, each task description should include a reference to the architecture document:

```markdown
## Task Description

**Architecture doc:** `docs/plans/architect/feature-name.md`

[Task-specific details...]
```

This enables any agent picking up a task to:
1. Read the design for full context
2. Understand the broader feature scope
3. Reference architectural decisions

**Files affected:**
- `plugin/skills/decompose/SKILL.md` - Add doc linking instruction
- `plugin/scripts/decompose-task.sh` - Pass arch doc path to task description

### Enhancement 3: Explicit Worktree Merge Topology

Clarify the worktree model in all relevant agent prompts:

```
Git Worktree Structure:
  {checked-out branch}          # Current main/develop/feature branch
    └── epic/{epic-id}/         # Epic branch (worktree: .worktrees/{epic-id}/)
        ├── task/{task-id-1}    # Task branch (worktree: .worktrees/{task-id-1}/)
        └── task/{task-id-2}    # Task branch (worktree: .worktrees/{task-id-2}/)

Merge flow:
  task/{id} → epic/{epic-id} → {checked-out branch}

Task completion:
  1. Work in .worktrees/{task-id}/
  2. Merge task branch into epic branch
  3. Epic branch merges into checked-out branch when all tasks complete
```

**Files affected:**
- `plugin/agents/architecture.md` - Add worktree awareness to decompose mode
- `plugin/agents/orchestrator.md` - Add worktree context for task delegation

### Enhancement 4: Upgrade Product Agent

Align Product Agent with Architecture Agent quality:

1. **Add structured file locations**
2. **Add explicit delegation to spelunker**
3. **Add templates for outputs**
4. **Add clear process steps**

Current Product Agent is 201 lines and already has good structure. Enhancements:

- Add "Implementation Boundary" section (like architect)
- Strengthen spelunk delegation enforcement
- Add clarity on when to use each mode

**Files affected:**
- `plugin/agents/product.md`

### Enhancement 5: Upgrade Security Agent

Security Agent is sparse (42 lines). Upgrade to match Architecture Agent patterns:

1. **Add Documentation Layer Constraint** (for audit reports)
2. **Add Spelunk Delegation** (security can spelunk for trust boundaries)
3. **Add structured output locations** (`docs/plans/security/audits/`)
4. **Add templates** (audit report, VETO report)
5. **Keep VETO power** - core identity

**Files affected:**
- `plugin/agents/security.md`

---

## Detailed Design

### Decompose: Architecture Doc Linking

Update `/decompose` skill to:

1. **Track architecture doc path** during decomposition
2. **Include path in task description** for all created tasks

Updated `decompose-task.sh` call signature:
```bash
decompose-task.sh "$epic_id" "Task Name" "Description" "$arch_doc_path" [blockers...]
```

Task description template:
```markdown
## {Task Name}

**Architecture doc:** `{arch_doc_path}`

{Description}

### Context
This task is part of the "{Epic Name}" feature. See the architecture document for:
- Design rationale
- Component relationships
- File ownership boundaries
```

### Worktree Instructions for Orchestrator

Add to `plugin/agents/orchestrator.md`:

```markdown
## Worktree-Aware Delegation

When delegating tasks via `/code`:

1. **Task worktrees:** Each task from `/decompose` has a dedicated worktree at `.worktrees/{task-id}/`

2. **Merge topology:**
   - Tasks merge into their epic branch
   - Epic branches merge into the checked-out branch (the "active branch")
   - The active branch is recorded as a label on the epic bead

3. **Delegation includes context:**
   When spawning Coding Agent, include:
   - Task ID
   - Architecture doc reference (from task description)
   - Expected worktree path
```

### Product Agent Upgrade

Add these sections to `plugin/agents/product.md`:

```markdown
## Implementation Boundary (REQUIRED)

**Product Agent does NOT edit code or configuration files directly.**

If implementation is needed:
1. Draft product brief to `docs/plans/product/briefs/<feature>.md`
2. Validate architect design via structured validation report
3. Delegate actual implementation to Coding Agent

**If you find yourself using Edit/Write on non-docs files: STOP.**
You are defining WHAT and WHY, not HOW. Spawn the appropriate agent.
```

### Security Agent Upgrade

Restructure `plugin/agents/security.md`:

```markdown
# Security Agent

<CRITICAL-BOUNDARY>
## Dual-Layer Access

You operate at BOTH documentation and code layers:

**Documentation layer:**
- Write reports to `docs/plans/security/audits/`
- Read architecture docs for context

**Code layer (for audits):**
- Full access to source code
- Can spelunk for trust boundaries
- Can analyze changed files directly

This is the ONLY agent with true dual-layer access.
</CRITICAL-BOUNDARY>

## Spelunk for Trust Boundaries

When auditing, you MAY either:
1. Read code directly (you have access)
2. OR delegate to spelunker for reusable trust-zone docs:
   ```
   Task(subagent_type: "agent-ecosystem:coding",
        prompt: "/code spelunk --lens=trust-zones --focus='<area>'")
   ```

Use spelunk when the trust boundary analysis would benefit other agents later.

## Modes

### Examine Mode
Full security audit of codebase.

**Process:**
1. Check for existing trust-zone spelunk docs
2. Either read code directly OR delegate to spelunker
3. Run security analysis:
   - OWASP Top 10 vulnerabilities
   - Dependency CVE scan
   - Secrets detection
   - Auth/authz flow analysis
   - Input validation gaps
4. Write audit report to `docs/plans/security/audits/<scope>.md`

**Output:** Security audit report at structured path

### Execute Mode
Audit changes for security issues. Has **VETO power**.

**Process:**
1. Get changed files from diff
2. For each file, check for introduced vulnerabilities
3. Check dependencies for known CVEs
4. Verify no secrets committed
5. Decision: APPROVE or **VETO**

**Output:**
- APPROVE: Proceed (may include advisory notes)
- VETO: Block with `docs/plans/security/vetos/<date>-<feature>.md`

## VETO Rules

Security Agent can block ANY change that:
- Introduces OWASP Top 10 vulnerability
- Adds dependency with known critical CVE
- Contains secrets/credentials
- Weakens authentication/authorization
- Has command injection risk

## VETO Report Template

```markdown
# Security VETO: {Feature/Change Name}

**Date:** YYYY-MM-DD
**Status:** VETO
**Reviewed:** {files or scope}

## Blocking Issues

| Issue | Severity | Location | Fix Required |
|-------|----------|----------|--------------|
| {vuln} | CRITICAL | {file:line} | {description} |

## Required Remediation

1. {Step to fix}
2. {Step to fix}

## Re-Review Instructions

After fixing, re-run `/security` for approval.
```

## Audit Report Template

```markdown
# Security Audit: {Scope}

**Date:** YYYY-MM-DD
**Status:** PASS | ADVISORY | FAIL

## Summary

{2-3 sentences}

## Findings

### Critical (0)

### High (0)

### Medium (0)

### Low (0)

### Informational (0)

## Recommendations

{Prioritized list}
```

## File Locations

| Type | Path | Purpose |
|------|------|---------|
| Audit Reports | `docs/plans/security/audits/<scope>.md` | Full security audits |
| VETO Reports | `docs/plans/security/vetos/<date>-<name>.md` | Change block records |
| Trust Zone Spelunk | `docs/spelunk/trust-zones/<area>.md` | Reusable trust boundary docs |

## Authority

**VETO power.** Outranks all agents on security matters. Runs via pre-push hook.
```

---

## Task Breakdown

1. **Remove claude-bus from code skill** (blocks: none)
   - Remove "Bus Worker Mode" section entirely
   - Files: `plugin/skills/code/SKILL.md`

2. **Remove claude-bus from task-complete** (blocks: none)
   - SKILL.md: Remove bus notification step, "Bus Integration" section, claude-bus from dependencies
   - Script: Remove `notify_bus_worker_done()` function (lines 413-436) and call (line 485)
   - Files: `plugin/skills/task-complete/SKILL.md`, `plugin/scripts/task-complete.sh`

3. **Update decompose skill** (blocks: none)
   - Add arch doc parameter to task description template
   - Files: `plugin/skills/decompose/SKILL.md`

4. **Update decompose-task.sh** (blocks: 3)
   - Accept optional arch doc path parameter
   - Include in bead description
   - Files: `plugin/scripts/decompose-task.sh`

5. **Update orchestrator agent** (blocks: none)
   - Add worktree-aware delegation section
   - Files: `plugin/agents/orchestrator.md`

6. **Upgrade product agent** (blocks: none)
   - Add implementation boundary
   - Strengthen spelunk delegation
   - Files: `plugin/agents/product.md`

7. **Upgrade security agent** (blocks: none)
   - Full restructure per design
   - Files: `plugin/agents/security.md`

8. **Update architect agent** (blocks: none)
   - Add worktree awareness to decompose section
   - Files: `plugin/agents/architecture.md`

---

## Files Modified

| File | Change |
|------|--------|
| `plugin/skills/code/SKILL.md` | Remove "Bus Worker Mode" section |
| `plugin/skills/task-complete/SKILL.md` | Remove bus integration |
| `plugin/scripts/task-complete.sh` | Remove `notify_bus_worker_done()` function and call |
| `plugin/skills/decompose/SKILL.md` | Add arch doc linking instruction |
| `plugin/scripts/decompose-task.sh` | Accept and use arch doc path |
| `plugin/agents/orchestrator.md` | Add worktree delegation context |
| `plugin/agents/product.md` | Add implementation boundary section |
| `plugin/agents/security.md` | Full upgrade per template |
| `plugin/agents/architecture.md` | Add worktree context to decompose |

---

## Success Criteria

1. No agent or skill references claude-bus (clean removal)
2. Tasks created by `/decompose` include architecture doc reference
3. Agents picking up tasks can find the design context
4. Product and Security agents follow same structured patterns as Architecture
5. Worktree topology is documented consistently across orchestration touchpoints

---

## References

- `docs/plans/architect/epic-worktree-integration.md` - Worktree design
- `docs/plans/architect/worktree-per-task.md` - Task worktree design
- `docs/plans/architect/documentation-layer-agents.md` - Layer separation

