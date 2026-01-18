/**
 * Claude Bus Client
 *
 * Client-side connection management for the claude-bus daemon.
 * Handles daemon auto-start, connection pooling, and retry logic.
 *
 * @module claude-bus/client
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getSocketPath, isSocketStale } from './daemon.js';
import type { DaemonRequest, DaemonResponse } from './daemon.js';

/**
 * Get the directory containing this module.
 * Uses a workaround to avoid direct import.meta access which doesn't work in Jest.
 */
function getModuleDir(): string {
  try {
    // Try to get from Error stack trace (works in both ESM and CJS)
    const err = new Error();
    const stack = err.stack || '';
    // Look for file:// URLs in the stack
    const match = stack.match(/file:\/\/([^\s:]+)/);
    if (match) {
      return path.dirname(match[1]);
    }
    // Try to extract path from stack (node format)
    const pathMatch = stack.match(/at\s+(?:.*?)\s+\(([^:]+):\d+:\d+\)/);
    if (pathMatch && pathMatch[1].includes('/')) {
      return path.dirname(pathMatch[1]);
    }
  } catch {
    // Ignore errors from stack parsing
  }
  // Fallback: look for daemon.js relative to process.cwd() in common locations
  const candidates = [
    path.join(process.cwd(), 'dist', 'claude-bus'),
    path.join(process.cwd(), 'plugin', 'lib', 'dist', 'claude-bus'),
    path.join(process.cwd(), 'claude-bus'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'daemon.js'))) {
      return dir;
    }
  }
  // Last resort: assume we're in the same directory
  return process.cwd();
}

/**
 * Default timeouts and retry configuration
 */
const DAEMON_START_TIMEOUT_MS = 5000;
const DAEMON_START_RETRY_INTERVAL_MS = 100;
const FORWARD_RETRY_COUNT = 3;
const FORWARD_INITIAL_BACKOFF_MS = 100;
const TOOL_CALL_TIMEOUT_MS = 60000;

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to connect to the daemon socket.
 *
 * @param socketPath - Path to the Unix socket
 * @param timeout - Connection timeout in ms
 * @returns Connected socket or null
 */
async function tryConnect(
  socketPath: string,
  timeout: number = 1000
): Promise<net.Socket | null> {
  if (!fs.existsSync(socketPath)) {
    return null;
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve(null);
      }
    }, timeout);

    socket.on('connect', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(socket);
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(null);
      }
    });
  });
}

/**
 * Spawn the daemon process in the background.
 *
 * @param projectRoot - Project root for the daemon
 * @returns The spawned child process (detached)
 */
function spawnDaemon(projectRoot?: string): ChildProcess {
  // Get the path to the daemon entry point
  // The daemon.js is in the same directory as client.js when compiled
  const daemonPath = path.join(getModuleDir(), 'daemon.js');

  const args = [daemonPath];
  if (projectRoot) {
    args.push('--project-root', projectRoot);
  }

  // Spawn detached with stdio ignored so it can run independently
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CLAUDE_BUS_DAEMON: '1', // Signal that we're running as daemon
    },
  });

  // Unref so parent can exit
  child.unref();

  return child;
}

/**
 * Ensure the daemon is running and return a connected socket.
 *
 * If the daemon is not running, it will be auto-started.
 * Implements retry logic with exponential backoff for daemon startup.
 *
 * @param projectRoot - Optional project root
 * @returns Connected socket to the daemon
 * @throws Error if daemon cannot be started or connected to
 */
export async function ensureDaemon(projectRoot?: string): Promise<net.Socket> {
  const socketPath = getSocketPath(projectRoot);

  // First, try to connect to an existing daemon
  let socket = await tryConnect(socketPath);
  if (socket) {
    return socket;
  }

  // Check if socket is stale and needs cleanup
  if (isSocketStale(socketPath)) {
    // Socket file exists but daemon is dead - clean up will happen when daemon starts
    console.error('[client] Stale socket detected, starting new daemon');
  }

  // Spawn daemon in background
  console.error('[client] Starting daemon...');
  spawnDaemon(projectRoot);

  // Wait for daemon to start with retries
  const maxRetries = Math.ceil(DAEMON_START_TIMEOUT_MS / DAEMON_START_RETRY_INTERVAL_MS);

  for (let i = 0; i < maxRetries; i++) {
    await sleep(DAEMON_START_RETRY_INTERVAL_MS);

    socket = await tryConnect(socketPath);
    if (socket) {
      console.error('[client] Connected to daemon');
      return socket;
    }
  }

  throw new Error(
    `Failed to start daemon after ${DAEMON_START_TIMEOUT_MS}ms (socket: ${socketPath})`
  );
}

/**
 * Send a request to the daemon and wait for response.
 *
 * @param socket - Connected socket
 * @param request - Request to send
 * @param timeout - Response timeout in ms
 * @returns Response from daemon
 */
async function sendRequest(
  socket: net.Socket,
  request: DaemonRequest,
  timeout: number = TOOL_CALL_TIMEOUT_MS
): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        reject(new Error(`Request timed out after ${timeout}ms`));
      }
    }, timeout);

    const cleanup = () => {
      clearTimeout(timeoutId);
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };

    const onData = (data: Buffer) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited)
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (!resolved) {
          resolved = true;
          cleanup();

          try {
            const response = JSON.parse(line) as DaemonResponse;
            resolve(response);
          } catch (e) {
            reject(new Error(`Invalid response: ${e instanceof Error ? e.message : String(e)}`));
          }
        }
      }
    };

    const onError = (err: Error) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Socket error: ${err.message}`));
      }
    };

    const onClose = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error('Socket closed unexpectedly'));
      }
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);

    // Send request
    socket.write(JSON.stringify(request) + '\n');
  });
}

/**
 * Forward a tool call to the daemon with retry and exponential backoff.
 *
 * Implements automatic reconnection and retry logic for transient failures.
 *
 * @param toolName - Name of the tool to call
 * @param args - Tool arguments
 * @param projectRoot - Optional project root
 * @returns Tool result data
 * @throws Error after all retries exhausted
 */
export async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot?: string
): Promise<unknown> {
  let lastError: Error | null = null;
  let backoff = FORWARD_INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt < FORWARD_RETRY_COUNT; attempt++) {
    try {
      // Get a connection to the daemon
      const socket = await ensureDaemon(projectRoot);

      try {
        // Send the tool request
        const request: DaemonRequest = {
          id: generateRequestId(),
          tool: toolName,
          params: args,
        };

        const response = await sendRequest(socket, request);

        // Close the socket after use
        socket.end();

        if (!response.success) {
          // Handle non-retryable errors
          const errorResponse = response as { error: string; message: string };
          throw new Error(`${errorResponse.error}: ${errorResponse.message}`);
        }

        return (response as { data: unknown }).data;
      } finally {
        // Ensure socket is closed even on error
        if (!socket.destroyed) {
          socket.destroy();
        }
      }
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // Don't retry on non-transient errors
      const message = lastError.message.toLowerCase();
      if (
        message.includes('unknown_tool') ||
        message.includes('invalid_params') ||
        message.includes('invalid worker name')
      ) {
        throw lastError;
      }

      // Wait before retry with exponential backoff
      if (attempt < FORWARD_RETRY_COUNT - 1) {
        console.error(
          `[client] Attempt ${attempt + 1} failed: ${lastError.message}, retrying in ${backoff}ms`
        );
        await sleep(backoff);
        backoff *= 2;
      }
    }
  }

  throw new Error(
    `Failed to forward tool call after ${FORWARD_RETRY_COUNT} attempts: ${lastError?.message}`
  );
}

/**
 * Check if the daemon is running.
 *
 * @param projectRoot - Optional project root
 * @returns true if daemon is running
 */
export async function isDaemonRunning(projectRoot?: string): Promise<boolean> {
  const socketPath = getSocketPath(projectRoot);
  const socket = await tryConnect(socketPath);

  if (socket) {
    socket.destroy();
    return true;
  }

  return false;
}
