/**
 * Claude Bus Type Definitions
 *
 * Core types for the MCP server state management.
 * Worker interface is re-exported from selection.ts for convenience.
 *
 * @module claude-bus/types
 */

import type { Worker, WorkerStatus as WorkerStatusType } from './selection.js';

// Re-export Worker, types, and helper functions for convenience
export type { Worker, WorkerStatus as WorkerStatusType, LegacyWorkerStatus } from './selection.js';
export { isWorkerAvailable, isWorkerBusy, isPollingWorker, selectWorker } from './selection.js';

// Re-export PollingWorkerStatus from selection.ts (canonical definition)
export type { PollingWorkerStatus } from './selection.js';

// ─── Polling System Types ────────────────────────────────────────────────────

/**
 * A task pending pickup by a worker.
 * Assigned by submit_task, picked up via poll_task.
 */
export interface PendingTask {
  bead_id: string;
  assigned_at: number;
}

/**
 * A worker blocked waiting for a task via poll_task.
 * Contains the Promise resolver to unblock when task arrives.
 */
export interface BlockedPoller {
  resolve: (task: PendingTask | null) => void;
  timeout_id: ReturnType<typeof setTimeout>;
}

/**
 * Response for register_worker tool
 */
export interface RegisterWorkerResponse {
  success: boolean;
  worker: string;
  message: string;
}

/**
 * Response for poll_task tool
 */
export interface PollTaskResponse {
  task?: {
    bead_id: string;
    assigned_at: number;
  } | null;
  timeout?: boolean;
  error?: string;
}

/**
 * Response for ack_task tool
 */
export interface AckTaskResponse {
  success: boolean;
  worker?: string;
  bead_id?: string;
  error?: string;
}

/**
 * Claude Bus server state.
 *
 * Tracks worker availability and a lightweight queue of bead IDs.
 * Task details live in beads (.beads/), not in MCP server state.
 */
export interface State {
  /** Map of pane_title/worker_name to Worker state */
  workers: Map<string, Worker>;
  /** Queue of bead IDs waiting for available worker (legacy) */
  taskQueue: string[];
  /** Set of bead IDs currently dispatched or queued (for dedup) */
  activeBeads: Set<string>;
  /** Map of worker_name to pending task (polling system) */
  pendingTasks: Map<string, PendingTask>;
  /** Map of worker_name to blocked poller waiting for task */
  blockedPollers: Map<string, BlockedPoller>;
}

/**
 * Create a new empty state.
 *
 * @returns Fresh State with empty collections
 */
export function createState(): State {
  return {
    workers: new Map(),
    taskQueue: [],
    activeBeads: new Set(),
    pendingTasks: new Map(),
    blockedPollers: new Map(),
  };
}

/**
 * Tool response for submit_task
 */
export interface SubmitTaskResponse {
  dispatched: boolean;
  worker?: string;
  bead_id: string;
  queued?: boolean;
  position?: number;
  error?: string;
}

/**
 * Tool response for worker_done
 */
export interface WorkerDoneResponse {
  success: boolean;
  bead_id: string;
  worker?: string;
  warning?: string;
}

/**
 * Worker status info for get_status response.
 * Supports both legacy and polling worker states.
 */
export interface WorkerStatusInfo {
  name: string;
  status: WorkerStatusType;
  current_task: string | null;
  idle_seconds: number | null;
  /** True if worker was discovered via tmux, false if self-registered */
  source?: 'tmux' | 'polling';
  /** For pending workers, the assigned task they haven't acked yet */
  pending_task?: string | null;
}

/**
 * Tool response for get_status
 */
export interface GetStatusResponse {
  workers: WorkerStatusInfo[];
  queued_tasks: number;
  queue: string[];
  /** Count of workers actively polling (blocked waiting for tasks) */
  polling_workers?: number;
  /** Count of workers with pending tasks (assigned but not acked) */
  pending_workers?: number;
}

/**
 * Tool response for reset_worker
 */
export interface ResetWorkerResponse {
  success: boolean;
  worker: string;
  previous_task?: string | null;
  error?: string;
}

/**
 * Tool response for retry_task
 */
export interface RetryTaskResponse {
  dispatched: boolean;
  worker?: string;
  bead_id: string;
  queued?: boolean;
  position?: number;
  error?: string;
}

/**
 * Tool response for task_failed
 */
export interface TaskFailedResponse {
  success: boolean;
  bead_id: string;
  status: 'blocked';
  reason: string;
}
