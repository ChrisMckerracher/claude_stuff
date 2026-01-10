---
name: architect
description: Use when starting new features, making design decisions, or analyzing codebase architecture
---

# /architect

Invoke the Architecture Agent for design work.

## Usage

`/architect` - Start design session for new feature
`/architect examine` - Analyze current codebase architecture
`/architect decompose` - Break current design into task tree

## What Happens

1. Architecture Agent activates in appropriate mode
2. **Checks for product brief** at `docs/plans/product/briefs/<feature-name>.md`
   - If brief exists: designs against product requirements
   - If no brief + user-facing feature: suggests running `/product` first
   - If no brief + technical work: proceeds with note in design doc
3. For new features: iterative co-design with you
4. For examine: produces architecture analysis
5. For decompose: creates merge tree of tasks

## Capabilities

- **Product brief awareness:** Checks for and designs against product briefs
- **Web search:** Technical research for API docs, library comparisons, implementation patterns
- **Design docs:** Outputs to `docs/plans/architect/<feature-name>.md`

## Pre-Spelunk Documentation Check

Before requesting a spelunk from the Coding Agent, ALWAYS check for existing documentation:

### Step 1: Determine What You Need
Architect typically needs:
- **contracts/** - Interface and type definitions
- **boundaries/** - Module boundaries and dependencies

### Step 2: Check for Existing Docs
Convert your focus area to a slug and check if docs exist:
```
focus: "authentication layer"
slug: authentication-layer
paths to check:
  - docs/spelunk/contracts/authentication-layer.md
  - docs/spelunk/boundaries/authentication-layer.md
```

### Step 3: Check Staleness
Use the spelunk --check flag:
```
/code spelunk --check --for=architect --focus="authentication layer"
```

Possible results:
- **FRESH**: Read the doc directly, no spelunk needed
- **STALE**: Request re-spelunk with --refresh flag
- **MISSING**: Request new spelunk

### Step 4: Request Spelunk Only If Needed
```
# Only if STALE or MISSING:
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: "/code spelunk --for=architect --focus='authentication layer'"
)
```

### Step 5: Read Results
After spelunk completes (or if already fresh):
```
Read docs/spelunk/contracts/authentication-layer.md
Read docs/spelunk/boundaries/authentication-layer.md
```

### Why This Matters
- **Saves tokens**: Avoid redundant exploration
- **Faster**: Fresh docs are instantly available
- **Consistent**: Same docs available across sessions
- **Shareable**: Other agents can use your spelunked docs

## Authority

Architecture Agent has highest authority below human. Other agents wait for design approval before engaging.
