/**
 * LRU Worker Selection for Claude Bus
 *
 * Selects the worker that has been idle longest (oldest last_activity).
 * This ensures fair distribution and prevents worker starvation.
 *
 * All workers use polling-based dispatch with status:
 * - idle: Registered but not yet polling
 * - polling: Blocked waiting for a task via poll_task
 * - pending: Task assigned, waiting for worker to ack
 * - executing: Task acknowledged and being executed
 */

/**
 * Worker status for polling-based dispatch.
 * - idle: Registered but not yet polling
 * - polling: Blocked waiting for a task via poll_task
 * - pending: Task assigned, waiting for worker to ack
 * - executing: Task acknowledged and being executed
 */
export type WorkerStatus = 'idle' | 'polling' | 'pending' | 'executing';

export interface Worker {
  name: string                    // e.g., "z.ai1"
  status: WorkerStatus
  registered_at: number           // timestamp when worker self-registered
  last_activity: number           // timestamp of last state change
  current_task: string | null     // bead_id if pending/executing
  task_started_at: number | null  // timestamp when current task was started
}

/**
 * Check if a worker is available for task assignment.
 *
 * Available states:
 * - 'idle' (registered but not yet polling)
 * - 'polling' (waiting for task via poll_task)
 */
export function isWorkerAvailable(worker: Worker): boolean {
  return worker.status === 'idle' || worker.status === 'polling';
}

/**
 * Check if a worker is busy (executing a task).
 */
export function isWorkerBusy(worker: Worker): boolean {
  return worker.status === 'executing' || worker.status === 'pending';
}

/**
 * Select the least-recently-used available worker.
 *
 * Priority order:
 * 1. Workers actively waiting (status: 'polling') - most responsive
 * 2. Workers idle (status: 'idle')
 *
 * Within each group, selects by LRU (oldest last_activity first).
 *
 * @param workers - Map of worker name to Worker state
 * @returns The worker available longest, or null if none available
 */
export function selectWorker(workers: Map<string, Worker>): Worker | null {
  const available = Array.from(workers.values()).filter(isWorkerAvailable);

  if (available.length === 0) {
    return null;
  }

  // Separate by status - prefer polling workers (actively waiting)
  const polling = available.filter(w => w.status === 'polling');
  const idle = available.filter(w => w.status === 'idle');

  // Pick from highest priority non-empty group
  const pool = polling.length > 0 ? polling : idle;

  // Sort by last_activity (oldest first = LRU)
  return pool
    .sort((a, b) => a.last_activity - b.last_activity)
    .at(0) ?? null;
}
