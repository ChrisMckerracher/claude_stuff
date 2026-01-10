---
name: qa
description: Use when creating tests from specs, or analyzing test coverage in a codebase
---

# /qa

Invoke the QA Agent.

## Usage

`/qa` - Generate tests for current design/task
`/qa examine` - Analyze test coverage and patterns
`/qa <spec>` - Generate tests from specific spec

## What Happens

1. QA Agent activates
2. Reads spec/design to understand requirements
3. Generates comprehensive test scenarios
4. Writes tests following project patterns

## Pre-Spelunk Documentation Check

Before requesting codebase exploration, ALWAYS check for existing docs:

### What QA Needs
- **contracts/** - Interface definitions, input/output schemas, validation rules

### Check Staleness First
```
/code spelunk --check --for=qa --focus="<area>"
```

Results:
- **FRESH**: Read `docs/spelunk/contracts/<focus-slug>.md` directly
- **STALE/MISSING**: Request spelunk via Coding Agent

### Request Spelunk Only If Needed
```
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: "spelunk --for=qa --focus='<area>'"
)
```

Then read: `docs/spelunk/contracts/<focus-slug>.md`

### Using Contract Docs for Testing
1. Extract interface definitions and type signatures
2. Generate test cases for each input/output combination
3. Include edge cases from type constraints
4. Cover validation rules and error cases
