/**
 * Claude Bus Dispatch Module
 *
 * Functions for dispatching commands to worker panes via tmux.
 * Part of the claude-bus MCP server for multi-instance coordination.
 *
 * See: docs/plans/architect/claude-code-bus.md
 */

import { execSync } from 'child_process';

/**
 * Default regex pattern for identifying worker panes.
 * Matches pane titles like "z.ai1", "z.ai2", etc.
 */
export const DEFAULT_WORKER_PATTERN = /^z\.ai/;

/**
 * Result from finding a worker pane.
 */
export interface WorkerPaneInfo {
  paneId: string;
  paneTitle: string;
}

/**
 * Escape a string for safe use in a shell single-quoted context.
 *
 * Single quotes in the input are escaped using the '\'' technique:
 * - End the single quote
 * - Add an escaped single quote
 * - Start a new single quote
 *
 * @param str - The string to escape
 * @returns The string wrapped in single quotes with internal quotes escaped
 *
 * @example
 * escapeForShell("hello") // "'hello'"
 * escapeForShell("it's") // "'it'\\''s'"
 */
export function escapeForShell(str: string): string {
  // Replace ' with '\'' and wrap in single quotes
  const escaped = str.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

/**
 * Verify that a tmux pane exists.
 *
 * Uses `tmux display-message -t <paneId> -p ''` which succeeds
 * silently if the pane exists and fails if it doesn't.
 *
 * @param paneId - The tmux pane ID (e.g., "%4")
 * @returns true if the pane exists, false otherwise
 *
 * @example
 * if (verifyPaneExists('%4')) {
 *   dispatchToWorker('%4', '/code bd-abc123');
 * }
 */
export function verifyPaneExists(paneId: string): boolean {
  if (!paneId) {
    return false;
  }

  try {
    execSync(`tmux display-message -t ${escapeForShell(paneId)} -p ''`, {
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Dispatch a command to a worker pane via tmux send-keys.
 *
 * This function:
 * 1. Verifies the pane exists (throws if not)
 * 2. Escapes the command for shell safety (handles single quotes)
 * 3. Sends the command to the pane with Enter key
 *
 * @param paneId - The tmux pane ID (e.g., "%4")
 * @param command - The command to send (e.g., "/code bd-abc123")
 * @throws Error if pane doesn't exist or send-keys fails
 *
 * @example
 * // Dispatch a task to a worker
 * dispatchToWorker('%4', '/code bd-abc123');
 *
 * // Send a test message
 * dispatchToWorker('%4', 'echo "test from claude-bus"');
 */
export function dispatchToWorker(paneId: string, command: string): void {
  // Validate inputs
  if (!paneId) {
    throw new Error('Pane ID is required');
  }
  if (!command) {
    throw new Error('Command is required');
  }

  // Verify pane exists before attempting dispatch
  if (!verifyPaneExists(paneId)) {
    throw new Error(`Pane ${paneId} does not exist`);
  }

  // Escape both pane ID and command for shell safety
  const escapedPaneId = escapeForShell(paneId);
  const escapedCommand = escapeForShell(command);

  try {
    execSync(`tmux send-keys -t ${escapedPaneId} ${escapedCommand} Enter`, {
      stdio: 'pipe',
    });
  } catch (error) {
    throw new Error(
      `Failed to dispatch command to pane ${paneId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Find the first worker pane matching the worker pattern.
 *
 * Scans all tmux panes and returns the first one whose title
 * matches the worker pattern (default: /^z\.ai/).
 *
 * @param pattern - Regex pattern for worker pane titles (optional)
 * @returns WorkerPaneInfo if found, null if no workers found
 *
 * @example
 * const worker = findFirstWorkerPane();
 * if (worker) {
 *   console.log(`Found worker ${worker.paneTitle} at ${worker.paneId}`);
 *   dispatchToWorker(worker.paneId, 'echo "hello"');
 * }
 */
export function findFirstWorkerPane(
  pattern: RegExp = DEFAULT_WORKER_PATTERN
): WorkerPaneInfo | null {
  try {
    const output = execSync('tmux list-panes -a -F "#{pane_id}|#{pane_title}"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    for (const line of output.trim().split('\n')) {
      if (!line) continue;

      // pane_id is always %N format, so first | is safe delimiter
      const pipeIdx = line.indexOf('|');
      if (pipeIdx === -1) continue;

      const paneId = line.slice(0, pipeIdx);
      const paneTitle = line.slice(pipeIdx + 1);

      if (pattern.test(paneTitle)) {
        return { paneId, paneTitle };
      }
    }

    return null;
  } catch {
    // tmux not running or other error
    return null;
  }
}
