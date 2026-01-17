/**
 * LRU Worker Selection for Claude Bus
 *
 * Selects the worker that has been available longest (oldest available_since).
 * This ensures fair distribution and prevents worker starvation.
 *
 * Supports two worker types:
 * - Legacy (tmux-discovered): status is 'available' | 'busy'
 * - Polling (self-registered): status is 'idle' | 'polling' | 'pending' | 'executing'
 */

/**
 * Legacy worker status for tmux-discovered workers.
 */
export type LegacyWorkerStatus = 'available' | 'busy';

/**
 * Extended worker status for polling-based dispatch.
 * - idle: Registered but not yet polling
 * - polling: Blocked waiting for a task via poll_task
 * - pending: Task assigned, waiting for worker to ack
 * - executing: Task acknowledged and being executed
 */
export type PollingWorkerStatus = 'idle' | 'polling' | 'pending' | 'executing';

/**
 * Combined worker status supporting both legacy and polling modes.
 */
export type WorkerStatus = LegacyWorkerStatus | PollingWorkerStatus;

export interface Worker {
  pane_id: string              // e.g., "%4"
  pane_title: string           // e.g., "z.ai1"
  status: WorkerStatus
  available_since: number | null
  busy_since: number | null    // timestamp when marked busy (for timeout warnings)
  current_task: string | null  // bead_id if busy/executing
  /** Timestamp when worker self-registered (polling workers only) */
  registered_at?: number
  /** Timestamp when current task was started (polling workers only) */
  task_started_at?: number | null
}

/**
 * Check if a worker is available for task assignment.
 * Supports both legacy (tmux-discovered) and polling (self-registered) states.
 *
 * Available states:
 * - 'available' (legacy tmux)
 * - 'idle' (polling, just registered)
 * - 'polling' (polling, waiting for task)
 */
export function isWorkerAvailable(worker: Worker): boolean {
  return worker.status === 'available' ||
         worker.status === 'idle' ||
         worker.status === 'polling';
}

/**
 * Check if a worker is busy (executing a task).
 * Supports both legacy and polling worker states.
 */
export function isWorkerBusy(worker: Worker): boolean {
  return worker.status === 'busy' ||
         worker.status === 'executing' ||
         worker.status === 'pending';
}

/**
 * Check if a worker is a polling worker (self-registered).
 */
export function isPollingWorker(worker: Worker): boolean {
  return worker.registered_at !== undefined;
}

/**
 * Get the LRU timestamp for a worker.
 * For polling workers, uses registered_at; for legacy, uses available_since.
 */
function getWorkerTimestamp(worker: Worker): number {
  if (worker.registered_at !== undefined) {
    return worker.registered_at;
  }
  return worker.available_since ?? Date.now();
}

/**
 * Select the least-recently-used available worker.
 * Supports both legacy (tmux-discovered) and polling (self-registered) states.
 *
 * Priority order:
 * 1. Polling workers actively waiting (status: 'polling') - most responsive
 * 2. Polling workers idle (status: 'idle')
 * 3. Legacy workers (status: 'available')
 *
 * Within each group, selects by LRU (oldest timestamp first).
 *
 * @param workers - Map of worker name to Worker state
 * @returns The worker available longest, or null if none available
 */
export function selectWorker(workers: Map<string, Worker>): Worker | null {
  const available = Array.from(workers.values()).filter(isWorkerAvailable);

  if (available.length === 0) {
    return null;
  }

  // Separate by type and status
  const polling = available.filter(w => w.status === 'polling');
  const idle = available.filter(w => w.status === 'idle');
  const legacy = available.filter(w => w.status === 'available');

  // Pick from highest priority non-empty group
  const pool = polling.length > 0 ? polling :
               idle.length > 0 ? idle :
               legacy;

  // Sort by timestamp (oldest first = LRU)
  return pool
    .sort((a, b) => getWorkerTimestamp(a) - getWorkerTimestamp(b))
    .at(0) ?? null;
}
