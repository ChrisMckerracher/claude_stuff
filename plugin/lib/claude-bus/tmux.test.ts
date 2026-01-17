/**
 * Unit tests for tmux worker discovery.
 */

import { parseTmuxOutput, Worker } from './tmux';

describe('parseTmuxOutput', () => {
  it('parses standard pane output', () => {
    const output = '%1|orchestrator\n%2|z.ai1\n%3|z.ai2';
    const result = parseTmuxOutput(output);

    expect(result).toEqual([
      { pane_id: '%1', pane_title: 'orchestrator' },
      { pane_id: '%2', pane_title: 'z.ai1' },
      { pane_id: '%3', pane_title: 'z.ai2' },
    ]);
  });

  it('handles pane titles with pipes', () => {
    // Pane title could contain | characters
    const output = '%1|title|with|pipes';
    const result = parseTmuxOutput(output);

    expect(result).toEqual([{ pane_id: '%1', pane_title: 'title|with|pipes' }]);
  });

  it('handles empty output', () => {
    const result = parseTmuxOutput('');
    expect(result).toEqual([]);
  });

  it('handles single pane', () => {
    const output = '%42|my-pane';
    const result = parseTmuxOutput(output);

    expect(result).toEqual([{ pane_id: '%42', pane_title: 'my-pane' }]);
  });

  it('skips malformed lines without pipe', () => {
    const output = '%1|good\nmalformed\n%2|also-good';
    const result = parseTmuxOutput(output);

    expect(result).toEqual([
      { pane_id: '%1', pane_title: 'good' },
      { pane_id: '%2', pane_title: 'also-good' },
    ]);
  });

  it('handles trailing newline', () => {
    const output = '%1|pane1\n%2|pane2\n';
    const result = parseTmuxOutput(output);

    expect(result).toEqual([
      { pane_id: '%1', pane_title: 'pane1' },
      { pane_id: '%2', pane_title: 'pane2' },
    ]);
  });
});

describe('Worker interface', () => {
  it('can create an available worker', () => {
    const worker: Worker = {
      pane_id: '%4',
      pane_title: 'z.ai1',
      status: 'available',
      available_since: Date.now(),
      busy_since: null,
      current_task: null,
    };

    expect(worker.status).toBe('available');
    expect(worker.current_task).toBeNull();
    expect(worker.available_since).not.toBeNull();
  });

  it('can create a busy worker', () => {
    const worker: Worker = {
      pane_id: '%5',
      pane_title: 'z.ai2',
      status: 'busy',
      available_since: null,
      busy_since: Date.now(),
      current_task: 'bd-a1b2',
    };

    expect(worker.status).toBe('busy');
    expect(worker.current_task).toBe('bd-a1b2');
    expect(worker.busy_since).not.toBeNull();
  });
});

// Note: discoverWorkers() is difficult to unit test because it calls execSync
// with tmux commands. Integration testing is done via test-discovery.ts script.
