/**
 * Claude Bus MCP Server
 *
 * An MCP server that enables multiple Claude Code instances in tmux to
 * coordinate work. One instance (orchestrator) creates tasks, and idle
 * instances (workers) are dispatched to execute them.
 *
 * This implementation integrates with:
 * - beads CLI for task tracking
 * - tmux for worker discovery
 * - LRU selection for fair work distribution
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
} from './types.js';
import { createState } from './types.js';
import { discoverWorkers } from './tmux.js';
import { validateBead, beadSetInProgress, beadMarkBlocked } from './beads.js';
import { selectWorker } from './selection.js';
import { dispatchToWorker, verifyPaneExists } from './dispatch.js';
import { startIpcServer, type IpcRequest, type IpcResponse } from './ipc.js';

// Helper to create a JSON text response
function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/**
 * Internal helper to dispatch a task to a specific worker.
 *
 * Updates worker state, marks bead as in_progress, and sends the
 * /code command to the worker pane via tmux.
 *
 * @param state - Server state
 * @param worker - Worker to dispatch to
 * @param beadId - Bead ID to dispatch
 * @throws Error if dispatch fails (worker state is rolled back)
 */
function dispatchTaskToWorker(state: State, worker: Worker, beadId: string): void {
  // Verify pane still exists before dispatch
  if (!verifyPaneExists(worker.pane_id)) {
    state.workers.delete(worker.pane_title);
    throw new Error(`Worker pane ${worker.pane_title} no longer exists`);
  }

  // Track active bead (dedup) - before dispatch so we don't lose track on failure
  state.activeBeads.add(beadId);

  // Mark bead as in_progress BEFORE dispatch (prevents race condition)
  // If dispatch fails, bead stays in_progress but can be retried
  try {
    beadSetInProgress(beadId);
  } catch (e) {
    state.activeBeads.delete(beadId);
    throw new Error(`Failed to update bead status: ${e}`);
  }

  // Update worker state
  worker.status = 'busy';
  worker.available_since = null;
  worker.busy_since = Date.now();
  worker.current_task = beadId;

  try {
    // Dispatch using existing /code skill
    // Worker's /code will handle: worktree navigation, TDD, human gates, task-complete
    dispatchToWorker(worker.pane_id, `/code ${beadId}`);
  } catch (e) {
    // Rollback worker state on dispatch failure
    // Note: bead stays in_progress - orchestrator can retry_task() to reassign
    state.activeBeads.delete(beadId);
    worker.status = 'available';
    worker.available_since = Date.now();
    worker.busy_since = null;
    worker.current_task = null;
    throw e;
  }
}

/**
 * Process the task queue, dispatching waiting tasks to available workers.
 *
 * Called after a worker becomes available to potentially dispatch
 * queued tasks.
 *
 * @param state - Server state
 */
function processQueue(state: State): void {
  // Discover new workers that may have appeared
  discoverWorkers(state.workers);

  while (state.taskQueue.length > 0) {
    const worker = selectWorker(state.workers);
    if (!worker) break;

    const beadId = state.taskQueue.shift()!;
    try {
      dispatchTaskToWorker(state, worker, beadId);
    } catch (e) {
      // Task dispatch failed - remove from activeBeads so it can be retried
      // Note: beadId was already removed from taskQueue
      console.warn(`Failed to dispatch queued task ${beadId}: ${e}`);
      state.activeBeads.delete(beadId);
      // Don't re-queue automatically - let orchestrator handle retry
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
 * - reset_worker(worker_name) - Force a stuck worker back to available
 * - retry_task(bead_id) - Re-queue an in_progress task
 * - task_failed(bead_id, reason) - Mark task blocked, free worker
 *
 * @returns Object containing the configured McpServer instance and state
 */
export function createClaudeBusServer(): { server: McpServer; state: State } {
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

      // Refresh worker list
      discoverWorkers(state.workers);

      // Select LRU available worker
      const worker = selectWorker(state.workers);

      if (worker) {
        try {
          dispatchTaskToWorker(state, worker, bead_id);
          const response: SubmitTaskResponse = {
            dispatched: true,
            worker: worker.pane_title,
            bead_id,
          };
          return jsonResponse(response);
        } catch (e) {
          const response: SubmitTaskResponse = {
            dispatched: false,
            error: `Dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
            bead_id,
          };
          return jsonResponse(response);
        }
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

      // Mark worker available (bead already closed by worker)
      worker.status = 'available';
      worker.available_since = Date.now();
      worker.busy_since = null;
      worker.current_task = null;

      // Process queue to dispatch waiting tasks
      processQueue(state);

      const response: WorkerDoneResponse = {
        success: true,
        bead_id,
        worker: worker.pane_title,
      };
      return jsonResponse(response);
    }
  );

  // ─── get_status ───────────────────────────────────────────────────────
  (server.tool as Function)(
    'get_status',
    'Get the current status of all workers and the task queue',
    async () => {
      // Refresh worker state before reporting
      discoverWorkers(state.workers);

      const response: GetStatusResponse = {
        workers: Array.from(state.workers.values()).map((w) => ({
          name: w.pane_title,
          status: w.status,
          current_task: w.current_task,
          idle_seconds: w.available_since
            ? Math.floor((Date.now() - w.available_since) / 1000)
            : null,
        })),
        queued_tasks: state.taskQueue.length,
        queue: [...state.taskQueue],
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

      // Mark worker available
      worker.status = 'available';
      worker.available_since = Date.now();
      worker.busy_since = null;
      worker.current_task = null;

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

      // Refresh worker list
      discoverWorkers(state.workers);

      // Select LRU available worker
      const worker = selectWorker(state.workers);

      if (worker) {
        try {
          dispatchTaskToWorker(state, worker, bead_id);
          const response: RetryTaskResponse = {
            dispatched: true,
            worker: worker.pane_title,
            bead_id,
          };
          return jsonResponse(response);
        } catch (e) {
          const response: RetryTaskResponse = {
            dispatched: false,
            error: `Dispatch failed: ${e instanceof Error ? e.message : String(e)}`,
            bead_id,
          };
          return jsonResponse(response);
        }
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
        worker.status = 'available';
        worker.available_since = Date.now();
        worker.busy_since = null;
        worker.current_task = null;
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

  return { server, state };
}

/**
 * Create an IPC handler that processes notifications from CLI commands.
 *
 * @param state - Server state to modify
 * @param processQueueFn - Function to process the task queue
 * @returns IPC handler function
 */
function createIpcHandler(
  state: State,
  processQueueFn: () => void
): (request: IpcRequest) => IpcResponse {
  return (request: IpcRequest): IpcResponse => {
    switch (request.type) {
      case 'ping':
        return { success: true, data: { status: 'running' } };

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

        // Mark worker available (bead already closed by worker)
        worker.status = 'available';
        worker.available_since = Date.now();
        worker.busy_since = null;
        worker.current_task = null;

        // Process queue to dispatch waiting tasks
        processQueueFn();

        return {
          success: true,
          data: { bead_id: request.bead_id, worker: worker.pane_title },
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
          failedWorker.status = 'available';
          failedWorker.available_since = Date.now();
          failedWorker.busy_since = null;
          failedWorker.current_task = null;
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
 * Start the MCP server using stdio transport.
 *
 * This is the main entry point when running the server as a standalone process.
 * Claude Code will spawn this process and communicate via stdin/stdout.
 *
 * Also starts an IPC server on a Unix socket for CLI notifications.
 */
export async function startServer(): Promise<void> {
  const { server, state } = createClaudeBusServer();

  // Create a processQueue function that uses the state
  const processQueueFn = (): void => {
    discoverWorkers(state.workers);
    while (state.taskQueue.length > 0) {
      const worker = selectWorker(state.workers);
      if (!worker) break;

      const beadId = state.taskQueue.shift()!;
      try {
        // Inline dispatch logic (simplified - just mark busy and dispatch)
        if (!verifyPaneExists(worker.pane_id)) {
          state.workers.delete(worker.pane_title);
          state.activeBeads.delete(beadId);
          continue;
        }
        state.activeBeads.add(beadId);
        beadSetInProgress(beadId);
        worker.status = 'busy';
        worker.available_since = null;
        worker.busy_since = Date.now();
        worker.current_task = beadId;
        dispatchToWorker(worker.pane_id, `/code ${beadId}`);
      } catch (e) {
        console.warn(`Failed to dispatch queued task ${beadId}: ${e}`);
        state.activeBeads.delete(beadId);
      }
    }
  };

  // Start IPC server for CLI notifications
  const ipcHandler = createIpcHandler(state, processQueueFn);
  const { socketPath } = startIpcServer(ipcHandler);
  console.error(`[claude-bus] IPC server listening on ${socketPath}`);

  // Start MCP server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
