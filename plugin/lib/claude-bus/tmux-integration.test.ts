/**
 * Integration test for tmux worker discovery.
 *
 * This test runs against a real tmux session to verify discovery works.
 * It will be skipped if tmux is not available.
 */

import { execSync } from 'child_process';
import { discoverAllWorkers, discoverWorkers, getWorkerPattern, Worker } from './tmux';

// Check if tmux is available
function isTmuxAvailable(): boolean {
  try {
    execSync('tmux list-panes -a', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const describeTmux = isTmuxAvailable() ? describe : describe.skip;

describeTmux('tmux integration', () => {
  it('discovers workers from live tmux session', () => {
    const workers = discoverAllWorkers();

    // Should return a Map (even if empty)
    expect(workers).toBeInstanceOf(Map);

    // Log results for manual inspection
    console.log(`\nDiscovered ${workers.size} worker(s)`);
    for (const [name, worker] of workers) {
      console.log(`  - ${name}: ${worker.pane_id}, status=${worker.status}`);
    }
  });

  it('updates existing worker map incrementally', () => {
    const workers = new Map<string, Worker>();

    // First discovery
    discoverWorkers(workers);
    const count1 = workers.size;

    // Second discovery should not duplicate
    discoverWorkers(workers);
    const count2 = workers.size;

    expect(count2).toBe(count1);
  });

  it('worker pattern is configurable via env var', () => {
    // Default pattern
    const defaultPattern = getWorkerPattern();
    expect(defaultPattern.source).toBe('^z\\.ai');

    // Save original
    const original = process.env.CLAUDE_BUS_WORKER_PATTERN;

    try {
      // Set custom pattern
      process.env.CLAUDE_BUS_WORKER_PATTERN = '^custom\\.';
      const customPattern = getWorkerPattern();
      expect(customPattern.source).toBe('^custom\\.');
    } finally {
      // Restore original
      if (original === undefined) {
        delete process.env.CLAUDE_BUS_WORKER_PATTERN;
      } else {
        process.env.CLAUDE_BUS_WORKER_PATTERN = original;
      }
    }
  });

  it('handles stale worker removal', () => {
    const workers = new Map<string, Worker>();

    // Simulate an existing worker with a non-existent pane
    workers.set('fake-worker', {
      pane_id: '%999',
      pane_title: 'fake-worker',
      status: 'busy',
      available_since: null,
      busy_since: Date.now(),
      current_task: 'bd-test123',
    });

    // Discovery should remove the fake worker
    discoverWorkers(workers);

    expect(workers.has('fake-worker')).toBe(false);
  });
});

describe('getWorkerPattern', () => {
  it('returns default pattern when env var not set', () => {
    const original = process.env.CLAUDE_BUS_WORKER_PATTERN;
    delete process.env.CLAUDE_BUS_WORKER_PATTERN;

    try {
      const pattern = getWorkerPattern();
      expect(pattern.source).toBe('^z\\.ai');
      expect(pattern.test('z.ai1')).toBe(true);
      expect(pattern.test('z.ai2')).toBe(true);
      expect(pattern.test('orchestrator')).toBe(false);
    } finally {
      if (original !== undefined) {
        process.env.CLAUDE_BUS_WORKER_PATTERN = original;
      }
    }
  });
});
