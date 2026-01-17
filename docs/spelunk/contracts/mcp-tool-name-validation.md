# MCP Tool Schema: Name Parameter Validation

**Spelunk focus:** Zod schema definitions for `register_worker`, `poll_task`, `ack_task` - specifically how the `name` parameter is defined and whether it enforces non-empty strings

**Generated:** 2026-01-17
**Lens:** contracts (for Architect Agent)
**Source files:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts`

## Summary

**Finding: The `name` parameter uses `z.string()` WITHOUT any validation constraints.** Empty strings (`""`) are accepted by the Zod schema and will be processed by the tool handlers.

## Schema Definitions

### register_worker (lines 462-465)

```typescript
(server.tool as Function)(
  'register_worker',
  'Register a worker with the bus (for polling-based dispatch)',
  { name: z.string().describe('The worker name (e.g., z.ai1)') },
  async ({ name }: { name: string }) => {
```

**Validation:** `z.string()` only
- Accepts any string including empty `""`
- No `.min(1)` or `.nonempty()` constraint

### poll_task (lines 492-498)

```typescript
(server.tool as Function)(
  'poll_task',
  'Long-poll for a task assignment (blocks until task or timeout)',
  {
    name: z.string().describe('The worker name'),
    timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ name, timeout_ms }: { name: string; timeout_ms?: number }) => {
```

**Validation:** `z.string()` only
- Same issue - accepts empty strings

### ack_task (lines 564-570)

```typescript
(server.tool as Function)(
  'ack_task',
  'Acknowledge receipt of a task before execution',
  {
    name: z.string().describe('The worker name'),
    bead_id: z.string().describe('The bead ID being acknowledged'),
  },
  async ({ name, bead_id }: { name: string; bead_id: string }) => {
```

**Validation:** `z.string()` only
- Both `name` and `bead_id` accept empty strings

## Impact of Empty String Names

If a worker registers with an empty name `""`:

1. **register_worker("")** - Creates a worker with `name: ""`
   - `generateUniqueName("", workers)` would return `""` initially
   - Worker stored at key `""` in `state.workers` Map

2. **poll_task("")** - Would find the `""` worker and work
   - Blocked poller stored at key `""` in `state.blockedPollers`

3. **ack_task("", ...)** - Would find the `""` worker

4. **get_status** - Would show a worker with `name: ""`

This creates confusing state where an anonymous worker exists but has no meaningful identifier.

## Contrast with Other Parameters

The `bead_id` parameter also uses `z.string()` without validation:

```typescript
// submit_task (line 152)
{ bead_id: z.string().describe('The bead ID to submit for execution') }

// worker_done (line 223)
{ bead_id: z.string().describe('The bead ID that was completed') }
```

However, `bead_id` has downstream validation via `validateBead()`:

```typescript
const validation = validateBead(bead_id);
if (!validation.valid) {
  // Returns error response
}
```

The `name` parameter has NO such downstream validation - empty strings pass through silently.

## Test Coverage Gap

The test file (`server.test.ts`) does NOT test empty string names:

- Tests use names like `"z.ai1"`, `"worker-1"`, `"client-worker-1"`
- No test for `register_worker({ name: "" })`
- No test for edge cases around whitespace-only names

## Recommended Fix

To enforce non-empty worker names at the schema level:

```typescript
// Option 1: Using .min(1)
{ name: z.string().min(1).describe('The worker name (e.g., z.ai1)') }

// Option 2: Using .nonempty() (Zod v3.22+)
{ name: z.string().nonempty().describe('The worker name (e.g., z.ai1)') }

// Option 3: Using .trim() + .min(1) to reject whitespace-only
{ name: z.string().trim().min(1).describe('The worker name (e.g., z.ai1)') }
```

This would cause MCP to reject invalid names at the schema validation layer before the handler is invoked.

## Unique Name Generation Edge Case

The `generateUniqueName()` function (lines 53-63) handles duplicate names by appending numeric suffixes:

```typescript
function generateUniqueName(baseName: string, workers: Map<string, Worker>): string {
  if (!workers.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  while (workers.has(`${baseName}-${suffix}`)) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
}
```

With empty base name:
- First call: `generateUniqueName("", workers)` returns `""`
- Second call: `generateUniqueName("", workers)` returns `"-1"` (hyphen prefix, no base)
- Third call: `generateUniqueName("", workers)` returns `"-2"`

This creates confusingly named workers: `""`, `"-1"`, `"-2"`.

## Contracts Summary Table

| Tool | Parameter | Zod Schema | Accepts Empty? | Downstream Check? |
|------|-----------|------------|----------------|-------------------|
| `register_worker` | `name` | `z.string()` | YES | NO |
| `poll_task` | `name` | `z.string()` | YES | NO (fails silently - "Unknown worker") |
| `ack_task` | `name` | `z.string()` | YES | NO (fails silently - "Unknown worker") |
| `submit_task` | `bead_id` | `z.string()` | YES | YES (`validateBead()`) |

---

*Generated by Coding Agent (spelunk --for=architect)*
