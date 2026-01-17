/**
 * LRU Worker Selection for Claude Bus
 *
 * Selects the worker that has been available longest (oldest available_since).
 * This ensures fair distribution and prevents worker starvation.
 */

export interface Worker {
  pane_id: string              // e.g., "%4"
  pane_title: string           // e.g., "z.ai1"
  status: 'available' | 'busy'
  available_since: number | null
  busy_since: number | null    // timestamp when marked busy (for timeout warnings)
  current_task: string | null  // bead_id if busy
}

/**
 * Select the least-recently-used available worker.
 *
 * @param workers - Map of worker name to Worker state
 * @returns The worker available longest, or null if none available
 */
export function selectWorker(workers: Map<string, Worker>): Worker | null {
  return Array.from(workers.values())
    .filter(w => w.status === 'available')
    .sort((a, b) => a.available_since! - b.available_since!)  // oldest first
    .at(0) ?? null
}
