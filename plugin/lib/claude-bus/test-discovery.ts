#!/usr/bin/env npx ts-node
/**
 * Test script for tmux worker discovery.
 *
 * Run with: npx ts-node plugin/lib/claude-bus/test-discovery.ts
 * Or: npm run test:discovery (if added to package.json)
 *
 * This script discovers workers in the current tmux session and prints
 * their details. Useful for verifying the discovery mechanism works.
 */

import { discoverAllWorkers, getWorkerPattern } from './tmux.js';

function formatTimestamp(ts: number | null): string {
  if (ts === null) return '-';
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

function formatIdleTime(availableSince: number | null): string {
  if (availableSince === null) return '-';
  const seconds = Math.floor((Date.now() - availableSince) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function main(): void {
  console.log('=== Tmux Worker Discovery Test ===\n');

  // Show current pattern
  const pattern = getWorkerPattern();
  console.log(`Worker pattern: ${pattern.source}`);
  console.log(`(Set CLAUDE_BUS_WORKER_PATTERN env var to customize)\n`);

  // Discover workers
  console.log('Discovering workers...\n');
  const workers = discoverAllWorkers();

  if (workers.size === 0) {
    console.log('No workers found.');
    console.log('\nPossible reasons:');
    console.log('  - tmux is not running');
    console.log('  - No panes match the worker pattern');
    console.log('  - Pane titles are not set (use: tmux select-pane -T "z.ai1")');
    return;
  }

  console.log(`Found ${workers.size} worker(s):\n`);

  // Print header
  console.log('  Pane ID   | Title       | Status    | Available Since | Idle Time');
  console.log('  ----------+-------------+-----------+-----------------+----------');

  // Print each worker
  for (const [, worker] of workers) {
    const paneId = worker.pane_id.padEnd(8);
    const title = worker.pane_title.padEnd(11);
    const status = worker.status.padEnd(9);
    const availableSince = formatTimestamp(worker.available_since).padEnd(15);
    const idleTime = formatIdleTime(worker.available_since);

    console.log(`  ${paneId} | ${title} | ${status} | ${availableSince} | ${idleTime}`);
  }

  console.log('\n=== Discovery Complete ===');
}

main();
