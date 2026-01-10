# Human Validation Checkpoints Design

## Goal

Codify the architect-human iterative workflow with explicit validation gates at major phase transitions.

## Problem Statement

The current agent ecosystem auto-spawns agents in sequence, but lacks explicit human approval gates. This can lead to:
1. Agents proceeding without human buy-in
2. Wasted work when direction was wrong
3. Loss of human control over the process

## Approach

Add **mandatory validation checkpoints** at major phase transitions. Agents pause and ask inline questions before proceeding. Keep it lightweight - no formal approval UI, just conversational gates.

## Checkpoint Locations

```
┌─────────────────────────────────────────────────────────────────┐
│                    HUMAN VALIDATION GATES                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐        │
│  │ CLARIFY  │────────▶│  DRAFT   │────────▶│DECOMPOSE │        │
│  │          │         │          │         │          │        │
│  │ Questions│  GATE 1 │ Present  │         │ Auto     │        │
│  │ to human │◄───────▶│ design   │────────▶│ on       │        │
│  └──────────┘         └──────────┘         │ approval │        │
│                                            └──────────┘        │
│                                                   │             │
│                                                   ▼             │
│  ┌──────────┐         ┌──────────┐         ┌──────────┐        │
│  │  COMMIT  │◄────────│IMPLEMENT │◄────────│ REVIEW   │        │
│  │          │         │          │         │ TASKS    │        │
│  │ Confirm  │  GATE 3 │ Parallel │  GATE 2 │ Show     │        │
│  │ before   │◄───────▶│ agents   │◄───────▶│ tree     │        │
│  └──────────┘         └──────────┘         └──────────┘        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Mandatory Gates

### Gate 1: Design Draft Review

**When:** After architect writes design doc to `docs/plans/architect/`

**Agent says:**
> Design draft complete at `docs/plans/architect/<feature>.md`
>
> **Summary:** [2-3 bullet points]
>
> Review and let me know:
> - Approve as-is → I'll proceed to decomposition
> - Request changes → Tell me what to revise
> - Need discussion → Let's talk through it

**Proceeds when:** Human responds (any response is engagement)

### Gate 2: Pre-Implementation Review

**When:** After decomposition creates task tree, before spawning coding agents

**Agent says:**
> Task tree created:
> ```
> [task tree visualization]
> ```
>
> **[N] leaf tasks ready** - can run in parallel
>
> Want me to spawn [N] Coding Agents in parallel?

**Proceeds when:** Human confirms implementation approach

### Gate 3: Pre-Commit

**When:** After implementation complete, before git commit

**Agent says:**
> [Summary of changes]
>
> Ready to commit?

**Proceeds when:** Human confirms

## Optional Checkpoints (Agent Discretion)

These are NOT mandatory but agents may use when helpful:

| Situation | Example |
|-----------|---------|
| Ambiguous requirements | "Should X do Y or Z?" |
| Multiple valid approaches | "Option A vs Option B - preference?" |
| Unexpected complexity | "This is bigger than expected. Split into phases?" |
| Risk detected | "This touches auth code. Proceed carefully?" |

## Implementation Changes

### Orchestrator

Add "Human Validation Protocol" section documenting the gates.

### Architecture Agent

1. After writing design doc, present summary and wait
2. After approval, ask "Ready to decompose?"
3. Do NOT auto-spawn decomposition without approval

### Coding Agent

1. After implementation, summarize changes
2. Ask "Ready to commit?" before committing
3. Do NOT auto-commit

### All Agents

Respect the flow:
- **Never skip a mandatory gate**
- **Never assume approval from silence**
- **Pause means pause** - wait for human response

## What This Does NOT Change

- Agents still auto-spawn each other within phases (architect→product, code→qa)
- Decomposition still creates parallel tasks
- Implementation still runs parallel coding agents
- The authority hierarchy remains the same

## Task Breakdown

1. **Update Orchestrator** (blocks: none)
   - Add "Human Validation Protocol" section
   - Document the 3 mandatory gates
   - Add Gate 2 (pre-implementation) behavior - show task tree, ask before spawning coders
   - Add optional checkpoint guidance

2. **Update Architecture Agent** (blocks: none)
   - Add Gate 1 (design review) behavior
   - Auto-proceed to decompose on approval (no separate gate)

3. **Update Coding Agent** (blocks: none)
   - Add Gate 3 (pre-commit) behavior
   - Ensure no auto-commit

---

**Status:** DRAFT - Awaiting human review
