/**
 * Server Tests (Client Mode)
 *
 * Tests for the thin MCP server that forwards to the daemon.
 * These tests verify the MCP tool registration and schema definitions.
 *
 * Note: Functional tool behavior is tested in daemon.test.ts since
 * the daemon owns all the state and logic.
 */

import { TOOL_SCHEMAS, jsonResponse } from './server';

// ============================================================================
// TOOL_SCHEMAS Tests
// Verify shared schemas are complete and well-formed
// ============================================================================

describe('TOOL_SCHEMAS', () => {
  const expectedTools = [
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

  it('should define all expected tools', () => {
    const definedTools = Object.keys(TOOL_SCHEMAS);
    expect(definedTools).toEqual(expect.arrayContaining(expectedTools));
    expect(expectedTools).toEqual(expect.arrayContaining(definedTools));
  });

  it('should have description and schema for each tool', () => {
    for (const toolName of expectedTools) {
      const toolDef = TOOL_SCHEMAS[toolName as keyof typeof TOOL_SCHEMAS];
      expect(toolDef).toBeDefined();
      expect(toolDef.description).toBeDefined();
      expect(typeof toolDef.description).toBe('string');
      expect(toolDef.description.length).toBeGreaterThan(0);
      expect(toolDef.schema).toBeDefined();
    }
  });

  describe('register_worker schema', () => {
    it('should require name parameter', () => {
      const schema = TOOL_SCHEMAS.register_worker.schema;
      expect(schema).toHaveProperty('name');
    });
  });

  describe('poll_task schema', () => {
    it('should require name and optional timeout_ms', () => {
      const schema = TOOL_SCHEMAS.poll_task.schema;
      expect(schema).toHaveProperty('name');
      expect(schema).toHaveProperty('timeout_ms');
    });
  });

  describe('ack_task schema', () => {
    it('should require name and bead_id', () => {
      const schema = TOOL_SCHEMAS.ack_task.schema;
      expect(schema).toHaveProperty('name');
      expect(schema).toHaveProperty('bead_id');
    });
  });

  describe('get_status schema', () => {
    it('should have empty schema (no required params)', () => {
      const schema = TOOL_SCHEMAS.get_status.schema;
      expect(Object.keys(schema)).toHaveLength(0);
    });
  });

  describe('submit_task schema', () => {
    it('should require bead_id parameter', () => {
      const schema = TOOL_SCHEMAS.submit_task.schema;
      expect(schema).toHaveProperty('bead_id');
    });
  });

  describe('worker_done schema', () => {
    it('should require bead_id parameter', () => {
      const schema = TOOL_SCHEMAS.worker_done.schema;
      expect(schema).toHaveProperty('bead_id');
    });
  });

  describe('reset_worker schema', () => {
    it('should require worker_name parameter', () => {
      const schema = TOOL_SCHEMAS.reset_worker.schema;
      expect(schema).toHaveProperty('worker_name');
    });
  });

  describe('retry_task schema', () => {
    it('should require bead_id parameter', () => {
      const schema = TOOL_SCHEMAS.retry_task.schema;
      expect(schema).toHaveProperty('bead_id');
    });
  });

  describe('task_failed schema', () => {
    it('should require bead_id and reason parameters', () => {
      const schema = TOOL_SCHEMAS.task_failed.schema;
      expect(schema).toHaveProperty('bead_id');
      expect(schema).toHaveProperty('reason');
    });
  });
});

// ============================================================================
// jsonResponse Helper Tests
// ============================================================================

describe('jsonResponse', () => {
  it('should wrap data in MCP response format', () => {
    const data = { success: true, worker: 'test-1' };
    const response = jsonResponse(data);

    expect(response).toHaveProperty('content');
    expect(response.content).toHaveLength(1);
    expect(response.content[0].type).toBe('text');
    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });

  it('should handle string data', () => {
    const response = jsonResponse('hello');

    expect(response.content[0].text).toBe('"hello"');
  });

  it('should handle number data', () => {
    const response = jsonResponse(42);

    expect(response.content[0].text).toBe('42');
  });

  it('should handle array data', () => {
    const data = [1, 2, 3];
    const response = jsonResponse(data);

    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });

  it('should handle null data', () => {
    const response = jsonResponse(null);

    expect(response.content[0].text).toBe('null');
  });

  it('should handle nested objects', () => {
    const data = {
      workers: [
        { name: 'w1', status: 'idle' },
        { name: 'w2', status: 'executing' },
      ],
      queue: ['task-1', 'task-2'],
    };
    const response = jsonResponse(data);

    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });
});
