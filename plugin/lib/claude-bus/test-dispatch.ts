#!/usr/bin/env npx ts-node
/**
 * Manual test script for the dispatch module.
 *
 * This script demonstrates the dispatch functionality by:
 * 1. Finding the first worker pane (z.ai* pattern)
 * 2. Or using a pane ID provided as an argument
 * 3. Dispatching a test echo command to that pane
 *
 * Usage:
 *   npx ts-node test-dispatch.ts           # Auto-find first z.ai* pane
 *   npx ts-node test-dispatch.ts %5        # Use specific pane ID
 *   npx ts-node test-dispatch.ts z.ai1     # Use pane by title (TODO: not yet supported)
 *
 * Prerequisites:
 *   - tmux must be running with at least one worker pane (z.ai*)
 *   - Run from plugin/lib/claude-bus directory
 */

import {
  verifyPaneExists,
  dispatchToWorker,
  findFirstWorkerPane,
  DEFAULT_WORKER_PATTERN,
} from './dispatch.js';

function main(): void {
  const arg = process.argv[2];

  console.log('Claude Bus Dispatch Test');
  console.log('========================\n');

  let paneId: string;
  let paneTitle: string | undefined;

  if (arg) {
    // User provided a pane ID
    paneId = arg;
    console.log(`Using provided pane ID: ${paneId}`);
  } else {
    // Auto-discover first worker pane
    console.log(`Searching for worker panes matching pattern: ${DEFAULT_WORKER_PATTERN}`);

    const worker = findFirstWorkerPane();
    if (!worker) {
      console.error('\nNo worker panes found!');
      console.error('Make sure tmux is running with panes named z.ai1, z.ai2, etc.');
      console.error('\nTo set pane titles in tmux:');
      console.error('  tmux select-pane -T "z.ai1"');
      process.exit(1);
    }

    paneId = worker.paneId;
    paneTitle = worker.paneTitle;
    console.log(`Found worker: ${paneTitle} (${paneId})`);
  }

  // Verify pane exists
  console.log(`\nVerifying pane ${paneId} exists...`);
  if (!verifyPaneExists(paneId)) {
    console.error(`Pane ${paneId} does not exist!`);
    process.exit(1);
  }
  console.log('Pane verified.');

  // Dispatch test command
  const testCommand = 'echo "test from claude-bus"';
  console.log(`\nDispatching command: ${testCommand}`);

  try {
    dispatchToWorker(paneId, testCommand);
    console.log('Command dispatched successfully!');
    console.log(`\nCheck the tmux pane ${paneTitle || paneId} to see the output.`);
  } catch (error) {
    console.error('Dispatch failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
