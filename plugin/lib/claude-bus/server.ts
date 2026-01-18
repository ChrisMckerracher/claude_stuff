/**
 * Claude Bus MCP Server (Client Mode)
 *
 * Thin MCP server that forwards all tool calls to the external daemon.
 * This module provides the Claude Code interface while the daemon handles state.
 *
 * @module claude-bus/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { forwardToolCall } from './client.js';

/**
 * Helper to create a JSON text response for MCP tools.
 */
export function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/**
 * Shared tool schema definitions for MCP tools.
 * Defines the parameter schemas that Claude sees for each tool.
 */
export const TOOL_SCHEMAS = {
  submit_task: {
    description: 'Submit a bead task to be dispatched to an available worker',
    schema: { bead_id: z.string().describe('The bead ID to submit for execution') },
  },
  worker_done: {
    description: 'Signal that a worker has completed its task',
    schema: { bead_id: z.string().describe('The bead ID that was completed') },
  },
  get_status: {
    description: 'Get the current status of all workers and the task queue',
    schema: {},
  },
  reset_worker: {
    description: 'Force a stuck worker back to available state',
    schema: { worker_name: z.string().describe('The name of the worker to reset') },
  },
  retry_task: {
    description: 'Re-queue an in_progress task for retry',
    schema: { bead_id: z.string().describe('The bead ID to retry') },
  },
  task_failed: {
    description: 'Mark a task as blocked/failed and free the worker',
    schema: {
      bead_id: z.string().describe('The bead ID that failed'),
      reason: z.string().describe('The reason the task failed'),
    },
  },
  register_worker: {
    description: 'Register a worker with the bus (for polling-based dispatch)',
    schema: {
      name: z.string().min(1, 'Worker name is required').describe('The worker name (e.g., z.ai1)'),
    },
  },
  poll_task: {
    description: 'Long-poll for a task assignment (blocks until task or timeout)',
    schema: {
      name: z.string().min(1, 'Worker name is required').describe('The worker name'),
      timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 5000)'),
    },
  },
  ack_task: {
    description: 'Acknowledge receipt of a task before execution',
    schema: {
      name: z.string().min(1, 'Worker name is required').describe('The worker name'),
      bead_id: z.string().describe('The bead ID being acknowledged'),
    },
  },
} as const;

/**
 * Start the MCP server in client mode.
 *
 * Creates an MCP server that exposes all tools but forwards them to the daemon.
 * The daemon is auto-started if not running.
 */
export async function startClientMode(): Promise<void> {
  const server = new McpServer({
    name: 'claude-bus',
    version: '0.1.0',
  });

  // Register all tools with forwarding to daemon
  const toolNames = Object.keys(TOOL_SCHEMAS) as Array<keyof typeof TOOL_SCHEMAS>;

  for (const toolName of toolNames) {
    const toolDef = TOOL_SCHEMAS[toolName];
    // Register tool with schema so Claude knows the parameters
    (server.tool as Function)(
      toolName,
      toolDef.description,
      toolDef.schema,
      async (args: Record<string, unknown>) => {
        try {
          const result = await forwardToolCall(toolName, args);
          return jsonResponse(result);
        } catch (e) {
          return jsonResponse({
            error: `Tool call failed: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    );
  }

  // Start MCP server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
