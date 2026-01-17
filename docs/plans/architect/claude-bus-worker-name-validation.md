# Claude Bus: Worker Name Validation

## Overview

Add schema-level validation to prevent empty or invalid worker names from being accepted by MCP tools.

## Problem

The `register_worker`, `poll_task`, and `ack_task` tools all accept a `name` parameter defined as:

```typescript
{ name: z.string().describe('The worker name (e.g., z.ai1)') }
```

This accepts empty strings `""` at the schema level. A worker can register with no name, creating confusing state.

## Design Principle

**Make invalid states unrepresentable at the protocol boundary.**

If an empty name is invalid, the MCP framework should reject it before our handler runs. The caller gets an immediate schema validation error, not a silent failure or confusing state.

## Solution

### Layer 1: Schema Validation (Protocol Boundary)

Change all `name` parameters from:
```typescript
z.string()
```

To:
```typescript
z.string().min(1, 'Worker name is required')
```

This causes MCP to reject empty names with a clear validation error before the handler is invoked.

### Layer 2: Semantic Validation (Handler)

Add regex validation in the handler for valid characters:

```typescript
const WORKER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

if (!WORKER_NAME_PATTERN.test(name)) {
  return { success: false, error: 'Invalid worker name: must be 1-64 alphanumeric characters (._- allowed)' };
}
```

Rules:
- Must start with alphanumeric
- Can contain letters, numbers, `.`, `_`, `-`
- Length: 1-64 characters

### Layer 3: Consistent Validation

Apply the same pattern to `bead_id` parameters for consistency (already has `validateBead()` downstream, but schema should also enforce non-empty).

## Files to Change

| File | Change |
|------|--------|
| `plugin/lib/claude-bus/server.ts` | Add `.min(1)` to `name` schemas, add pattern validation |

## Scope

~15 lines changed. Single file.

## Test Cases

Add tests for:
1. `register_worker({ name: "" })` - should fail with schema error
2. `register_worker({ name: "   " })` - should fail (whitespace only)
3. `register_worker({ name: "valid-name" })` - should succeed
4. `poll_task({ name: "" })` - should fail with schema error
5. `ack_task({ name: "", bead_id: "x" })` - should fail with schema error

## Acceptance Criteria

- [ ] Empty string names rejected at schema level (MCP validation error)
- [ ] Whitespace-only names rejected
- [ ] Invalid characters rejected with clear error message
- [ ] Existing valid names continue to work
- [ ] Tests cover edge cases

---

*Design Status: DRAFT - Ready for review*
