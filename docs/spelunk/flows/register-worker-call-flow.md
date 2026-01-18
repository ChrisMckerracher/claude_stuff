# register_worker Call Flow Analysis

Generated: 2026-01-17
Lens: flows
Focus: register_worker call flow from Claude Code to MCP server

## Summary

This document traces the end-to-end flow when Claude Code calls `register_worker`, investigating how parameters are constructed, passed through IPC forwarding, and whether missing schema properties could cause Claude to omit the `name` parameter.

## Key Finding: Client Mode Missing Input Schema

**Critical Issue Identified:** In client mode, tools are registered WITHOUT input schemas, causing Claude Code to receive an empty `inputSchema` which may lead it to omit parameters.

## Call Flow Diagram

```
Claude Code (LLM)
    |
    | 1. Sees tool definition from MCP tools/list response
    |    (inputSchema determines what parameters Claude provides)
    v
MCP Client (Claude Code internal)
    |
    | 2. Constructs CallToolRequest with arguments
    |    (arguments come from Claude's understanding of inputSchema)
    v
STDIO Transport (stdin/stdout JSON-RPC)
    |
    | 3. JSON-RPC message with tool name and arguments
    v
MCP Server (claude-bus)
    |
    | 4a. Server Mode: Direct tool execution
    | 4b. Client Mode: Forward via IPC to real server
    v
Tool Handler
    |
    | 5. Validates and processes arguments
    v
Response
```

## Flow Details

### Step 1: Tool Discovery (tools/list)

When Claude Code connects to an MCP server, it calls `tools/list` to discover available tools.

**Server Mode Response** (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts:484-521`):
```typescript
// register_worker with full schema
(server.tool as Function)(
  'register_worker',
  'Register a worker with the bus (for polling-based dispatch)',
  { name: z.string().min(1, 'Worker name is required').describe('The worker name (e.g., z.ai1)') },
  async ({ name }: { name: string }) => { ... }
);
```

This produces an inputSchema like:
```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 1,
      "description": "The worker name (e.g., z.ai1)"
    }
  },
  "required": ["name"]
}
```

**Client Mode Response** (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts:1093-1108`):
```typescript
for (const toolName of tools) {
  (server.tool as Function)(
    toolName,
    `Forward ${toolName} to bus server`,
    async (args: Record<string, unknown>) => {
      // No input schema provided!
      const result = await forwardToolCall(toolName, args);
      return jsonResponse(result);
    }
  );
}
```

**PROBLEM:** No inputSchema is provided to `server.tool()`. The MCP SDK's behavior when no schema is provided (from MCP SDK `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:75-82`):

```javascript
inputSchema: (() => {
  const obj = normalizeObjectSchema(tool.inputSchema);
  return obj
    ? toJsonSchemaCompat(obj, { strictUnions: true, pipeStrategy: 'input' })
    : EMPTY_OBJECT_JSON_SCHEMA;  // <-- Falls back to empty schema!
})(),
```

Where `EMPTY_OBJECT_JSON_SCHEMA` is:
```javascript
const EMPTY_OBJECT_JSON_SCHEMA = {
  type: 'object',
  properties: {}  // No properties defined!
};
```

### Step 2: Claude's Parameter Construction

When Claude Code sees a tool with `inputSchema: { type: "object", properties: {} }`:

1. **No properties defined** = Claude has no guidance on what parameters to provide
2. Claude may:
   - Omit all parameters (empty `arguments: {}`)
   - Try to infer parameters from the description
   - Make up parameter names based on context

**Evidence:** The tool description only says "Forward register_worker to bus server" - no parameter information.

### Step 3: IPC Forwarding

In client mode, `forwardToolCall` (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/ipc.ts:408-424`):

```typescript
export async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,  // Whatever Claude provided
  projectRoot?: string
): Promise<unknown> {
  const response = await sendIpcMessage(
    { type: 'forward_tool', tool_name: toolName, tool_args: args },
    projectRoot,
    60000
  );
  // ...
}
```

The IPC layer correctly passes through whatever `args` it receives. **The IPC forwarding is NOT the problem** - it faithfully transmits the arguments.

### Step 4: Server-Side Handling

The IPC handler (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts:933-944`):

```typescript
case 'forward_tool': {
  if (!request.tool_name) {
    return { success: false, error: 'tool_name required' };
  }
  return callTool(request.tool_name, request.tool_args || {})
    .then((data) => ({ success: true, data }))
    .catch((e) => ({
      success: false,
      error: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
    }));
}
```

Then `callTool` for register_worker (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts:748-771`):

```typescript
case 'register_worker': {
  const name = args.name as string;  // Extracts name from args
  const nameError = validateWorkerName(name);
  if (nameError) {
    return { success: false, error: nameError };
  }
  // ...
}
```

**If `args.name` is undefined** (because Claude omitted it), then:
- `validateWorkerName(undefined)` is called
- This returns `'Worker name is required'` (from `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts:58-61`)

## Root Cause Analysis

The issue is a **schema propagation failure** in client mode:

| Mode | inputSchema | Claude's Knowledge | Result |
|------|-------------|-------------------|--------|
| Server Mode | Full Zod schema with name property | Knows `name` is required string | Provides `{ name: "..." }` |
| Client Mode | Empty `{ type: "object", properties: {} }` | No parameter info | May omit parameters |

## Transport Protocol

**Transport Type:** STDIO (stdin/stdout)

Both server mode and client mode use `StdioServerTransport`:
```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

Claude Code spawns the MCP server process and communicates via:
- stdin: JSON-RPC requests from Claude Code to server
- stdout: JSON-RPC responses from server to Claude Code

The IPC (Unix socket) is only used for:
- Client-to-server forwarding when multiple Claude instances exist
- CLI commands signaling the running server

## Recommendations

### Option 1: Duplicate Schemas in Client Mode

Add the same Zod schemas to client mode tool registrations:

```typescript
(server.tool as Function)(
  'register_worker',
  `Forward register_worker to bus server`,
  { name: z.string().min(1).describe('The worker name') },
  async (args: Record<string, unknown>) => {
    const result = await forwardToolCall('register_worker', args);
    return jsonResponse(result);
  }
);
```

### Option 2: Shared Schema Definitions

Create a shared schema file:

```typescript
// schemas.ts
export const registerWorkerSchema = {
  name: z.string().min(1).describe('The worker name (e.g., z.ai1)')
};

// Use in both server.ts and client mode
```

### Option 3: Dynamic Schema Propagation

Have the client mode query the real server for its schemas and mirror them.

## Files Involved

| File | Role |
|------|------|
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/server.ts` | MCP server with tool definitions |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/ipc.ts` | IPC forwarding layer |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/claude-bus/types.ts` | Type definitions |
| MCP SDK `mcp.js` | inputSchema fallback to empty object |

## Verification Test

To verify this hypothesis:

1. Connect Claude Code to a client-mode server
2. Call `tools/list` and inspect the `register_worker` tool
3. Confirm `inputSchema.properties` is empty
4. Observe Claude's behavior when calling the tool

## Conclusion

**Yes, the missing schema in client mode could cause Claude to omit the `name` parameter entirely.**

The MCP SDK falls back to an empty properties object when no inputSchema is provided, giving Claude Code no information about required parameters. This is a schema propagation bug in the client mode implementation, not an IPC forwarding issue.
