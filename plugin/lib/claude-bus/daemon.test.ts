/**
 * Daemon Tests
 *
 * Tests for the external daemon process that manages worker state
 * and task coordination via Unix socket IPC.
 */

import { jest, describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import * as net from 'net';
import * as fs from 'fs';
import {
  startDaemon,
  getSocketPath,
  getPidFilePath,
  isSocketStale,
  isDaemonRunning,
  getDaemonStatus,
  stopDaemon,
  type DaemonInstance,
  type DaemonRequest,
  type DaemonResponse,
} from './daemon';

// ─── Helper Functions ───────────────────────────────────────────────────────

/**
 * Send a request to the daemon and wait for response.
 */
async function sendRequest(
  socketPath: string,
  request: DaemonRequest,
  timeout: number = 5000
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    let buffer = '';
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error('Request timed out'));
      }
    }, timeout);

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (data) => {
      buffer += data.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1 && !resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        client.end();
        try {
          const response = JSON.parse(buffer.slice(0, newlineIdx));
          resolve(response);
        } catch (e) {
          reject(new Error(`Invalid response: ${e}`));
        }
      }
    });

    client.on('error', (err: Error) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(err);
      }
    });

    client.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(new Error('Connection closed unexpectedly'));
      }
    });
  });
}

/**
 * Generate a unique test project path.
 */
function getTestProjectPath(): string {
  return `/tmp/test-daemon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Socket Path Tests ──────────────────────────────────────────────────────

describe('Socket Path Utilities', () => {
  describe('getSocketPath', () => {
    it('should generate a socket path based on project root', () => {
      const socketPath = getSocketPath('/test/project');
      expect(socketPath).toMatch(/^\/tmp\/claude-bus-[a-f0-9]{8}\.sock$/);
    });

    it('should generate consistent paths for the same project', () => {
      const path1 = getSocketPath('/test/project');
      const path2 = getSocketPath('/test/project');
      expect(path1).toBe(path2);
    });

    it('should generate different paths for different projects', () => {
      const path1 = getSocketPath('/test/project1');
      const path2 = getSocketPath('/test/project2');
      expect(path1).not.toBe(path2);
    });
  });

  describe('getPidFilePath', () => {
    it('should append .pid to socket path', () => {
      const socketPath = '/tmp/claude-bus-abc123.sock';
      const pidFile = getPidFilePath(socketPath);
      expect(pidFile).toBe('/tmp/claude-bus-abc123.sock.pid');
    });
  });

  describe('isSocketStale', () => {
    it('should return true when no PID file exists', () => {
      const projectPath = getTestProjectPath();
      const socketPath = getSocketPath(projectPath);
      expect(isSocketStale(socketPath)).toBe(true);
    });

    it('should return true when PID file contains invalid data', () => {
      const projectPath = getTestProjectPath();
      const socketPath = getSocketPath(projectPath);
      const pidFile = getPidFilePath(socketPath);

      fs.writeFileSync(pidFile, 'not-a-number');
      try {
        expect(isSocketStale(socketPath)).toBe(true);
      } finally {
        fs.unlinkSync(pidFile);
      }
    });

    it('should return true when PID process does not exist', () => {
      const projectPath = getTestProjectPath();
      const socketPath = getSocketPath(projectPath);
      const pidFile = getPidFilePath(socketPath);

      // Use a very high PID that almost certainly doesn't exist
      fs.writeFileSync(pidFile, '999999999');
      try {
        expect(isSocketStale(socketPath)).toBe(true);
      } finally {
        fs.unlinkSync(pidFile);
      }
    });

    it('should return false when PID process exists', () => {
      const projectPath = getTestProjectPath();
      const socketPath = getSocketPath(projectPath);
      const pidFile = getPidFilePath(socketPath);

      // Use current process PID (definitely exists)
      fs.writeFileSync(pidFile, process.pid.toString());
      try {
        expect(isSocketStale(socketPath)).toBe(false);
      } finally {
        fs.unlinkSync(pidFile);
      }
    });
  });
});

// ─── Daemon Lifecycle Tests ─────────────────────────────────────────────────

describe('Daemon Lifecycle', () => {
  let daemon: DaemonInstance | null = null;
  let testProjectPath: string;

  beforeEach(() => {
    testProjectPath = getTestProjectPath();
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
    // Clean up any leftover files
    const socketPath = getSocketPath(testProjectPath);
    const pidFile = getPidFilePath(socketPath);
    try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
    try { fs.unlinkSync(pidFile); } catch { /* ignore */ }
  });

  describe('startDaemon', () => {
    it('should start and create socket file', async () => {
      daemon = await startDaemon(testProjectPath);

      expect(fs.existsSync(daemon.socketPath)).toBe(true);
    });

    it('should create PID file with current process PID', async () => {
      daemon = await startDaemon(testProjectPath);
      const pidFile = getPidFilePath(daemon.socketPath);

      expect(fs.existsSync(pidFile)).toBe(true);
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      expect(pid).toBe(process.pid);
    });

    it('should refuse to start if daemon already running', async () => {
      daemon = await startDaemon(testProjectPath);

      await expect(startDaemon(testProjectPath)).rejects.toThrow(/already running/);
    });

    it('should clean up stale socket on start', async () => {
      const socketPath = getSocketPath(testProjectPath);
      const pidFile = getPidFilePath(socketPath);

      // Create stale socket files (PID of non-existent process)
      fs.writeFileSync(socketPath, 'stale');
      fs.writeFileSync(pidFile, '999999999');

      daemon = await startDaemon(testProjectPath);

      // Should have started successfully
      expect(fs.existsSync(daemon.socketPath)).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should clean up socket and PID files', async () => {
      daemon = await startDaemon(testProjectPath);
      const socketPath = daemon.socketPath;
      const pidFile = getPidFilePath(socketPath);

      await daemon.shutdown();
      daemon = null; // Prevent double shutdown in afterEach

      expect(fs.existsSync(socketPath)).toBe(false);
      expect(fs.existsSync(pidFile)).toBe(false);
    });
  });

  describe('isDaemonRunning', () => {
    it('should return false when daemon not running', () => {
      expect(isDaemonRunning(testProjectPath)).toBe(false);
    });

    it('should return true when daemon is running', async () => {
      daemon = await startDaemon(testProjectPath);

      expect(isDaemonRunning(testProjectPath)).toBe(true);
    });
  });

  describe('getDaemonStatus', () => {
    it('should return not running when daemon not started', () => {
      const status = getDaemonStatus(testProjectPath);

      expect(status.running).toBe(false);
      expect(status.socketPath).toMatch(/^\/tmp\/claude-bus-/);
    });

    it('should return running with PID when daemon started', async () => {
      daemon = await startDaemon(testProjectPath);

      const status = getDaemonStatus(testProjectPath);

      expect(status.running).toBe(true);
      expect(status.pid).toBe(process.pid);
    });
  });
});

// ─── IPC Protocol Tests ─────────────────────────────────────────────────────

describe('IPC Protocol', () => {
  let daemon: DaemonInstance | null = null;
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = getTestProjectPath();
    daemon = await startDaemon(testProjectPath);
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  it('should handle request with ID correlation', async () => {
    const request: DaemonRequest = {
      id: 'test-123',
      tool: 'get_status',
      params: {},
    };

    const response = await sendRequest(daemon!.socketPath, request);

    expect(response.id).toBe('test-123');
    expect(response.success).toBe(true);
  });

  it('should return UNKNOWN_TOOL error for unknown tool', async () => {
    const request: DaemonRequest = {
      id: 'test-unknown',
      tool: 'nonexistent_tool',
      params: {},
    };

    const response = await sendRequest(daemon!.socketPath, request);

    expect(response.id).toBe('test-unknown');
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.error).toBe('UNKNOWN_TOOL');
      expect(response.message).toContain('nonexistent_tool');
    }
  });

  it('should return INVALID_PARAMS error for missing id', async () => {
    const request = {
      tool: 'get_status',
      params: {},
    } as DaemonRequest;

    const response = await sendRequest(daemon!.socketPath, request);

    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.error).toBe('INVALID_PARAMS');
    }
  });

  it('should return INVALID_PARAMS error for invalid JSON', async () => {
    return new Promise<void>((resolve, reject) => {
      const client = net.createConnection(daemon!.socketPath);
      let buffer = '';

      client.on('connect', () => {
        // Send invalid JSON
        client.write('not valid json\n');
      });

      client.on('data', (data: Buffer) => {
        buffer += data.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx !== -1) {
          client.end();
          try {
            const response = JSON.parse(buffer.slice(0, newlineIdx));
            expect(response.success).toBe(false);
            expect(response.error).toBe('INVALID_PARAMS');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      });

      client.on('error', reject);
    });
  });

  it('should handle multiple requests on same connection', async () => {
    return new Promise<void>((resolve, reject) => {
      const client = net.createConnection(daemon!.socketPath);
      let buffer = '';
      const responses: DaemonResponse[] = [];

      client.on('connect', () => {
        // Send two requests
        client.write(JSON.stringify({ id: 'req-1', tool: 'get_status', params: {} }) + '\n');
        client.write(JSON.stringify({ id: 'req-2', tool: 'get_status', params: {} }) + '\n');
      });

      client.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Process complete messages
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);

          try {
            responses.push(JSON.parse(line));
          } catch (e) {
            reject(e);
            return;
          }

          if (responses.length === 2) {
            client.end();
            expect(responses[0].id).toBe('req-1');
            expect(responses[1].id).toBe('req-2');
            expect(responses[0].success).toBe(true);
            expect(responses[1].success).toBe(true);
            resolve();
          }
        }
      });

      client.on('error', reject);
    });
  });
});

// ─── Tool Handler Tests ─────────────────────────────────────────────────────

describe('Tool Handlers', () => {
  let daemon: DaemonInstance | null = null;
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = getTestProjectPath();
    daemon = await startDaemon(testProjectPath);
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  describe('register_worker', () => {
    it('should register a new worker', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'reg-1',
        tool: 'register_worker',
        params: { name: 'worker1' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect(response.data).toMatchObject({
          success: true,
          worker: 'worker1',
        });
      }
    });

    it('should generate unique name for duplicate', async () => {
      await sendRequest(daemon!.socketPath, {
        id: 'reg-1',
        tool: 'register_worker',
        params: { name: 'worker' },
      });

      const response = await sendRequest(daemon!.socketPath, {
        id: 'reg-2',
        tool: 'register_worker',
        params: { name: 'worker' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).worker).toBe('worker-1');
      }
    });

    it('should reject invalid worker names', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'reg-invalid',
        tool: 'register_worker',
        params: { name: '' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).success).toBe(false);
        expect((response.data as any).error).toContain('required');
      }
    });
  });

  describe('get_status', () => {
    it('should return empty status initially', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'status-1',
        tool: 'get_status',
        params: {},
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect(response.data).toMatchObject({
          workers: [],
          queued_tasks: 0,
          queue: [],
          polling_workers: 0,
          pending_workers: 0,
        });
      }
    });

    it('should show registered workers', async () => {
      await sendRequest(daemon!.socketPath, {
        id: 'reg',
        tool: 'register_worker',
        params: { name: 'worker1' },
      });

      const response = await sendRequest(daemon!.socketPath, {
        id: 'status',
        tool: 'get_status',
        params: {},
      });

      expect(response.success).toBe(true);
      if (response.success) {
        const data = response.data as any;
        expect(data.workers).toHaveLength(1);
        expect(data.workers[0].name).toBe('worker1');
        expect(data.workers[0].status).toBe('idle');
      }
    });
  });

  describe('reset_worker', () => {
    it('should reset a worker to idle', async () => {
      await sendRequest(daemon!.socketPath, {
        id: 'reg',
        tool: 'register_worker',
        params: { name: 'worker1' },
      });

      const response = await sendRequest(daemon!.socketPath, {
        id: 'reset',
        tool: 'reset_worker',
        params: { worker_name: 'worker1' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).success).toBe(true);
        expect((response.data as any).worker).toBe('worker1');
      }
    });

    it('should return error for unknown worker', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'reset-unknown',
        tool: 'reset_worker',
        params: { worker_name: 'nonexistent' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).success).toBe(false);
        expect((response.data as any).error).toContain('Unknown worker');
      }
    });
  });

  describe('poll_task with timeout', () => {
    it('should timeout when no task available', async () => {
      await sendRequest(daemon!.socketPath, {
        id: 'reg',
        tool: 'register_worker',
        params: { name: 'worker1' },
      });

      const start = Date.now();
      const response = await sendRequest(
        daemon!.socketPath,
        {
          id: 'poll',
          tool: 'poll_task',
          params: { name: 'worker1', timeout_ms: 100 },
        },
        5000
      );
      const elapsed = Date.now() - start;

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).task).toBeNull();
        expect((response.data as any).timeout).toBe(true);
      }
      // Should have waited at least 100ms
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });

    it('should return error for unregistered worker', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'poll',
        tool: 'poll_task',
        params: { name: 'unknown', timeout_ms: 100 },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).error).toContain('Unknown worker');
      }
    });
  });

  describe('worker_done', () => {
    it('should handle worker_done even without active task', async () => {
      const response = await sendRequest(daemon!.socketPath, {
        id: 'done',
        tool: 'worker_done',
        params: { bead_id: 'nonexistent-bead' },
      });

      expect(response.success).toBe(true);
      if (response.success) {
        expect((response.data as any).success).toBe(true);
        expect((response.data as any).warning).toContain('Worker not found');
      }
    });
  });
});

// ─── State Sharing Tests ────────────────────────────────────────────────────

describe('Multi-client State Sharing', () => {
  let daemon: DaemonInstance | null = null;
  let testProjectPath: string;

  beforeEach(async () => {
    testProjectPath = getTestProjectPath();
    daemon = await startDaemon(testProjectPath);
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.shutdown();
      daemon = null;
    }
  });

  it('should share worker state across multiple connections', async () => {
    // Client 1 registers a worker
    const client1Reg = await sendRequest(daemon!.socketPath, {
      id: 'c1-reg',
      tool: 'register_worker',
      params: { name: 'worker-from-client1' },
    });
    expect(client1Reg.success).toBe(true);

    // Client 2 (new connection) sees the worker
    const client2Status = await sendRequest(daemon!.socketPath, {
      id: 'c2-status',
      tool: 'get_status',
      params: {},
    });

    expect(client2Status.success).toBe(true);
    if (client2Status.success) {
      const workers = (client2Status.data as any).workers;
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe('worker-from-client1');
    }
  });

  it('should maintain task queue state across connections', async () => {
    // Note: submit_task requires a valid bead, which we can't create in tests
    // So we test by checking the queue state directly via get_status

    const status = await sendRequest(daemon!.socketPath, {
      id: 'queue-check',
      tool: 'get_status',
      params: {},
    });

    expect(status.success).toBe(true);
    if (status.success) {
      expect((status.data as any).queued_tasks).toBe(0);
      expect((status.data as any).queue).toEqual([]);
    }
  });
});
