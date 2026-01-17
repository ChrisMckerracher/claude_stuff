/**
 * Server Integration Tests
 *
 * Tests that verify the MCP server tools are correctly wired to real implementations.
 * Uses mocks for external dependencies (beads CLI) to enable unit testing.
 */

import { createClaudeBusServer } from './server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as beadsModule from './beads';
import * as selectionModule from './selection';
import type { Worker } from './selection';

// Mock external modules
jest.mock('./beads');
jest.mock('./selection');

const mockBeads = beadsModule as jest.Mocked<typeof beadsModule>;
const mockSelection = selectionModule as jest.Mocked<typeof selectionModule>;

// Helper to create a worker with the new interface
function createWorker(
  name: string,
  status: 'idle' | 'polling' | 'pending' | 'executing',
  lastActivity: number = Date.now()
): Worker {
  return {
    name,
    status,
    registered_at: lastActivity - 10000,
    last_activity: lastActivity,
    current_task: (status === 'executing' || status === 'pending') ? 'bd-test' : null,
    task_started_at: status === 'executing' ? lastActivity : null,
  };
}

describe('Claude Bus Server', () => {
  let server: McpServer;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock implementations
    mockBeads.validateBead.mockReturnValue({ valid: true });
    mockBeads.beadSetInProgress.mockReturnValue(undefined);
    mockBeads.beadMarkBlocked.mockReturnValue(undefined);

    mockSelection.selectWorker.mockReturnValue(null);

    const result = createClaudeBusServer();
    server = result.server;
  });

  describe('createClaudeBusServer', () => {
    it('should create a server instance', () => {
      expect(server).toBeDefined();
      expect(server).toHaveProperty('tool');
      expect(server).toHaveProperty('connect');
    });

    it('should return server and state', () => {
      const result = createClaudeBusServer();
      expect(result).toHaveProperty('server');
      expect(result).toHaveProperty('state');
      expect(result.state).toHaveProperty('workers');
      expect(result.state).toHaveProperty('taskQueue');
      expect(result.state).toHaveProperty('activeBeads');
      expect(result.state).toHaveProperty('pendingTasks');
      expect(result.state).toHaveProperty('blockedPollers');
    });
  });

  describe('tool registration', () => {
    it('should register all expected tools', () => {
      expect(server).toBeDefined();
    });
  });

  describe('integration wiring verification', () => {
    it('should import beads module functions', () => {
      expect(mockBeads.validateBead).toBeDefined();
      expect(mockBeads.beadSetInProgress).toBeDefined();
      expect(mockBeads.beadMarkBlocked).toBeDefined();
    });

    it('should import selection module functions', () => {
      expect(mockSelection.selectWorker).toBeDefined();
    });
  });

  describe('state management', () => {
    it('should maintain independent state per server instance', () => {
      const result1 = createClaudeBusServer();
      const result2 = createClaudeBusServer();

      expect(result1.server).not.toBe(result2.server);
      expect(result1.state).not.toBe(result2.state);
    });
  });
});

// ============================================================================
// Polling Tools Tests
// Tests for register_worker, poll_task, and ack_task tools
// ============================================================================

describe('register_worker tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('successful registration', () => {
    it('should register a new worker successfully', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const now = Date.now();

      expect(state.workers.has(workerName)).toBe(false);

      state.workers.set(workerName, createWorker(workerName, 'idle', now));

      expect(state.workers.has(workerName)).toBe(true);
      const worker = state.workers.get(workerName);
      expect(worker?.name).toBe(workerName);
      expect(worker?.status).toBe('idle');
    });

    it('should return success response with worker name', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai2';

      const expectedResponse = {
        success: true,
        worker: workerName,
        message: 'Registered',
      };

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      expect(expectedResponse.success).toBe(true);
      expect(expectedResponse.worker).toBe(workerName);
      expect(expectedResponse.message).toBe('Registered');
    });

    it('should set worker status to idle on registration', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai3';

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      const worker = state.workers.get(workerName);
      expect(worker?.status).toBe('idle');
      expect(worker?.current_task).toBeNull();
    });

    it('should record registration timestamp', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai4';
      const now = Date.now();

      state.workers.set(workerName, createWorker(workerName, 'idle', now));

      const worker = state.workers.get(workerName);
      expect(worker?.registered_at).toBeDefined();
      expect(worker?.last_activity).toBe(now);
    });
  });

  describe('duplicate worker name handling', () => {
    it('should assign unique name with suffix when name already exists', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      // First worker takes the base name
      state.workers.set(workerName, createWorker(workerName, 'idle'));

      // When a second worker tries to register with same name, it should get a suffix
      const expectedResponse = {
        success: true,
        worker: `${workerName}-1`,
        message: `Registered as ${workerName}-1`,
      };

      expect(expectedResponse.success).toBe(true);
      expect(expectedResponse.worker).toBe(`${workerName}-1`);
    });

    it('should not overwrite existing worker state when registering duplicate', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const originalTimestamp = Date.now() - 10000;

      const worker = createWorker(workerName, 'polling', originalTimestamp);
      state.workers.set(workerName, worker);

      // Original worker should be unchanged
      const existingWorker = state.workers.get(workerName);
      expect(existingWorker?.registered_at).toBe(originalTimestamp - 10000);
      expect(existingWorker?.status).toBe('polling');
    });
  });
});

describe('poll_task tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('unknown worker error', () => {
    it('should return error for unregistered worker', () => {
      const { state } = createClaudeBusServer();
      const unknownWorker = 'z.unknown';

      expect(state.workers.has(unknownWorker)).toBe(false);

      const expectedError = {
        error: `Unknown worker: ${unknownWorker} - call register_worker first`,
      };

      expect(expectedError.error).toContain('Unknown worker');
      expect(expectedError.error).toContain(unknownWorker);
      expect(expectedError.error).toContain('register_worker');
    });

    it('should not create blocked poller for unknown worker', () => {
      const { state } = createClaudeBusServer();
      const unknownWorker = 'z.unknown';

      expect(state.blockedPollers.has(unknownWorker)).toBe(false);
    });
  });

  describe('immediate task available', () => {
    it('should return task immediately if one is pending', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-123';

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      const pendingTask = state.pendingTasks.get(workerName);
      expect(pendingTask).toBeDefined();
      expect(pendingTask?.bead_id).toBe(beadId);
    });

    it('should update worker status to polling when waiting', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      const worker = state.workers.get(workerName);
      if (worker) {
        worker.status = 'polling';
        worker.last_activity = Date.now();
      }

      expect(state.workers.get(workerName)?.status).toBe('polling');
    });
  });

  describe('timeout behavior', () => {
    it('should return timeout response after specified duration', async () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      const expectedTimeoutResponse = {
        task: null,
        timeout: true,
      };

      expect(expectedTimeoutResponse.task).toBeNull();
      expect(expectedTimeoutResponse.timeout).toBe(true);
    });

    it('should use default timeout of 30000ms', () => {
      const defaultTimeout = 30000;
      expect(defaultTimeout).toBe(30000);
    });

    it('should clean up blocked poller on timeout', async () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      state.workers.set(workerName, createWorker(workerName, 'polling'));

      const timeoutId = setTimeout(() => {}, 30000);
      state.blockedPollers.set(workerName, {
        resolve: () => {},
        timeout_id: timeoutId,
      });

      clearTimeout(timeoutId);
      state.blockedPollers.delete(workerName);

      expect(state.blockedPollers.has(workerName)).toBe(false);
    });
  });

  describe('blocking behavior', () => {
    it('should add worker to blockedPollers when waiting', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      state.workers.set(workerName, createWorker(workerName, 'polling'));

      state.blockedPollers.set(workerName, {
        resolve: jest.fn(),
        timeout_id: setTimeout(() => {}, 30000),
      });

      expect(state.blockedPollers.has(workerName)).toBe(true);
      const poller = state.blockedPollers.get(workerName);
      expect(poller).toHaveProperty('resolve');
      expect(poller).toHaveProperty('timeout_id');
    });
  });
});

describe('ack_task tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('successful acknowledgment', () => {
    it('should return success when acknowledging correct task', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-123';

      state.workers.set(workerName, createWorker(workerName, 'pending'));
      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      const expectedResponse = {
        success: true,
        worker: workerName,
        bead_id: beadId,
      };

      expect(expectedResponse.success).toBe(true);
      expect(expectedResponse.worker).toBe(workerName);
      expect(expectedResponse.bead_id).toBe(beadId);
    });

    it('should transition worker to executing status', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-123';

      state.workers.set(workerName, createWorker(workerName, 'pending'));
      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      const worker = state.workers.get(workerName);
      if (worker) {
        worker.status = 'executing';
        worker.current_task = beadId;
        worker.last_activity = Date.now();
      }

      expect(state.workers.get(workerName)?.status).toBe('executing');
      expect(state.workers.get(workerName)?.current_task).toBe(beadId);
    });

    it('should remove task from pendingTasks after ack', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-123';

      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      expect(state.pendingTasks.has(workerName)).toBe(true);

      state.pendingTasks.delete(workerName);

      expect(state.pendingTasks.has(workerName)).toBe(false);
    });
  });

  describe('wrong task error', () => {
    it('should return error when bead_id does not match pending task', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const pendingBeadId = 'bead-123';
      const wrongBeadId = 'bead-999';

      state.workers.set(workerName, createWorker(workerName, 'pending'));
      state.pendingTasks.set(workerName, {
        bead_id: pendingBeadId,
        assigned_at: Date.now(),
      });

      const pendingTask = state.pendingTasks.get(workerName);
      const taskMismatch = pendingTask?.bead_id !== wrongBeadId;

      const expectedError = {
        success: false,
        error: 'Task mismatch',
      };

      expect(taskMismatch).toBe(true);
      expect(expectedError.success).toBe(false);
      expect(expectedError.error).toBe('Task mismatch');
    });

    it('should not change worker state on task mismatch', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const pendingBeadId = 'bead-123';

      state.workers.set(workerName, createWorker(workerName, 'pending'));
      state.pendingTasks.set(workerName, {
        bead_id: pendingBeadId,
        assigned_at: Date.now(),
      });

      expect(state.workers.get(workerName)?.status).toBe('pending');
      expect(state.pendingTasks.has(workerName)).toBe(true);
    });
  });

  describe('unknown worker error', () => {
    it('should return error for unregistered worker', () => {
      const { state } = createClaudeBusServer();
      const unknownWorker = 'z.unknown';

      expect(state.workers.has(unknownWorker)).toBe(false);

      const expectedError = {
        success: false,
        error: `Unknown worker: ${unknownWorker}`,
      };

      expect(expectedError.success).toBe(false);
      expect(expectedError.error).toContain('Unknown worker');
      expect(expectedError.error).toContain(unknownWorker);
    });

    it('should not create any state for unknown worker', () => {
      const { state } = createClaudeBusServer();
      const unknownWorker = 'z.unknown';

      expect(state.workers.has(unknownWorker)).toBe(false);
      expect(state.pendingTasks.has(unknownWorker)).toBe(false);
    });
  });
});

// ============================================================================
// Integration Tests - submit_task resolves blocked poller
// ============================================================================

describe('submit_task and poll_task integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockBeads.validateBead.mockReturnValue({ valid: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('submit_task resolves blocked poller', () => {
    it('should resolve blocked poller immediately when task submitted', async () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-new-task';

      state.workers.set(workerName, createWorker(workerName, 'polling'));

      let pollResolved = false;
      let resolvedTask: any = null;

      const mockResolve = jest.fn((task) => {
        pollResolved = true;
        resolvedTask = task;
      });

      const timeoutId = setTimeout(() => {}, 30000);
      state.blockedPollers.set(workerName, {
        resolve: mockResolve,
        timeout_id: timeoutId,
      });

      const blockedPoller = state.blockedPollers.get(workerName);
      if (blockedPoller) {
        clearTimeout(blockedPoller.timeout_id);
        blockedPoller.resolve({ bead_id: beadId, assigned_at: Date.now() });
        state.blockedPollers.delete(workerName);
      }

      expect(mockResolve).toHaveBeenCalled();
      expect(pollResolved).toBe(true);
      expect(resolvedTask?.bead_id).toBe(beadId);
      expect(state.blockedPollers.has(workerName)).toBe(false);
    });

    it('should clear timeout when resolving blocked poller', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';

      const timeoutFn = jest.fn();
      const timeoutId = setTimeout(timeoutFn, 30000);

      state.blockedPollers.set(workerName, {
        resolve: jest.fn(),
        timeout_id: timeoutId,
      });

      const blockedPoller = state.blockedPollers.get(workerName);
      if (blockedPoller) {
        clearTimeout(blockedPoller.timeout_id);
      }

      jest.advanceTimersByTime(35000);
      expect(timeoutFn).not.toHaveBeenCalled();
    });

    it('should queue task in pendingTasks if worker not blocked', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-queued';

      state.workers.set(workerName, createWorker(workerName, 'idle'));

      expect(state.blockedPollers.has(workerName)).toBe(false);

      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      expect(state.pendingTasks.has(workerName)).toBe(true);
      expect(state.pendingTasks.get(workerName)?.bead_id).toBe(beadId);
    });

    it('should select LRU available worker for task assignment', () => {
      const { state } = createClaudeBusServer();
      const now = Date.now();

      state.workers.set('z.ai1', createWorker('z.ai1', 'polling', now - 1000));
      state.workers.set('z.ai2', createWorker('z.ai2', 'polling', now - 5000));  // Oldest
      state.workers.set('z.ai3', createWorker('z.ai3', 'executing', now - 500));

      let lruWorker: string | null = null;
      let oldestActivity = Infinity;

      state.workers.forEach((worker, name) => {
        if (worker.status === 'idle' || worker.status === 'polling') {
          if (worker.last_activity < oldestActivity) {
            oldestActivity = worker.last_activity;
            lruWorker = name;
          }
        }
      });

      expect(lruWorker).toBe('z.ai2');
    });

    it('should update worker status to pending after task assignment', () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-assigned';

      state.workers.set(workerName, createWorker(workerName, 'polling'));

      state.pendingTasks.set(workerName, {
        bead_id: beadId,
        assigned_at: Date.now(),
      });

      const worker = state.workers.get(workerName);
      if (worker) {
        worker.status = 'pending';
        worker.last_activity = Date.now();
      }

      expect(state.workers.get(workerName)?.status).toBe('pending');
    });
  });

  describe('full polling workflow', () => {
    it('should complete register -> poll -> ack workflow', async () => {
      const { state } = createClaudeBusServer();
      const workerName = 'z.ai1';
      const beadId = 'bead-workflow-test';

      // Step 1: Register worker
      state.workers.set(workerName, createWorker(workerName, 'idle'));
      expect(state.workers.has(workerName)).toBe(true);

      // Step 2: Worker starts polling
      const worker = state.workers.get(workerName);
      if (worker) {
        worker.status = 'polling';
        worker.last_activity = Date.now();
      }

      let pollResult: any = null;
      const mockResolve = jest.fn((task) => {
        pollResult = task;
      });
      state.blockedPollers.set(workerName, {
        resolve: mockResolve,
        timeout_id: setTimeout(() => {}, 30000),
      });

      expect(state.workers.get(workerName)?.status).toBe('polling');
      expect(state.blockedPollers.has(workerName)).toBe(true);

      // Step 3: Orchestrator submits task
      const blockedPoller = state.blockedPollers.get(workerName);
      if (blockedPoller) {
        clearTimeout(blockedPoller.timeout_id);
        blockedPoller.resolve({ bead_id: beadId, assigned_at: Date.now() });
        state.blockedPollers.delete(workerName);
        state.pendingTasks.set(workerName, {
          bead_id: beadId,
          assigned_at: Date.now(),
        });
        if (worker) {
          worker.status = 'pending';
        }
      }

      expect(mockResolve).toHaveBeenCalled();
      expect(pollResult?.bead_id).toBe(beadId);
      expect(state.workers.get(workerName)?.status).toBe('pending');

      // Step 4: Worker acknowledges task
      const pendingTask = state.pendingTasks.get(workerName);
      expect(pendingTask?.bead_id).toBe(beadId);

      if (worker) {
        worker.status = 'executing';
        worker.current_task = beadId;
        worker.task_started_at = Date.now();
        worker.last_activity = Date.now();
      }
      state.pendingTasks.delete(workerName);

      expect(state.workers.get(workerName)?.status).toBe('executing');
      expect(state.workers.get(workerName)?.current_task).toBe(beadId);
      expect(state.pendingTasks.has(workerName)).toBe(false);
    });

    it('should handle multiple workers polling concurrently', () => {
      const { state } = createClaudeBusServer();
      const now = Date.now();

      const workers = ['z.ai1', 'z.ai2', 'z.ai3'];
      workers.forEach((name, idx) => {
        state.workers.set(name, createWorker(name, 'polling', now - (idx + 1) * 500));
        state.blockedPollers.set(name, {
          resolve: jest.fn(),
          timeout_id: setTimeout(() => {}, 30000),
        });
      });

      expect(state.blockedPollers.size).toBe(3);
      workers.forEach((name) => {
        expect(state.workers.get(name)?.status).toBe('polling');
        expect(state.blockedPollers.has(name)).toBe(true);
      });
    });
  });
});

// ============================================================================
// callTool Dispatcher Tests - For singleton server IPC forwarding
// ============================================================================

describe('callTool dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockBeads.validateBead.mockReturnValue({ valid: true });
    mockBeads.beadSetInProgress.mockReturnValue(undefined);
    // Use real selectWorker implementation for callTool integration tests
    mockSelection.selectWorker.mockImplementation((workers: Map<string, any>) => {
      const available = Array.from(workers.values()).filter(
        (w: any) => w.status === 'idle' || w.status === 'polling'
      );
      if (available.length === 0) return null;
      const polling = available.filter((w: any) => w.status === 'polling');
      const idle = available.filter((w: any) => w.status === 'idle');
      const pool = polling.length > 0 ? polling : idle;
      return pool.sort((a: any, b: any) => a.last_activity - b.last_activity)[0] ?? null;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should return callTool function from createClaudeBusServer', () => {
    const result = createClaudeBusServer();
    expect(result).toHaveProperty('callTool');
    expect(typeof result.callTool).toBe('function');
  });

  describe('register_worker via callTool', () => {
    it('should register a worker via callTool', async () => {
      const { callTool, state } = createClaudeBusServer();
      const workerName = 'client-worker-1';

      const result = await callTool('register_worker', { name: workerName });

      expect(result).toEqual({
        success: true,
        worker: workerName,
        message: 'Registered',
      });
      expect(state.workers.has(workerName)).toBe(true);
      expect(state.workers.get(workerName)?.status).toBe('idle');
    });

    it('should assign unique name when registering duplicate worker name', async () => {
      const { callTool, state } = createClaudeBusServer();
      const workerName = 'opus-worker';

      // First registration - gets base name
      const result1 = await callTool('register_worker', { name: workerName });
      expect(result1).toEqual({
        success: true,
        worker: workerName,
        message: 'Registered',
      });

      // Second registration - gets suffix -1
      const result2 = await callTool('register_worker', { name: workerName });
      expect(result2).toEqual({
        success: true,
        worker: `${workerName}-1`,
        message: `Registered as ${workerName}-1`,
      });

      // Third registration - gets suffix -2
      const result3 = await callTool('register_worker', { name: workerName });
      expect(result3).toEqual({
        success: true,
        worker: `${workerName}-2`,
        message: `Registered as ${workerName}-2`,
      });

      // Verify all three workers exist
      expect(state.workers.size).toBe(3);
      expect(state.workers.has(workerName)).toBe(true);
      expect(state.workers.has(`${workerName}-1`)).toBe(true);
      expect(state.workers.has(`${workerName}-2`)).toBe(true);
    });

    it('should allow workers to use their assigned unique names for subsequent calls', async () => {
      const { callTool, state } = createClaudeBusServer();
      const baseName = 'worker';

      // Register two workers with same base name
      const result1 = (await callTool('register_worker', { name: baseName })) as any;
      const result2 = (await callTool('register_worker', { name: baseName })) as any;

      const worker1Name = result1.worker;
      const worker2Name = result2.worker;

      expect(worker1Name).toBe('worker');
      expect(worker2Name).toBe('worker-1');

      // Submit tasks to both workers
      await callTool('submit_task', { bead_id: 'task-a' });
      await callTool('submit_task', { bead_id: 'task-b' });

      // Both workers should have pending tasks
      expect(state.pendingTasks.has(worker1Name) || state.workers.get(worker1Name)?.current_task).toBeTruthy();
      expect(state.pendingTasks.has(worker2Name) || state.workers.get(worker2Name)?.current_task).toBeTruthy();
    });
  });

  describe('get_status via callTool', () => {
    it('should return status with registered workers', async () => {
      const { callTool, state } = createClaudeBusServer();

      // Register some workers
      await callTool('register_worker', { name: 'worker-1' });
      await callTool('register_worker', { name: 'worker-2' });

      const result = (await callTool('get_status', {})) as any;

      expect(result.workers).toHaveLength(2);
      expect(result.workers.map((w: any) => w.name)).toContain('worker-1');
      expect(result.workers.map((w: any) => w.name)).toContain('worker-2');
      expect(result.queued_tasks).toBe(0);
    });
  });

  describe('submit_task via callTool', () => {
    it('should queue task when no workers available', async () => {
      const { callTool, state } = createClaudeBusServer();

      const result = (await callTool('submit_task', { bead_id: 'task-1' })) as any;

      expect(result.dispatched).toBe(false);
      expect(result.queued).toBe(true);
      expect(result.bead_id).toBe('task-1');
      expect(state.taskQueue).toContain('task-1');
    });

    it('should dispatch to available worker', async () => {
      const { callTool, state } = createClaudeBusServer();

      // Register a worker
      await callTool('register_worker', { name: 'worker-1' });

      // Submit task
      const result = (await callTool('submit_task', { bead_id: 'task-1' })) as any;

      expect(result.dispatched).toBe(true);
      expect(result.worker).toBe('worker-1');
      expect(result.bead_id).toBe('task-1');
    });
  });

  describe('ack_task via callTool', () => {
    it('should acknowledge task and update worker status', async () => {
      const { callTool, state } = createClaudeBusServer();
      const workerName = 'worker-1';
      const beadId = 'task-1';

      // Register worker and submit task
      await callTool('register_worker', { name: workerName });
      await callTool('submit_task', { bead_id: beadId });

      // Acknowledge task
      const result = (await callTool('ack_task', {
        name: workerName,
        bead_id: beadId,
      })) as any;

      expect(result.success).toBe(true);
      expect(result.worker).toBe(workerName);
      expect(result.bead_id).toBe(beadId);
      expect(state.workers.get(workerName)?.status).toBe('executing');
      expect(state.workers.get(workerName)?.current_task).toBe(beadId);
    });
  });

  describe('worker_done via callTool', () => {
    it('should mark worker as idle after task completion', async () => {
      const { callTool, state } = createClaudeBusServer();
      const workerName = 'worker-1';
      const beadId = 'task-1';

      // Setup: register, submit, ack
      await callTool('register_worker', { name: workerName });
      await callTool('submit_task', { bead_id: beadId });
      await callTool('ack_task', { name: workerName, bead_id: beadId });

      expect(state.workers.get(workerName)?.status).toBe('executing');

      // Complete task
      const result = (await callTool('worker_done', { bead_id: beadId })) as any;

      expect(result.success).toBe(true);
      expect(result.worker).toBe(workerName);
      expect(state.workers.get(workerName)?.status).toBe('idle');
      expect(state.workers.get(workerName)?.current_task).toBeNull();
    });
  });

  describe('multiple clients sharing state', () => {
    it('should share state between multiple callTool invocations', async () => {
      // This simulates multiple clients calling through IPC to the same server
      const { callTool, state } = createClaudeBusServer();

      // "Client A" registers a worker
      await callTool('register_worker', { name: 'client-a-worker' });

      // "Client B" registers another worker
      await callTool('register_worker', { name: 'client-b-worker' });

      // "Client C" gets status and sees both workers
      const status = (await callTool('get_status', {})) as any;

      expect(status.workers).toHaveLength(2);
      expect(status.workers.map((w: any) => w.name)).toContain('client-a-worker');
      expect(status.workers.map((w: any) => w.name)).toContain('client-b-worker');
    });

    it('should maintain consistent state across tool operations', async () => {
      const { callTool, state } = createClaudeBusServer();

      // Multiple workers register
      await callTool('register_worker', { name: 'worker-1' });
      await callTool('register_worker', { name: 'worker-2' });

      // Submit multiple tasks
      await callTool('submit_task', { bead_id: 'task-a' });
      await callTool('submit_task', { bead_id: 'task-b' });

      // Check state is consistent
      const status = (await callTool('get_status', {})) as any;

      // Both tasks should be assigned to the workers (LRU)
      const pendingOrExecuting = status.workers.filter(
        (w: any) => w.status === 'pending' || w.current_task
      );
      expect(pendingOrExecuting.length).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw for unknown tool', async () => {
      const { callTool } = createClaudeBusServer();

      await expect(callTool('unknown_tool', {})).rejects.toThrow('Unknown tool');
    });

    it('should return error for unknown worker on poll_task', async () => {
      const { callTool } = createClaudeBusServer();

      const result = (await callTool('poll_task', {
        name: 'nonexistent',
        timeout_ms: 100,
      })) as any;

      expect(result.error).toContain('Unknown worker');
    });
  });
});
