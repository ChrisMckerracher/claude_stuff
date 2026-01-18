/**
 * Claude Bus MCP Server
 *
 * An MCP server that enables multiple Claude Code instances to coordinate work
 * using polling-based dispatch. One instance (orchestrator) creates tasks, and
 * idle instances (workers) poll for and execute them.
 *
 * This implementation integrates with:
 * - beads CLI for task tracking
 * - LRU selection for fair work distribution
 * - Polling-based dispatch (workers self-register and poll for tasks)
 *
 * @module claude-bus/server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type {
  State,
  Worker,
  SubmitTaskResponse,
  WorkerDoneResponse,
  GetStatusResponse,
  ResetWorkerResponse,
  RetryTaskResponse,
  TaskFailedResponse,
  PendingTask,
  RegisterWorkerResponse,
  PollTaskResponse,
  AckTaskResponse,
} from './types.js';
import { createState } from './types.js';
import { validateBead, beadSetInProgress, beadMarkBlocked } from './beads.js';
import { selectWorker } from './selection.js';
import { startIpcServer, forwardToolCall, type IpcRequest, type IpcResponse } from './ipc.js';

// Helper to create a JSON text response
function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/**
 * Worker name validation pattern.
 * - Must start with alphanumeric character
 * - Can contain letters, numbers, dots, underscores, hyphens
 * - Length: 1-64 characters
 */
const WORKER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * Validate a worker name against the pattern.
 * Returns an error message if invalid, or null if valid.
 */
function validateWorkerName(name: string): string | null {
  if (!name || name.trim() === '') {
    return 'Worker name is required';
  }
  if (!WORKER_NAME_PATTERN.test(name)) {
    return 'Invalid worker name: must start with alphanumeric, contain only a-z, 0-9, ., _, - and be 1-64 characters';
  }
  return null;
}

/**
 * Generate a unique worker name by appending a numeric suffix if needed.
 *
 * @param baseName - The desired base name (e.g., "opus-worker")
 * @param workers - Map of existing workers
 * @returns Unique name (e.g., "opus-worker" or "opus-worker-1", "opus-worker-2", etc.)
 */
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

/**
 * Shared tool schema definitions for MCP tools.
 * Used by both server mode (createClaudeBusServer) and client mode (startClientMode)
 * to ensure consistent parameter schemas are exposed to Claude.
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
    description: 'Force a stuck worker back to idle state',
    schema: { worker_name: z.string().describe('The worker name to reset') },
  },
  retry_task: {
    description: 'Re-queue an in_progress task for another worker',
    schema: { bead_id: z.string().describe('The bead ID to retry') },
  },
  task_failed: {
    description: 'Mark a task as blocked and free the worker',
    schema: {
      bead_id: z.string().describe('The bead ID that failed'),
      reason: z.string().describe('Reason for failure'),
    },
  },
  register_worker: {
    description: 'Register a worker with the bus (for polling-based dispatch)',
    schema: { name: z.string().min(1, 'Worker name is required').describe('The worker name (e.g., z.ai1)') },
  },
  poll_task: {
    description: 'Long-poll for a task assignment (blocks until task or timeout)',
    schema: {
      name: z.string().min(1, 'Worker name is required').describe('The worker name'),
      timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
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
 * Internal helper to assign a task to a polling worker.
 *
 * Marks the task as pending and the worker will receive it when they call poll_task().
 *
 * @param state - Server state
 * @param worker - Worker to assign to
 * @param beadId - Bead ID to assign
 */
function assignTaskToWorker(state: State, worker: Worker, beadId: string): void {
  // Track active bead (dedup)
  state.activeBeads.add(beadId);

  // Create pending task for this worker
  const pendingTask: PendingTask = {
    bead_id: beadId,
    assigned_at: Date.now(),
  };
  state.pendingTasks.set(worker.name, pendingTask);

  // Update worker state to pending (waiting for ack)
  worker.status = 'pending';
  worker.last_activity = Date.now();
  worker.current_task = beadId;
}

/**
 * Process the task queue, dispatching waiting tasks to available workers.
 *
 * Called after a worker becomes available to potentially dispatch queued tasks.
 *
 * @param state - Server state
 */
function processQueue(state: State): void {
  while (state.taskQueue.length > 0) {
    const worker = selectWorker(state.workers);
    if (!worker) break;

    const beadId = state.taskQueue.shift()!;

    // Check if this worker has a blocked poll waiting
    const blockedPoller = state.blockedPollers.get(worker.name);

    if (blockedPoller) {
      // Resolve their blocked poll immediately
      assignTaskToWorker(state, worker, beadId);
      blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
    } else {
      // Worker not currently polling - just assign for their next poll
      assignTaskToWorker(state, worker, beadId);
    }
  }
}

/**
 * Create an MCP server with claude-bus tools.
 *
 * The server exposes these tools:
 * - submit_task(bead_id) - Dispatch a task to an available worker
 * - worker_done(bead_id) - Mark worker available after task completion
 * - get_status() - List workers, queue, and idle times
 * - reset_worker(worker_name) - Force a stuck worker back to idle
 * - retry_task(bead_id) - Re-queue an in_progress task
 * - task_failed(bead_id, reason) - Mark task blocked, free worker
 * - register_worker(name) - Register a worker for polling
 * - poll_task(name, timeout_ms) - Long-poll for task assignment
 * - ack_task(name, bead_id) - Acknowledge task receipt
 *
 * @returns Object containing the configured McpServer instance, state, and tool dispatcher
 */
export function createClaudeBusServer(): {
  server: McpServer;
  state: State;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
} {
  const server = new McpServer({
    name: 'claude-bus',
    version: '0.1.0',
  });

  // Server state - tracks workers and task queue
  const state: State = createState();

  // ─── submit_task ──────────────────────────────────────────────────────
  (server.tool as Function)(
    'submit_task',
    'Submit a bead task to be dispatched to an available worker',
    { bead_id: z.string().describe('The bead ID to submit for execution') },
    async ({ bead_id }: { bead_id: string }) => {
      // Validate bead exists and is in submittable state
      const validation = validateBead(bead_id);
      if (!validation.valid) {
        const response: SubmitTaskResponse = {
          dispatched: false,
          error: validation.error,
          bead_id,
        };
        return jsonResponse(response);
      }

      // Dedup: reject if already active or queued
      if (state.activeBeads.has(bead_id)) {
        const response: SubmitTaskResponse = {
          dispatched: false,
          error: 'Task already active or queued',
          bead_id,
        };
        return jsonResponse(response);
      }

      // Select LRU available worker
      const worker = selectWorker(state.workers);

      if (worker) {
        // Check if this worker has a blocked poll waiting
        const blockedPoller = state.blockedPollers.get(worker.name);

        if (blockedPoller) {
          // Resolve their blocked poll immediately
          assignTaskToWorker(state, worker, bead_id);
          blockedPoller.resolve(state.pendingTasks.get(worker.name)!);

          const response: SubmitTaskResponse = {
            dispatched: true,
            worker: worker.name,
            bead_id,
          };
          return jsonResponse(response);
        }

        // Worker not currently polling - assign for their next poll
        assignTaskToWorker(state, worker, bead_id);

        const response: SubmitTaskResponse = {
          dispatched: true,
          worker: worker.name,
          bead_id,
        };
        return jsonResponse(response);
      } else {
        // No worker available - queue the task
        state.activeBeads.add(bead_id);
        state.taskQueue.push(bead_id);
        const response: SubmitTaskResponse = {
          dispatched: false,
          queued: true,
          position: state.taskQueue.length,
          bead_id,
        };
        return jsonResponse(response);
      }
    }
  );

  // ─── worker_done ──────────────────────────────────────────────────────
  (server.tool as Function)(
    'worker_done',
    'Signal that a worker has completed its task',
    { bead_id: z.string().describe('The bead ID that was completed') },
    async ({ bead_id }: { bead_id: string }) => {
      // Remove from active set (allows resubmit if needed later)
      state.activeBeads.delete(bead_id);

      // Find worker with this task
      const worker = Array.from(state.workers.values()).find(
        (w) => w.current_task === bead_id
      );

      if (!worker) {
        const response: WorkerDoneResponse = {
          success: true,
          bead_id,
          warning: 'Worker not found',
        };
        return jsonResponse(response);
      }

      // Mark worker idle
      worker.status = 'idle';
      worker.last_activity = Date.now();
      worker.current_task = null;
      worker.task_started_at = null;

      // Process queue to dispatch waiting tasks
      processQueue(state);

      const response: WorkerDoneResponse = {
        success: true,
        bead_id,
        worker: worker.name,
      };
      return jsonResponse(response);
    }
  );

  // ─── get_status ───────────────────────────────────────────────────────
  (server.tool as Function)(
    'get_status',
    'Get the current status of all workers and the task queue',
    async () => {
      // Build worker list
      const workers = Array.from(state.workers.values()).map((w) => {
        // Get pending task for this worker (if any)
        const pending = state.pendingTasks.get(w.name);

        return {
          name: w.name,
          status: w.status,
          current_task: w.current_task,
          idle_seconds: (w.status === 'idle' || w.status === 'polling')
            ? Math.floor((Date.now() - w.last_activity) / 1000)
            : null,
          pending_task: pending?.bead_id ?? null,
        };
      });

      // Count polling statistics
      const pollingWorkers = Array.from(state.blockedPollers.keys()).length;
      const pendingWorkers = state.pendingTasks.size;

      const response: GetStatusResponse = {
        workers,
        queued_tasks: state.taskQueue.length,
        queue: [...state.taskQueue],
        polling_workers: pollingWorkers,
        pending_workers: pendingWorkers,
      };
      return jsonResponse(response);
    }
  );

  // ─── reset_worker ─────────────────────────────────────────────────────
  (server.tool as Function)(
    'reset_worker',
    'Force a stuck worker back to available state',
    { worker_name: z.string().describe('The name of the worker to reset') },
    async ({ worker_name }: { worker_name: string }) => {
      const worker = state.workers.get(worker_name);

      if (!worker) {
        const response: ResetWorkerResponse = {
          success: false,
          worker: worker_name,
          error: `Unknown worker: ${worker_name}`,
        };
        return jsonResponse(response);
      }

      const previousTask = worker.current_task;

      // Remove task from active set (allows retry)
      if (previousTask) {
        state.activeBeads.delete(previousTask);
      }

      // Remove any pending task
      state.pendingTasks.delete(worker_name);

      // Mark worker idle
      worker.status = 'idle';
      worker.last_activity = Date.now();
      worker.current_task = null;
      worker.task_started_at = null;

      // Process queue to dispatch waiting tasks
      processQueue(state);

      const response: ResetWorkerResponse = {
        success: true,
        worker: worker_name,
        previous_task: previousTask,
      };
      return jsonResponse(response);
    }
  );

  // ─── retry_task ───────────────────────────────────────────────────────
  (server.tool as Function)(
    'retry_task',
    'Re-queue an in_progress task for retry',
    { bead_id: z.string().describe('The bead ID to retry') },
    async ({ bead_id }: { bead_id: string }) => {
      // Dedup check: reject if task is still active (use reset_worker first if worker died)
      if (state.activeBeads.has(bead_id)) {
        const response: RetryTaskResponse = {
          dispatched: false,
          error: 'Task still active - use reset_worker first if worker died',
          bead_id,
        };
        return jsonResponse(response);
      }

      // Validate bead is in retryable state
      const validation = validateBead(bead_id);
      if (!validation.valid) {
        const response: RetryTaskResponse = {
          dispatched: false,
          error: validation.error,
          bead_id,
        };
        return jsonResponse(response);
      }

      // Select LRU available worker
      const worker = selectWorker(state.workers);

      if (worker) {
        // Check if this worker has a blocked poll waiting
        const blockedPoller = state.blockedPollers.get(worker.name);

        if (blockedPoller) {
          assignTaskToWorker(state, worker, bead_id);
          blockedPoller.resolve(state.pendingTasks.get(worker.name)!);

          const response: RetryTaskResponse = {
            dispatched: true,
            worker: worker.name,
            bead_id,
          };
          return jsonResponse(response);
        }

        // Worker not currently polling - assign for their next poll
        assignTaskToWorker(state, worker, bead_id);

        const response: RetryTaskResponse = {
          dispatched: true,
          worker: worker.name,
          bead_id,
        };
        return jsonResponse(response);
      } else {
        // No worker available - queue the task
        state.activeBeads.add(bead_id);
        state.taskQueue.push(bead_id);
        const response: RetryTaskResponse = {
          dispatched: false,
          queued: true,
          position: state.taskQueue.length,
          bead_id,
        };
        return jsonResponse(response);
      }
    }
  );

  // ─── task_failed ──────────────────────────────────────────────────────
  (server.tool as Function)(
    'task_failed',
    'Mark a task as blocked/failed and free the worker',
    {
      bead_id: z.string().describe('The bead ID that failed'),
      reason: z.string().describe('The reason the task failed'),
    },
    async ({ bead_id, reason }: { bead_id: string; reason: string }) => {
      // Mark bead as blocked (not closed, not in_progress)
      try {
        beadMarkBlocked(bead_id, reason);
      } catch (e) {
        const response: TaskFailedResponse = {
          success: false,
          bead_id,
          status: 'blocked',
          reason: `Failed to mark bead blocked: ${e instanceof Error ? e.message : String(e)}`,
        };
        return jsonResponse(response);
      }

      // Remove from active set
      state.activeBeads.delete(bead_id);

      // Find and free the worker
      const worker = Array.from(state.workers.values()).find(
        (w) => w.current_task === bead_id
      );

      if (worker) {
        worker.status = 'idle';
        worker.last_activity = Date.now();
        worker.current_task = null;
        worker.task_started_at = null;
      }

      // Process queue to dispatch waiting tasks
      processQueue(state);

      const response: TaskFailedResponse = {
        success: true,
        bead_id,
        status: 'blocked',
        reason,
      };
      return jsonResponse(response);
    }
  );

  // ─── register_worker (polling system) ────────────────────────────────
  (server.tool as Function)(
    'register_worker',
    'Register a worker with the bus (for polling-based dispatch)',
    { name: z.string().min(1, 'Worker name is required').describe('The worker name (e.g., z.ai1)') },
    async ({ name }: { name: string }) => {
      // Validate worker name format
      const nameError = validateWorkerName(name);
      if (nameError) {
        const response: RegisterWorkerResponse = {
          success: false,
          error: nameError,
        };
        return jsonResponse(response);
      }

      // Generate unique name (may append suffix if name already taken)
      const uniqueName = generateUniqueName(name, state.workers);

      // Create a new worker with the unique name
      const now = Date.now();
      const worker: Worker = {
        name: uniqueName,
        status: 'idle',
        registered_at: now,
        last_activity: now,
        current_task: null,
        task_started_at: null,
      };
      state.workers.set(uniqueName, worker);

      const response: RegisterWorkerResponse = {
        success: true,
        worker: uniqueName,
        message: uniqueName === name ? 'Registered' : `Registered as ${uniqueName}`,
      };
      return jsonResponse(response);
    }
  );

  // ─── poll_task (polling system) ──────────────────────────────────────
  (server.tool as Function)(
    'poll_task',
    'Long-poll for a task assignment (blocks until task or timeout)',
    {
      name: z.string().min(1, 'Worker name is required').describe('The worker name'),
      timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 30000)'),
    },
    async ({ name, timeout_ms }: { name: string; timeout_ms?: number }) => {
      // Validate worker name format
      const nameError = validateWorkerName(name);
      if (nameError) {
        const response: PollTaskResponse = {
          error: nameError,
        };
        return jsonResponse(response);
      }

      const timeout = timeout_ms ?? 30000;
      const worker = state.workers.get(name);

      if (!worker) {
        const response: PollTaskResponse = {
          error: `Unknown worker: ${name} - call register_worker first`,
        };
        return jsonResponse(response);
      }

      // Check if task already pending for this worker
      const pending = state.pendingTasks.get(name);
      if (pending) {
        const response: PollTaskResponse = {
          task: {
            bead_id: pending.bead_id,
            assigned_at: pending.assigned_at,
          },
        };
        return jsonResponse(response);
      }

      // Mark worker as polling (actively waiting for task)
      worker.status = 'polling';
      worker.last_activity = Date.now();

      // Block until task or timeout
      return new Promise<{ content: Array<{ type: 'text'; text: string }> }>((resolve) => {
        const timeoutId = setTimeout(() => {
          state.blockedPollers.delete(name);
          const response: PollTaskResponse = {
            task: null,
            timeout: true,
          };
          resolve(jsonResponse(response));
        }, timeout);

        state.blockedPollers.set(name, {
          resolve: (task: PendingTask | null) => {
            clearTimeout(timeoutId);
            state.blockedPollers.delete(name);
            if (task) {
              const response: PollTaskResponse = {
                task: {
                  bead_id: task.bead_id,
                  assigned_at: task.assigned_at,
                },
              };
              resolve(jsonResponse(response));
            } else {
              const response: PollTaskResponse = {
                task: null,
                timeout: true,
              };
              resolve(jsonResponse(response));
            }
          },
          timeout_id: timeoutId,
        });
      });
    }
  );

  // ─── ack_task (polling system) ───────────────────────────────────────
  (server.tool as Function)(
    'ack_task',
    'Acknowledge receipt of a task before execution',
    {
      name: z.string().min(1, 'Worker name is required').describe('The worker name'),
      bead_id: z.string().describe('The bead ID being acknowledged'),
    },
    async ({ name, bead_id }: { name: string; bead_id: string }) => {
      // Validate worker name format
      const nameError = validateWorkerName(name);
      if (nameError) {
        const response: AckTaskResponse = {
          success: false,
          error: nameError,
        };
        return jsonResponse(response);
      }

      const worker = state.workers.get(name);

      if (!worker) {
        const response: AckTaskResponse = {
          success: false,
          error: `Unknown worker: ${name}`,
        };
        return jsonResponse(response);
      }

      // Verify the task matches what was assigned
      const pending = state.pendingTasks.get(name);
      if (!pending || pending.bead_id !== bead_id) {
        const response: AckTaskResponse = {
          success: false,
          error: `Task mismatch: expected ${pending?.bead_id ?? 'none'}, got ${bead_id}`,
        };
        return jsonResponse(response);
      }

      // Transition worker to executing state
      worker.status = 'executing';
      worker.last_activity = Date.now();
      worker.current_task = bead_id;
      worker.task_started_at = Date.now();

      // Remove from pending (now executing)
      state.pendingTasks.delete(name);

      // Mark bead as in_progress
      try {
        beadSetInProgress(bead_id);
      } catch (e) {
        // Rollback on failure
        worker.status = 'idle';
        worker.last_activity = Date.now();
        worker.current_task = null;
        worker.task_started_at = null;
        state.activeBeads.delete(bead_id);

        const response: AckTaskResponse = {
          success: false,
          error: `Failed to update bead status: ${e instanceof Error ? e.message : String(e)}`,
        };
        return jsonResponse(response);
      }

      const response: AckTaskResponse = {
        success: true,
        worker: name,
        bead_id,
      };
      return jsonResponse(response);
    }
  );

  // Store all tool handlers for direct invocation
  // We need to extract the handler from the registered tools
  // For simplicity, we'll recreate the core logic in callTool
  const callTool = async (
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> => {
    // Dispatch to the appropriate tool implementation
    switch (toolName) {
      case 'submit_task': {
        const bead_id = args.bead_id as string;
        const validation = validateBead(bead_id);
        if (!validation.valid) {
          return { dispatched: false, error: validation.error, bead_id };
        }
        if (state.activeBeads.has(bead_id)) {
          return { dispatched: false, error: 'Task already active or queued', bead_id };
        }
        const worker = selectWorker(state.workers);
        if (worker) {
          const blockedPoller = state.blockedPollers.get(worker.name);
          if (blockedPoller) {
            assignTaskToWorker(state, worker, bead_id);
            blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
          } else {
            assignTaskToWorker(state, worker, bead_id);
          }
          return { dispatched: true, worker: worker.name, bead_id };
        } else {
          state.activeBeads.add(bead_id);
          state.taskQueue.push(bead_id);
          return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id };
        }
      }

      case 'worker_done': {
        const bead_id = args.bead_id as string;
        state.activeBeads.delete(bead_id);
        const worker = Array.from(state.workers.values()).find(w => w.current_task === bead_id);
        if (!worker) {
          return { success: true, bead_id, warning: 'Worker not found' };
        }
        worker.status = 'idle';
        worker.last_activity = Date.now();
        worker.current_task = null;
        worker.task_started_at = null;
        processQueue(state);
        return { success: true, bead_id, worker: worker.name };
      }

      case 'get_status': {
        const workers = Array.from(state.workers.values()).map(w => ({
          name: w.name,
          status: w.status,
          current_task: w.current_task,
          idle_seconds: (w.status === 'idle' || w.status === 'polling')
            ? Math.floor((Date.now() - w.last_activity) / 1000)
            : null,
          pending_task: state.pendingTasks.get(w.name)?.bead_id ?? null,
        }));
        return {
          workers,
          queued_tasks: state.taskQueue.length,
          queue: [...state.taskQueue],
          polling_workers: state.blockedPollers.size,
          pending_workers: state.pendingTasks.size,
        };
      }

      case 'register_worker': {
        const name = args.name as string;
        // Validate worker name format
        const nameError = validateWorkerName(name);
        if (nameError) {
          return { success: false, error: nameError };
        }
        // Generate unique name (may append suffix if name already taken)
        const uniqueName = generateUniqueName(name, state.workers);
        const now = Date.now();
        state.workers.set(uniqueName, {
          name: uniqueName,
          status: 'idle',
          registered_at: now,
          last_activity: now,
          current_task: null,
          task_started_at: null,
        });
        return {
          success: true,
          worker: uniqueName,
          message: uniqueName === name ? 'Registered' : `Registered as ${uniqueName}`,
        };
      }

      case 'poll_task': {
        const name = args.name as string;
        // Validate worker name format
        const pollNameError = validateWorkerName(name);
        if (pollNameError) {
          return { error: pollNameError };
        }
        const timeout = (args.timeout_ms as number) ?? 30000;
        const worker = state.workers.get(name);
        if (!worker) {
          return { error: `Unknown worker: ${name} - call register_worker first` };
        }
        const pending = state.pendingTasks.get(name);
        if (pending) {
          return { task: { bead_id: pending.bead_id, assigned_at: pending.assigned_at } };
        }
        worker.status = 'polling';
        worker.last_activity = Date.now();
        return new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            state.blockedPollers.delete(name);
            resolve({ task: null, timeout: true });
          }, timeout);
          state.blockedPollers.set(name, {
            resolve: (task) => {
              clearTimeout(timeoutId);
              state.blockedPollers.delete(name);
              if (task) {
                resolve({ task: { bead_id: task.bead_id, assigned_at: task.assigned_at } });
              } else {
                resolve({ task: null, timeout: true });
              }
            },
            timeout_id: timeoutId,
          });
        });
      }

      case 'ack_task': {
        const name = args.name as string;
        const bead_id = args.bead_id as string;
        // Validate worker name format
        const ackNameError = validateWorkerName(name);
        if (ackNameError) {
          return { success: false, error: ackNameError };
        }
        const worker = state.workers.get(name);
        if (!worker) {
          return { success: false, error: `Unknown worker: ${name}` };
        }
        const pending = state.pendingTasks.get(name);
        if (!pending || pending.bead_id !== bead_id) {
          return { success: false, error: `Task mismatch: expected ${pending?.bead_id ?? 'none'}, got ${bead_id}` };
        }
        worker.status = 'executing';
        worker.last_activity = Date.now();
        worker.current_task = bead_id;
        worker.task_started_at = Date.now();
        state.pendingTasks.delete(name);
        try {
          beadSetInProgress(bead_id);
        } catch (e) {
          worker.status = 'idle';
          worker.current_task = null;
          worker.task_started_at = null;
          state.activeBeads.delete(bead_id);
          return { success: false, error: `Failed to update bead: ${e instanceof Error ? e.message : String(e)}` };
        }
        return { success: true, worker: name, bead_id };
      }

      case 'reset_worker': {
        const worker_name = args.worker_name as string;
        const worker = state.workers.get(worker_name);
        if (!worker) {
          return { success: false, worker: worker_name, error: `Unknown worker: ${worker_name}` };
        }
        const previousTask = worker.current_task;
        if (previousTask) state.activeBeads.delete(previousTask);
        state.pendingTasks.delete(worker_name);
        worker.status = 'idle';
        worker.last_activity = Date.now();
        worker.current_task = null;
        worker.task_started_at = null;
        processQueue(state);
        return { success: true, worker: worker_name, previous_task: previousTask };
      }

      case 'retry_task': {
        const bead_id = args.bead_id as string;
        if (state.activeBeads.has(bead_id)) {
          return { dispatched: false, error: 'Task still active - use reset_worker first', bead_id };
        }
        const validation = validateBead(bead_id);
        if (!validation.valid) {
          return { dispatched: false, error: validation.error, bead_id };
        }
        const worker = selectWorker(state.workers);
        if (worker) {
          const blockedPoller = state.blockedPollers.get(worker.name);
          if (blockedPoller) {
            assignTaskToWorker(state, worker, bead_id);
            blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
          } else {
            assignTaskToWorker(state, worker, bead_id);
          }
          return { dispatched: true, worker: worker.name, bead_id };
        } else {
          state.activeBeads.add(bead_id);
          state.taskQueue.push(bead_id);
          return { dispatched: false, queued: true, position: state.taskQueue.length, bead_id };
        }
      }

      case 'task_failed': {
        const bead_id = args.bead_id as string;
        const reason = args.reason as string;
        try {
          beadMarkBlocked(bead_id, reason);
        } catch (e) {
          return { success: false, bead_id, error: `Failed to mark blocked: ${e instanceof Error ? e.message : String(e)}` };
        }
        state.activeBeads.delete(bead_id);
        const worker = Array.from(state.workers.values()).find(w => w.current_task === bead_id);
        if (worker) {
          worker.status = 'idle';
          worker.last_activity = Date.now();
          worker.current_task = null;
          worker.task_started_at = null;
        }
        processQueue(state);
        return { success: true, bead_id, status: 'blocked', reason };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  };

  return { server, state, callTool };
}

/**
 * Create an IPC handler that processes notifications from CLI commands.
 *
 * @param state - Server state to modify
 * @param processQueueFn - Function to process the task queue
 * @param callTool - Function to call MCP tools directly
 * @returns IPC handler function
 */
function createIpcHandler(
  state: State,
  processQueueFn: () => void,
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
): (request: IpcRequest) => IpcResponse | Promise<IpcResponse> {
  return (request: IpcRequest): IpcResponse | Promise<IpcResponse> => {
    switch (request.type) {
      case 'ping':
        return { success: true, data: { status: 'running' } };

      case 'forward_tool': {
        if (!request.tool_name) {
          return { success: false, error: 'tool_name required' };
        }
        // Forward the tool call and return the result
        return callTool(request.tool_name, request.tool_args || {})
          .then((data) => ({ success: true, data }))
          .catch((e) => ({
            success: false,
            error: `Tool error: ${e instanceof Error ? e.message : String(e)}`,
          }));
      }

      case 'worker_done': {
        if (!request.bead_id) {
          return { success: false, error: 'bead_id required' };
        }

        // Remove from active set (allows resubmit if needed later)
        state.activeBeads.delete(request.bead_id);

        // Find worker with this task
        const worker = Array.from(state.workers.values()).find(
          (w) => w.current_task === request.bead_id
        );

        if (!worker) {
          return {
            success: true,
            data: { bead_id: request.bead_id, warning: 'Worker not found' },
          };
        }

        // Mark worker idle
        worker.status = 'idle';
        worker.last_activity = Date.now();
        worker.current_task = null;
        worker.task_started_at = null;

        // Process queue to dispatch waiting tasks
        processQueueFn();

        return {
          success: true,
          data: { bead_id: request.bead_id, worker: worker.name },
        };
      }

      case 'task_failed': {
        if (!request.bead_id) {
          return { success: false, error: 'bead_id required' };
        }
        if (!request.reason) {
          return { success: false, error: 'reason required' };
        }

        // Mark bead as blocked
        try {
          beadMarkBlocked(request.bead_id, request.reason);
        } catch (e) {
          return {
            success: false,
            error: `Failed to mark bead blocked: ${e instanceof Error ? e.message : String(e)}`,
          };
        }

        // Remove from active set
        state.activeBeads.delete(request.bead_id);

        // Find and free the worker
        const failedWorker = Array.from(state.workers.values()).find(
          (w) => w.current_task === request.bead_id
        );

        if (failedWorker) {
          failedWorker.status = 'idle';
          failedWorker.last_activity = Date.now();
          failedWorker.current_task = null;
          failedWorker.task_started_at = null;
        }

        // Process queue
        processQueueFn();

        return {
          success: true,
          data: {
            bead_id: request.bead_id,
            status: 'blocked',
            reason: request.reason,
          },
        };
      }

      default:
        return { success: false, error: `Unknown message type: ${request.type}` };
    }
  };
}

/**
 * Error code for socket already in use (another server running).
 */
export const EADDRINUSE = 'EADDRINUSE';

/**
 * Start the MCP server using stdio transport.
 *
 * This is the main entry point when running the server as a standalone process.
 * Claude Code will spawn this process and communicate via stdin/stdout.
 *
 * Also starts an IPC server on a Unix socket for CLI notifications.
 *
 * @throws Error with code 'EADDRINUSE' if another server is already running
 *         (caller should fall back to client mode)
 */
export async function startServer(): Promise<void> {
  const { server, state, callTool } = createClaudeBusServer();

  // Create a processQueue function that uses the state
  const processQueueFn = (): void => {
    processQueue(state);
  };

  // Start IPC server for CLI notifications and tool forwarding
  // This may throw EADDRINUSE if another server is already running
  const ipcHandler = createIpcHandler(state, processQueueFn, callTool);
  const { socketPath } = await startIpcServer(ipcHandler);
  console.error(`[claude-bus] IPC server listening on ${socketPath}`);

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Start as a client that forwards MCP calls to the real server via IPC.
 *
 * Used when another claude-bus instance is already running for this codebase.
 * Creates an MCP server that proxies all tool calls to the real server.
 */
export async function startClientMode(): Promise<void> {
  const server = new McpServer({
    name: 'claude-bus-client',
    version: '0.1.0',
  });

  // Define tools with same schemas as server mode, forwarding via IPC
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
            error: `Failed to forward to server: ${e instanceof Error ? e.message : String(e)}`,
          });
        }
      }
    );
  }

  // Start MCP server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
