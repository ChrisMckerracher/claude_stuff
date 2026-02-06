---
name: design-drift
description: Use when parallel Coding teammates have diverged from the design or each other and need to converge. Routes to Architect for arbitration.
---

# /design-drift

Detect and resolve design drift between parallel Coding teammates.

> **Teammates:** This skill coordinates across Coding teammates and the Architect. The team lead (Orchestrator or Architect-as-lead) routes drift to the Architect for a binding decision.

## Usage

`/design-drift` - Scan active tasks for potential drift signals
`/design-drift <task-id-1> <task-id-2>` - Compare two specific tasks for drift
`/design-drift resolve <resolution-id>` - View a previous drift resolution

## When to Use

- A Coding teammate reports a `DRIFT SIGNAL` or `DRIFT ESCALATION`
- You suspect parallel tasks are making incompatible assumptions
- Before merging sibling tasks to the same epic, to verify interface alignment
- After reviewing code that feels inconsistent with sibling implementations

## What Happens

### Scan Mode (no args)

1. Identify all in-progress tasks under the current epic
2. Check for unresolved drift signals in teammate messages
3. Compare task descriptions for overlapping interfaces or shared contracts
4. Report potential drift points to the lead

### Compare Mode (`<task-id-1> <task-id-2>`)

1. Read both tasks' design context from beads
2. Identify shared interfaces, overlapping conventions, or co-dependent contracts
3. If both tasks are in progress, message both Coding teammates requesting their current approach on shared decision points
4. Report alignment or divergence to the lead

### Resolve Mode (`resolve <resolution-id>`)

1. Read the resolution at `docs/plans/architect/drift-resolutions/<resolution-id>.md`
2. Display the decision, rationale, and per-task impact
3. Check adoption status — have affected tasks confirmed alignment?

## Drift Resolution Flow

```
Coding A detects ambiguity
    ↓
Coding A sends DRIFT SIGNAL to Coding B
    ↓
Coding B responds with DRIFT RESPONSE
    ↓
    ├── Converged? → Both adopt, message lead
    │
    └── Not converged? → DRIFT ESCALATION to lead
                              ↓
                         Lead routes to Architect
                              ↓
                         Architect writes resolution
                              ↓
                         Lead relays to Coding A & B
                              ↓
                         Both adopt, confirm to lead
```

## Authority

- **Coding teammates** detect drift and attempt peer convergence
- **Team lead** routes unresolved drift to the Architect (never resolves it themselves)
- **Architect** is the final authority — writes a binding drift resolution
- **Human** may be consulted by the Architect for high-impact decisions

## Output

- Drift resolutions written to `docs/plans/architect/drift-resolutions/<feature>-<seq>.md`
- Design doc may be amended with a "Clarifications" section to prevent recurrence

## Examples

### Coding teammate signals drift

```
/design-drift

Agent scans active tasks under epic claude_stuff-xyz:
- Task claude_stuff-xyz.1: Implements auth middleware (in_progress)
- Task claude_stuff-xyz.2: Implements user routes (in_progress)

Potential drift detected:
- Both tasks define a User type — xyz.1 uses {id, email}, xyz.2 uses {id, username, email}
- Recommend: Message both Coding teammates to align on User shape

Sending drift signal to both Coding teammates...
```

### Explicit comparison

```
/design-drift claude_stuff-xyz.1 claude_stuff-xyz.2

Comparing tasks:
- Shared interface: User type (defined in both tasks)
- xyz.1 returns {id: string, email: string}
- xyz.2 expects {id: string, username: string, email: string}
- DRIFT: Interface mismatch on User type

Escalating to Architect for arbitration...
```
