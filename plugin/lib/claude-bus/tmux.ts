/**
 * Tmux Worker Discovery for Claude Code Bus
 *
 * Discovers worker panes in tmux by scanning pane titles and matching
 * against a configurable pattern. Workers are Claude Code instances
 * that can receive task dispatches.
 *
 * This is the LEGACY discovery mechanism using tmux pane scanning.
 * Workers discovered this way use 'available'/'busy' states for
 * backward compatibility with the original dispatch system.
 *
 * The new polling system uses self-registered workers with extended
 * states: 'idle' | 'polling' | 'pending' | 'executing'
 *
 * See: docs/plans/architect/claude-code-bus.md
 * See: docs/plans/architect/claude-bus-polling.md
 */

import { execSync } from 'child_process';
import type { Worker } from './selection.js';

// Re-export Worker for backward compatibility with existing imports
export type { Worker } from './selection.js';

/**
 * Default pattern for matching worker pane titles.
 * Matches panes like z.ai1, z.ai2, z.ai-foo, etc.
 */
const DEFAULT_WORKER_PATTERN = '^z\\.ai';

/**
 * Get the worker pattern from environment or use default.
 *
 * @returns RegExp for matching worker pane titles
 */
export function getWorkerPattern(): RegExp {
  const pattern = process.env.CLAUDE_BUS_WORKER_PATTERN ?? DEFAULT_WORKER_PATTERN;
  return new RegExp(pattern);
}

/**
 * Parse tmux list-panes output into pane entries.
 *
 * The format is "#{pane_id}|#{pane_title}" where:
 * - pane_id is always %N format (e.g., %4)
 * - pane_title can contain any characters including |
 *
 * We use the first | as the delimiter since pane_id never contains |.
 *
 * @param output - Raw output from tmux list-panes command
 * @returns Array of { pane_id, pane_title } objects
 */
export function parseTmuxOutput(output: string): Array<{ pane_id: string; pane_title: string }> {
  const lines = output.trim().split('\n');
  const entries: Array<{ pane_id: string; pane_title: string }> = [];

  for (const line of lines) {
    if (!line) continue;

    // pane_id is always %N format, so first | is safe delimiter
    const pipeIdx = line.indexOf('|');
    if (pipeIdx === -1) continue;

    const pane_id = line.slice(0, pipeIdx);
    const pane_title = line.slice(pipeIdx + 1);

    entries.push({ pane_id, pane_title });
  }

  return entries;
}

/**
 * Discover worker panes in tmux and update the worker map.
 *
 * This is the LEGACY discovery mechanism. Workers discovered via tmux
 * are initialized with status 'available' for backward compatibility
 * with the original dispatch system. The new polling-based system uses
 * self-registered workers with extended states.
 *
 * This function:
 * 1. Runs `tmux list-panes -a -F "#{pane_id}|#{pane_title}"`
 * 2. Parses output and matches titles against the worker pattern
 * 3. Adds new workers as 'available' (legacy mode)
 * 4. Removes stale workers (pane no longer exists)
 * 5. Logs warning if a stale worker had a current_task
 *
 * @param existingWorkers - Current worker map to update
 * @returns Updated worker map (same reference, mutated in place for convenience, but also returned)
 *
 * @example
 * const workers = new Map<string, Worker>();
 * discoverWorkers(workers);
 * console.log(`Found ${workers.size} workers`);
 */
export function discoverWorkers(existingWorkers: Map<string, Worker>): Map<string, Worker> {
  const workerPattern = getWorkerPattern();

  // Get current panes from tmux
  let output: string;
  try {
    output = execSync('tmux list-panes -a -F "#{pane_id}|#{pane_title}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    // tmux not running or not available
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: Could not list tmux panes: ${message}`);
    return existingWorkers;
  }

  const panes = parseTmuxOutput(output);
  const currentPaneTitles = new Set<string>();

  // Process current panes
  for (const { pane_id, pane_title } of panes) {
    currentPaneTitles.add(pane_title);

    // Check if this pane matches the worker pattern
    if (!workerPattern.test(pane_title)) {
      continue;
    }

    // Check if we already know about this worker
    const existingWorker = existingWorkers.get(pane_title);

    if (existingWorker) {
      // Update pane_id in case it changed (pane was recreated)
      existingWorker.pane_id = pane_id;
    } else {
      // New worker discovered - initialize with 'available' status (legacy mode).
      // This ensures backward compatibility with the original dispatch system.
      // Self-registered workers in the new polling system use extended states:
      // 'idle' | 'polling' | 'pending' | 'executing'
      const newWorker: Worker = {
        pane_id,
        pane_title,
        status: 'available',  // Legacy status for tmux-discovered workers
        available_since: Date.now(),
        busy_since: null,
        current_task: null,
      };
      existingWorkers.set(pane_title, newWorker);
    }
  }

  // Remove stale workers (pane no longer exists)
  for (const [pane_title, worker] of existingWorkers) {
    if (!currentPaneTitles.has(pane_title)) {
      if (worker.current_task) {
        console.warn(
          `Warning: Worker ${pane_title} died with task ${worker.current_task} - task can be retried`
        );
      }
      existingWorkers.delete(pane_title);
    }
  }

  return existingWorkers;
}

/**
 * Create a fresh worker map by discovering all current workers.
 *
 * Convenience function that creates a new empty map and populates it.
 *
 * @returns New Map containing all discovered workers
 */
export function discoverAllWorkers(): Map<string, Worker> {
  return discoverWorkers(new Map<string, Worker>());
}
