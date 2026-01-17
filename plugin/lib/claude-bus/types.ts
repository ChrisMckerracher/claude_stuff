/**
 * Claude Bus Type Definitions
 *
 * Core types for the MCP server state management.
 * Worker interface is re-exported from selection.ts for convenience.
 *
 * @module claude-bus/types
 */

import type { Worker } from './selection.js';

// Re-export Worker for convenience
export type { Worker } from './selection.js';

/**
 * Claude Bus server state.
 *
 * Tracks worker availability and a lightweight queue of bead IDs.
 * Task details live in beads (.beads/), not in MCP server state.
 */
export interface State {
  /** Map of pane_title to Worker state */
  workers: Map<string, Worker>;
  /** Queue of bead IDs waiting for available worker */
  taskQueue: string[];
  /** Set of bead IDs currently dispatched or queued (for dedup) */
  activeBeads: Set<string>;
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
 * Worker status info for get_status response
 */
export interface WorkerStatus {
  name: string;
  status: 'available' | 'busy';
  current_task: string | null;
  idle_seconds: number | null;
}

/**
 * Tool response for get_status
 */
export interface GetStatusResponse {
  workers: WorkerStatus[];
  queued_tasks: number;
  queue: string[];
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
