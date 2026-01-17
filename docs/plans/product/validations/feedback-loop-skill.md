# Product Validation: Verify Cycle Skill

**Date:** 2026-01-15
**Feature:** `/verify` skill definition workflow
**Status:** **REVISED AND APPROVED**

---

## Executive Summary

The proposal to add a verification cycle skill is **APPROVED**. The feature aligns with the ecosystem's goal of structured workflows and quality enforcement. Key revisions made:

1. **Simplified integration:** Leverages existing `coder → review` pattern; no new workflow steps
2. **Clearer naming:** `/verify` instead of `/feedback-loop`
3. **Clean storage:** `.claude/verify-cycles/` separate from CLAUDE.md
4. **Single agent change:** Only Review Agent is enhanced to run cycles

---

## What's Proposed

A skill that enables:
1. Architect + coder help human define a verification cycle
2. Create scripts/tests if required for that cycle
3. Store cycle definition in `.claude/verify-cycles/<name>.md`
4. Review agent automatically runs applicable cycles during standard review

The cycles range from informal ("spin up browser and check") to rigorous ("draft e2e tests") and can reference existing cycles (make commands, test scripts).

**Key design decision:** Execution piggybacks on the existing `coder → review` workflow. No new triggers or hooks needed.

---

## Product Fit Analysis

### Strengths

| Aspect | Alignment |
|--------|-----------|
| **Quality gates** | Extends existing gate pattern (pre-commit, pre-push) |
| **Documentation-driven** | Feedback captured in CLAUDE.md, consistent with ecosystem patterns |
| **Flexible rigor** | Supports both manual ("check in browser") and automated (test scripts) loops |
| **Agent coordination** | Leverages existing architect/coder/review roles |
| **Incremental** | Can be added without breaking existing workflows |

### Gaps & Concerns

| Concern | Impact | Mitigation |
|---------|--------|------------|
| **Naming ambiguity** | "Feedback loop" could mean many things | Suggest `quality-gate`, `validation-cycle`, or `verify` |
| **Integration unclear** | When does this run in the workflow? | SOLVED: Review agent runs cycles as part of its standard review pass |
| **Scope creep** | Could duplicate existing test/review flows | Clarify what makes this different from `/qa` and `/review` |
| **CLAUDE.md clutter** | Too many ad-hoc feedback loops could bloat file | Suggest separate feedback registry file |

---

## Recommended Revisions

### 1. Clarify Differentiation

This skill needs clear boundaries from existing agents:

| Existing | New Skill's Focus |
|----------|-------------------|
| `/review` | Static code quality, style guide compliance |
| `/qa` | Test generation and coverage analysis |
| `/security` | OWASP, secrets, CVEs |
| **`/verify`** (proposed) | Project-specific quality cycles defined by human |

**The key difference:** `/verify` captures **project-specific validation** that the human defines — "run this smoke test," "check the admin panel manually," "verify the webpack bundle size under 200kb" — not generic code quality.

### 2. Proposed Workflow (Simplified Integration)

**Key insight:** Leverage the existing `coder → review` pattern. No new workflow steps needed.

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEFINE PHASE (one-time)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  /verify define <name>                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Architect + Coder help human articulate:                  │  │
│  │ - What to verify? (e.g., "homepage loads under 2s")     │  │
│  │ - How to verify? (script or manual)                      │  │
│  │ - What files trigger this? (glob pattern)                │  │
│  │ - Pass/fail criteria                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                           │                                     │
│                           ▼                                     │
│  /verify capture <name>                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ If scripts needed → Coder creates them                   │  │
│  │ Write to: .claude/verify-cycles/<name>.md                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION (existing pattern)                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  /code <task>                                                   │
│     │                                                            │
│     ├── Coder implements task                                   │
│     │                                                            │
│     └── Coder calls /review  ← EXISTING PATTERN                 │
│            │                                                     │
│            ▼                                                     │
│     Review Agent (enhanced):                                    │
│     1. Check style compliance  (existing)                       │
│     2. Check pattern consistency (existing)                     │
│     3. Run applicable verify cycles (NEW)                       │
│     4. Return approval or blocking rejection                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**No changes to:**
- Coder agent (already calls review)
- Orchestrator (no new routing)
- Any other agents

**Only changes to:**
- Review agent's internal review process (adds cycle execution)
- New `/verify` commands for definition phase

### 3. Naming Recommendation

**`/verify`** is clearer than `/feedback-loop`:
- More verb-oriented, fits command pattern
- Distinct from generic "feedback" terminology
- Conveys "checking something against requirements"

Alternative: `/quality-gate` (more formal, longer)

### 4. Storage Recommendation

Don't put project-specific verification cycles in CLAUDE.md. Instead:

```
.claude/
└── verify-cycles/
    ├── homepage-performance.md
    ├── admin-panel-manual-check.md
    └── api-response-time.md
```

**Why:**
- CLAUDE.md = coding conventions, patterns, style
- Verify cycles = project-specific validation rules
- Keep concerns separated; cycles can be gitignored if sensitive

### 5. Agent Integration Points

| Agent | Changes Required |
|-------|------------------|
| **Architect** | None — helps during `/verify define` |
| **Coder** | None — already calls review after implementation |
| **Review** | **Enhanced:** Check `.claude/verify-cycles/` for applicable cycles, run them as part of standard review |
| **Human** | Define cycles during `/verify define`, interpret failures |

---

## Proposed Output Format

```markdown
---
name: homepage-performance
files: ["src/**/*.{ts,tsx}", "public/index.html"]  # When changes match these
rigor: automated
---

# Homepage Performance Check

**What:** Verify homepage loads in < 2s on fast-3g

**How:** Run `npm run lighthouse -- chrome --throttling.fast3g`

**Pass criteria:** Lighthouse performance score > 80

**On failure:** Block merge with score details
```

**How Review Agent Discovers Cycles:**

1. Get list of changed files in the diff
2. Check each `.claude/verify-cycles/*.md` for `files:` glob patterns
3. Run cycles where changed files match the pattern
4. Aggregate results, block on any failure

---

## Examples by Rigor Level

| Level | Example | Automation |
|-------|---------|------------|
| **Manual - One-off** | "Spin up browser, check login flow works" | Human runs, coder reminds |
| **Manual - Checklist** | "Verify all admin CRUD operations" | Coder generates checklist |
| **Semi-automated** | "Run `make smoke-test`, manual check report" | Script + human review |
| **Fully automated** | "Run `npm test`, fail on any failure" | Script blocks on failure |
| **Reference existing** | "Run `./scripts/pre-commit-check.sh`" | Delegates to existing |

---

## Action Plan

1. **Write `/verify` SKILL.md** — Define `/verify define` and `/verify capture` commands
2. **Enhance Review Agent** — Add cycle discovery and execution to standard review process
3. **Create storage format** — Define `.claude/verify-cycles/<name>.md` schema
4. **Update plugin.json** — Register new verify commands

---

## Recommendation

**REVISED AND APPROVED.**

The feature adds valuable project-specific quality enforcement with minimal workflow disruption:
- Single new command surface (`/verify define` + `/verify capture`)
- Single agent enhancement (Review Agent)
- Zero changes to existing coder → review flow
- Clean separation: project-specific cycles in `.claude/verify-cycles/`, not CLAUDE.md

**Next step:** Run `/architect` with this validation document to create the detailed design.
