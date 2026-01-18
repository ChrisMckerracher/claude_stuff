# Client Mode Tool Registration Analysis

**Generated:** 2026-01-17
**Lens:** contracts
**Focus:** client mode tool registration in `startClientMode()` function
**Source:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts`

---

## Summary

Client-mode tools in `startClientMode()` are registered **without Zod schemas for parameters**, unlike server-mode tools in `createClaudeBusServer()`. This causes the MCP SDK to expose an **empty JSON schema** (`{ type: 'object', properties: {} }`) to Claude for client-mode tools, which is problematic for tool usability.

---

## 1. How Tools Are Registered in `startClientMode()`

Location: `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts` lines 1074-1114

```typescript
export async function startClientMode(): Promise<void> {
  const server = new McpServer({
    name: 'claude-bus-client',
    version: '0.1.0',
  });

  // Define the same tools, but forward them via IPC
  const tools = [
    'submit_task',
    'worker_done',
    'get_status',
    'reset_worker',
    'retry_task',
    'task_failed',
    'register_worker',
    'poll_task',
    'ack_task',
  ];

  for (const toolName of tools) {
    // Each tool forwards to the real server
    (server.tool as Function)(
      toolName,
      `Forward ${toolName} to bus server`,
      async (args: Record<string, unknown>) => {
        try {
          const result = await forwardToolCall(toolName, args);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({
            error: `Failed to forward to server: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    );
  }
  // ...
}
```

**Key observation:** Tools are registered with only:
- `name` (string)
- `description` (string)
- `callback` (async function)

**Missing:** No Zod schema for parameters (third argument).

---

## 2. Server-Mode Registration Comparison

Location: `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts` lines 170-521

In `createClaudeBusServer()`, tools are registered **with Zod schemas**:

```typescript
// submit_task - has Zod schema
(server.tool as Function)(
  'submit_task',
  'Submit a bead task to be dispatched to an available worker',
  { bead_id: z.string().describe('The bead ID to submit for execution') },
  async ({ bead_id }: { bead_id: string }) => { /* ... */ }
);

// get_status - no parameters, no schema needed
(server.tool as Function)(
  'get_status',
  'Get the current status of all workers and the task queue',
  async () => { /* ... */ }
);

// register_worker - has Zod schema with validation
(server.tool as Function)(
  'register_worker',
  'Register a worker with the bus (for polling-based dispatch)',
  { name: z.string().min(1, 'Worker name is required').describe('The worker name (e.g., z.ai1)') },
  async ({ name }: { name: string }) => { /* ... */ }
);

// poll_task - has Zod schema with optional parameter
(server.tool as Function)(
  'poll_task',
  'Long-poll for a task assignment (blocks until task or timeout)',
  {
    name: z.string().min(1, 'Worker name is required').describe('The worker name'),
    timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
  },
  async ({ name, timeout_ms }: { name: string; timeout_ms?: number }) => { /* ... */ }
);
```

### Parameter Schema Comparison Table

| Tool | Server Mode Schema | Client Mode Schema |
|------|-------------------|-------------------|
| `submit_task` | `{ bead_id: z.string() }` | None |
| `worker_done` | `{ bead_id: z.string() }` | None |
| `get_status` | None (zero-arg) | None |
| `reset_worker` | `{ worker_name: z.string() }` | None |
| `retry_task` | `{ bead_id: z.string() }` | None |
| `task_failed` | `{ bead_id: z.string(), reason: z.string() }` | None |
| `register_worker` | `{ name: z.string().min(1) }` | None |
| `poll_task` | `{ name: z.string().min(1), timeout_ms: z.number().optional() }` | None |
| `ack_task` | `{ name: z.string().min(1), bead_id: z.string() }` | None |

---

## 3. What the MCP SDK Does When a Tool Has No inputSchema

Location: `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` lines 67-98

When listing tools, the SDK handles missing schemas:

```javascript
this.server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: Object.entries(this._registeredTools)
    .filter(([, tool]) => tool.enabled)
    .map(([name, tool]) => {
      const toolDefinition = {
        name,
        title: tool.title,
        description: tool.description,
        inputSchema: (() => {
          const obj = normalizeObjectSchema(tool.inputSchema);
          return obj
            ? toJsonSchemaCompat(obj, {
                strictUnions: true,
                pipeStrategy: 'input'
              })
            : EMPTY_OBJECT_JSON_SCHEMA;  // <-- FALLBACK
        })(),
        annotations: tool.annotations,
        execution: tool.execution,
        _meta: tool._meta
      };
      // ...
      return toolDefinition;
    })
}));
```

The fallback constant is defined at line 806-809:

```javascript
const EMPTY_OBJECT_JSON_SCHEMA = {
  type: 'object',
  properties: {}
};
```

### Impact on Claude

When Claude sees a tool with `inputSchema: { type: 'object', properties: {} }`:

1. **No parameter hints** - Claude doesn't know what parameters to pass
2. **No validation** - Any parameters passed are accepted
3. **No descriptions** - Claude can't see what each parameter does
4. **Inconsistent UX** - Same tool behaves differently depending on whether it connects to server vs client mode

---

## 4. Evidence of the Problem

The MCP SDK's `tool()` method supports multiple overload signatures (from `mcp.d.ts` lines 110-146):

```typescript
// Zero-argument tool
tool(name: string, cb: ToolCallback): RegisteredTool;

// Zero-argument tool with description
tool(name: string, description: string, cb: ToolCallback): RegisteredTool;

// Tool with params schema
tool<Args extends ZodRawShapeCompat>(
  name: string,
  paramsSchemaOrAnnotations: Args | ToolAnnotations,
  cb: ToolCallback<Args>
): RegisteredTool;

// Tool with description and params schema
tool<Args extends ZodRawShapeCompat>(
  name: string,
  description: string,
  paramsSchemaOrAnnotations: Args | ToolAnnotations,
  cb: ToolCallback<Args>
): RegisteredTool;
```

Client mode uses the `tool(name, description, cb)` overload (no schema), while server mode uses `tool(name, description, paramsSchema, cb)` overload (with schema).

---

## 5. Recommendations

### Option A: Add Schemas to Client Mode Tools

Define the same Zod schemas in client mode:

```typescript
const toolSchemas = {
  submit_task: { bead_id: z.string().describe('The bead ID to submit for execution') },
  worker_done: { bead_id: z.string().describe('The bead ID that was completed') },
  // ... etc
};

for (const toolName of tools) {
  const schema = toolSchemas[toolName];
  if (schema) {
    (server.tool as Function)(
      toolName,
      `Forward ${toolName} to bus server`,
      schema,
      async (args: Record<string, unknown>) => { /* ... */ }
    );
  } else {
    // Zero-arg tools like get_status
    (server.tool as Function)(
      toolName,
      `Forward ${toolName} to bus server`,
      async () => { /* ... */ }
    );
  }
}
```

### Option B: Extract Shared Schema Definitions

Create a shared module for tool schemas that both server and client mode import:

```typescript
// tool-schemas.ts
export const TOOL_SCHEMAS = {
  submit_task: { bead_id: z.string().describe('The bead ID to submit for execution') },
  worker_done: { bead_id: z.string().describe('The bead ID that was completed') },
  get_status: null, // zero-arg
  reset_worker: { worker_name: z.string().describe('The name of the worker to reset') },
  // ... etc
};
```

---

## Files Examined

| File | Lines | Purpose |
|------|-------|---------|
| `plugin/lib/claude-bus/server.ts` | 1-1115 | Server implementation with both modes |
| `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` | 1-913 | MCP SDK implementation |
| `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` | 1-363 | MCP SDK type definitions |

---

## Hash Validation

```
server.ts: sha256:${computed at generation time}
mcp.js: sha256:${MCP SDK vendored}
```
