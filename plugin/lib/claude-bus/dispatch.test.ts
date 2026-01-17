/**
 * Unit tests for Claude Bus Dispatch Module
 *
 * Tests for verifyPaneExists and dispatchToWorker functions
 * that enable the MCP server to send commands to worker panes.
 */

import { execSync } from 'child_process';
import {
  verifyPaneExists,
  dispatchToWorker,
  escapeForShell,
  findFirstWorkerPane,
} from './dispatch';

// Mock execSync for unit tests
jest.mock('child_process', () => ({
  execSync: jest.fn(),
}));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

// ============================================================================
// escapeForShell() tests
// ============================================================================

describe('escapeForShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('handles simple strings without special characters', () => {
    expect(escapeForShell('hello world')).toBe("'hello world'");
  });

  test('escapes single quotes correctly', () => {
    // "it's" should become 'it'\''s'
    expect(escapeForShell("it's")).toBe("'it'\\''s'");
  });

  test('handles multiple single quotes', () => {
    expect(escapeForShell("don't can't won't")).toBe("'don'\\''t can'\\''t won'\\''t'");
  });

  test('handles empty string', () => {
    expect(escapeForShell('')).toBe("''");
  });

  test('handles string with only single quote', () => {
    expect(escapeForShell("'")).toBe("''\\'''");
  });

  test('preserves other special characters within single quotes', () => {
    // These are safe inside single quotes
    expect(escapeForShell('$var')).toBe("'$var'");
    expect(escapeForShell('`cmd`')).toBe("'`cmd`'");
    expect(escapeForShell('a && b')).toBe("'a && b'");
    expect(escapeForShell('a | b')).toBe("'a | b'");
  });
});

// ============================================================================
// verifyPaneExists() tests
// ============================================================================

describe('verifyPaneExists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns true when pane exists', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    const result = verifyPaneExists('%4');

    expect(result).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith(
      "tmux display-message -t '%4' -p ''",
      { stdio: 'pipe' }
    );
  });

  test('returns false when pane does not exist', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('can\'t find pane %99');
    });

    const result = verifyPaneExists('%99');

    expect(result).toBe(false);
  });

  test('returns false for empty pane ID', () => {
    const result = verifyPaneExists('');
    expect(result).toBe(false);
  });

  test('escapes pane ID in command', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    verifyPaneExists('%4');

    // Verify pane ID is quoted
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining("'%4'"),
      expect.any(Object)
    );
  });
});

// ============================================================================
// dispatchToWorker() tests
// ============================================================================

describe('dispatchToWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('dispatches command to existing pane', () => {
    // First call: verify pane exists
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    // Second call: send-keys
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    dispatchToWorker('%4', 'echo hello');

    expect(mockExecSync).toHaveBeenCalledTimes(2);
    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      "tmux send-keys -t '%4' 'echo hello' Enter",
      { stdio: 'pipe' }
    );
  });

  test('throws error when pane does not exist', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('can\'t find pane %99');
    });

    expect(() => dispatchToWorker('%99', 'echo hello')).toThrow(
      'Pane %99 does not exist'
    );
  });

  test('throws error for empty pane ID', () => {
    expect(() => dispatchToWorker('', 'echo hello')).toThrow(
      'Pane ID is required'
    );
  });

  test('throws error for empty command', () => {
    expect(() => dispatchToWorker('%4', '')).toThrow(
      'Command is required'
    );
  });

  test('escapes single quotes in command', () => {
    // First call: verify pane exists
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    // Second call: send-keys
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    dispatchToWorker('%4', "echo 'hello'");

    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      "tmux send-keys -t '%4' 'echo '\\''hello'\\''' Enter",
      { stdio: 'pipe' }
    );
  });

  test('handles complex commands with special characters', () => {
    // First call: verify pane exists
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    // Second call: send-keys
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    dispatchToWorker('%4', '/code bd-abc123');

    expect(mockExecSync).toHaveBeenNthCalledWith(
      2,
      "tmux send-keys -t '%4' '/code bd-abc123' Enter",
      { stdio: 'pipe' }
    );
  });

  test('propagates tmux send-keys errors', () => {
    // First call: verify pane exists (success)
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    // Second call: send-keys fails
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('tmux: send-keys failed');
    });

    expect(() => dispatchToWorker('%4', 'echo hello')).toThrow(
      'Failed to dispatch command to pane %4'
    );
  });
});

// ============================================================================
// findFirstWorkerPane() tests
// ============================================================================

describe('findFirstWorkerPane', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('finds first worker pane matching default pattern', () => {
    // When encoding: 'utf8' is passed, execSync returns a string
    mockExecSync.mockReturnValueOnce(
      '%1|file-manager\n%2|orchestrator\n%3|z.ai1\n%4|z.ai2\n'
    );

    const result = findFirstWorkerPane();

    expect(result).toEqual({ paneId: '%3', paneTitle: 'z.ai1' });
  });

  test('returns null when no worker panes found', () => {
    mockExecSync.mockReturnValueOnce(
      '%1|file-manager\n%2|orchestrator\n'
    );

    const result = findFirstWorkerPane();

    expect(result).toBeNull();
  });

  test('handles custom pattern', () => {
    mockExecSync.mockReturnValueOnce(
      '%1|worker1\n%2|worker2\n%3|other\n'
    );

    const result = findFirstWorkerPane(/^worker/);

    expect(result).toEqual({ paneId: '%1', paneTitle: 'worker1' });
  });

  test('handles empty tmux output', () => {
    mockExecSync.mockReturnValueOnce('');

    const result = findFirstWorkerPane();

    expect(result).toBeNull();
  });

  test('handles pane titles containing pipe characters', () => {
    // Pane ID is always %N format, so first | is safe delimiter
    mockExecSync.mockReturnValueOnce(
      '%1|z.ai1|with|pipes\n'
    );

    const result = findFirstWorkerPane();

    expect(result).toEqual({ paneId: '%1', paneTitle: 'z.ai1|with|pipes' });
  });

  test('handles tmux error gracefully', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('server not found');
    });

    const result = findFirstWorkerPane();

    expect(result).toBeNull();
  });
});

// ============================================================================
// Integration-style tests (still mocked, but testing workflow)
// ============================================================================

describe('dispatch workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('typical dispatch workflow: find worker and dispatch', () => {
    // First call: list-panes to find worker (returns string with encoding: 'utf8')
    mockExecSync.mockReturnValueOnce(
      '%1|file-manager\n%2|orchestrator\n%3|z.ai1\n%4|z.ai2\n'
    );
    // Second call: verify pane exists
    mockExecSync.mockReturnValueOnce(Buffer.from(''));
    // Third call: send-keys
    mockExecSync.mockReturnValueOnce(Buffer.from(''));

    const worker = findFirstWorkerPane();
    expect(worker).not.toBeNull();

    dispatchToWorker(worker!.paneId, '/code bd-task123');

    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });
});
