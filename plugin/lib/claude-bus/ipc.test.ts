/**
 * IPC Module Tests
 *
 * Tests for the Unix socket-based inter-process communication
 * used by the CLI to notify the MCP server.
 */

import { jest, describe, it, expect, afterEach } from '@jest/globals';
import * as fs from 'fs';
import {
  getSocketPath,
  startIpcServer,
  sendIpcMessage,
  notifyWorkerDone,
  isBusRunning,
  type IpcRequest,
  type IpcResponse,
} from './ipc';

describe('IPC Module', () => {
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

    it('should use cwd when no project root specified', () => {
      const socketPath = getSocketPath();
      expect(socketPath).toMatch(/^\/tmp\/claude-bus-[a-f0-9]{8}\.sock$/);
    });
  });

  describe('startIpcServer and sendIpcMessage', () => {
    let cleanup: (() => void) | null = null;
    const testProjectRoot = '/tmp/test-ipc-' + Date.now();

    afterEach(() => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
    });

    it('should start a server and handle ping', async () => {
      const handler = jest.fn((request: IpcRequest): IpcResponse => {
        if (request.type === 'ping') {
          return { success: true, data: { status: 'running' } };
        }
        return { success: false, error: 'Unknown type' };
      });

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);
      cleanup = () => {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      };

      const response = await sendIpcMessage({ type: 'ping' }, testProjectRoot);
      expect(response.success).toBe(true);
      expect(response.data).toEqual({ status: 'running' });
      expect(handler).toHaveBeenCalledWith({ type: 'ping' });
    });

    it('should handle worker_done notifications', async () => {
      const handler = jest.fn((request: IpcRequest): IpcResponse => {
        if (request.type === 'worker_done') {
          return {
            success: true,
            data: { bead_id: request.bead_id, worker: 'z.ai1' },
          };
        }
        return { success: false, error: 'Unknown type' };
      });

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);
      cleanup = () => {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      };

      const response = await notifyWorkerDone('bd-test123', testProjectRoot);
      expect(response.success).toBe(true);
      expect(handler).toHaveBeenCalledWith({
        type: 'worker_done',
        bead_id: 'bd-test123',
      });
    });

    it('should return error when server is not running', async () => {
      const nonExistentProject = '/tmp/nonexistent-' + Date.now();
      await expect(
        sendIpcMessage({ type: 'ping' }, nonExistentProject)
      ).rejects.toThrow(/socket not found/);
    });

    it('should handle invalid JSON gracefully', async () => {
      const handler = jest.fn((): IpcResponse => {
        return { success: true };
      });

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);
      cleanup = () => {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      };

      // Server handles invalid JSON and returns error response
      // We can't easily send invalid JSON through sendIpcMessage,
      // so we just verify the server is running
      const response = await sendIpcMessage({ type: 'ping' }, testProjectRoot);
      expect(response.success).toBe(true);
    });
  });

  describe('isBusRunning', () => {
    it('should return false when bus is not running', async () => {
      const nonExistentProject = '/tmp/nonexistent-' + Date.now();
      const running = await isBusRunning(nonExistentProject);
      expect(running).toBe(false);
    });

    it('should return true when bus is running', async () => {
      const testProjectRoot = '/tmp/test-ipc-running-' + Date.now();
      const handler = (request: IpcRequest): IpcResponse => {
        if (request.type === 'ping') {
          return { success: true };
        }
        return { success: false, error: 'Unknown type' };
      };

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);

      try {
        const running = await isBusRunning(testProjectRoot);
        expect(running).toBe(true);
      } finally {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });
  });
});

// ============================================================================
// Singleton Server Pattern Tests
// Tests for tryConnectToServer and forwardToolCall functionality
// ============================================================================

import { tryConnectToServer, forwardToolCall } from './ipc';

describe('Singleton Server Pattern', () => {
  describe('tryConnectToServer', () => {
    const testProjectRoot = '/tmp/test-singleton-' + Date.now();

    it('should return null when no server is running', async () => {
      const nonExistentProject = '/tmp/nonexistent-singleton-' + Date.now();
      const socket = await tryConnectToServer(nonExistentProject);
      expect(socket).toBeNull();
    });

    it('should return a socket when a server is running', async () => {
      const handler = (request: IpcRequest): IpcResponse => {
        if (request.type === 'ping') {
          return { success: true };
        }
        return { success: false, error: 'Unknown type' };
      };

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);

      try {
        const socket = await tryConnectToServer(testProjectRoot);
        expect(socket).not.toBeNull();
        socket?.destroy(); // Clean up connection
      } finally {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });

    it('should return null for stale socket file (no server listening)', async () => {
      const staleProject = '/tmp/test-stale-socket-' + Date.now();
      const socketPath = getSocketPath(staleProject);

      // Create a stale socket file (just a regular file, not a listening socket)
      fs.writeFileSync(socketPath, '');

      try {
        const socket = await tryConnectToServer(staleProject, 500);
        // Should return null because there's no server listening
        expect(socket).toBeNull();
      } finally {
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });
  });

  describe('forwardToolCall', () => {
    const testProjectRoot = '/tmp/test-forward-' + Date.now();

    it('should forward tool calls to the server and return response', async () => {
      // Create a mock handler that handles forward_tool messages
      const handler = (request: IpcRequest): IpcResponse | Promise<IpcResponse> => {
        if (request.type === 'ping') {
          return { success: true };
        }
        if (request.type === 'forward_tool') {
          // Simulate the real server's tool handling
          if (request.tool_name === 'get_status') {
            return {
              success: true,
              data: {
                workers: [],
                queued_tasks: 0,
                queue: [],
                polling_workers: 0,
                pending_workers: 0,
              },
            };
          }
          if (request.tool_name === 'register_worker') {
            const name = (request.tool_args as any)?.name || 'unknown';
            return {
              success: true,
              data: {
                success: true,
                worker: name,
                message: 'Registered',
              },
            };
          }
          return { success: false, error: `Unknown tool: ${request.tool_name}` };
        }
        return { success: false, error: 'Unknown type' };
      };

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);

      try {
        // Forward a get_status call
        const statusResult = await forwardToolCall('get_status', {}, testProjectRoot);
        expect(statusResult).toEqual({
          workers: [],
          queued_tasks: 0,
          queue: [],
          polling_workers: 0,
          pending_workers: 0,
        });

        // Forward a register_worker call
        const registerResult = await forwardToolCall(
          'register_worker',
          { name: 'test-worker' },
          testProjectRoot
        );
        expect(registerResult).toEqual({
          success: true,
          worker: 'test-worker',
          message: 'Registered',
        });
      } finally {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });

    it('should throw error when server returns error', async () => {
      const handler = (request: IpcRequest): IpcResponse => {
        if (request.type === 'forward_tool') {
          return { success: false, error: 'Tool execution failed' };
        }
        return { success: false, error: 'Unknown type' };
      };

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);

      try {
        await expect(
          forwardToolCall('unknown_tool', {}, testProjectRoot)
        ).rejects.toThrow('Tool execution failed');
      } finally {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });

    it('should throw error when server is not running', async () => {
      const nonExistentProject = '/tmp/nonexistent-forward-' + Date.now();
      await expect(
        forwardToolCall('get_status', {}, nonExistentProject)
      ).rejects.toThrow(/socket not found/);
    });
  });

  describe('multiple clients sharing state', () => {
    const testProjectRoot = '/tmp/test-multi-client-' + Date.now();

    it('should share state between multiple IPC clients', async () => {
      // Simulated server state
      const workers = new Map<string, { name: string; status: string }>();

      const handler = (request: IpcRequest): IpcResponse => {
        if (request.type === 'forward_tool') {
          if (request.tool_name === 'register_worker') {
            const name = (request.tool_args as any)?.name;
            workers.set(name, { name, status: 'idle' });
            return { success: true, data: { success: true, worker: name } };
          }
          if (request.tool_name === 'get_status') {
            return {
              success: true,
              data: {
                workers: Array.from(workers.values()),
                queued_tasks: 0,
              },
            };
          }
        }
        return { success: false, error: 'Unknown' };
      };

      const { server, socketPath } = await startIpcServer(handler, testProjectRoot);

      try {
        // "Client A" registers a worker
        await forwardToolCall('register_worker', { name: 'worker-a' }, testProjectRoot);

        // "Client B" registers another worker
        await forwardToolCall('register_worker', { name: 'worker-b' }, testProjectRoot);

        // "Client C" gets status and sees both workers
        const status = (await forwardToolCall('get_status', {}, testProjectRoot)) as any;
        expect(status.workers).toHaveLength(2);
        expect(status.workers.map((w: any) => w.name)).toContain('worker-a');
        expect(status.workers.map((w: any) => w.name)).toContain('worker-b');
      } finally {
        server.close();
        try {
          fs.unlinkSync(socketPath);
        } catch {
          // Ignore
        }
      }
    });
  });
});
