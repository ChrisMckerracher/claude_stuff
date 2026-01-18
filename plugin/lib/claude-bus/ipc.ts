/**
 * Claude Bus IPC Module
 *
 * Unix socket-based inter-process communication for the MCP server.
 * Allows CLI commands to signal the running MCP server.
 *
 * Socket path: /tmp/claude-bus-{project-hash}.sock
 *
 * Protocol: JSON-RPC style messages over newline-delimited JSON
 *
 * @module claude-bus/ipc
 */

import * as net from 'net';
import * as fs from 'fs';
import * as crypto from 'crypto';

/**
 * IPC message types
 */
export type IpcMessageType = 'worker_done' | 'task_failed' | 'ping' | 'forward_tool';

/**
 * IPC request message
 */
export interface IpcRequest {
  type: IpcMessageType;
  bead_id?: string;
  reason?: string;
  // For forward_tool message type
  tool_name?: string;
  tool_args?: Record<string, unknown>;
}

/**
 * IPC response message
 */
export interface IpcResponse {
  success: boolean;
  error?: string;
  data?: unknown;
}

/**
 * Callback for handling IPC messages (can be async)
 */
export type IpcHandler = (request: IpcRequest) => IpcResponse | Promise<IpcResponse>;

/**
 * Get the socket path for the current project.
 *
 * Uses a hash of the current working directory to create a unique
 * socket path per project.
 *
 * @param projectRoot - Optional project root path (defaults to cwd)
 * @returns Socket path like /tmp/claude-bus-abc123.sock
 */
export function getSocketPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  const hash = crypto.createHash('md5').update(root).digest('hex').slice(0, 8);
  return `/tmp/claude-bus-${hash}.sock`;
}

/**
 * Clean up stale socket file if it exists.
 *
 * @param socketPath - Path to the socket file
 */
function cleanupSocket(socketPath: string): void {
  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // Ignore errors - file may not exist or may be in use
  }
}

/**
 * Check if a socket is stale (file exists but no server responding).
 *
 * @param socketPath - Path to the socket file
 * @param timeout - Connection timeout in ms (default: 500)
 * @returns Promise<true> if stale (safe to clean up), false if active server
 */
async function isSocketStale(socketPath: string, timeout: number = 500): Promise<boolean> {
  if (!fs.existsSync(socketPath)) {
    return true; // No socket file = stale
  }

  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timeoutId = setTimeout(() => {
      socket.destroy();
      resolve(true); // Timeout = stale
    }, timeout);

    socket.on('connect', () => {
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(false); // Connected = active server
    });

    socket.on('error', () => {
      clearTimeout(timeoutId);
      socket.destroy();
      resolve(true); // Error = stale
    });
  });
}

/**
 * Start an IPC server that listens for notifications.
 *
 * Creates a Unix domain socket server that accepts JSON-RPC style
 * messages from CLI commands.
 *
 * Uses atomic socket creation to prevent race conditions when multiple
 * Claude Code instances start simultaneously. If another server is already
 * running, this will throw an error with code 'EADDRINUSE'.
 *
 * @param handler - Function to handle incoming messages
 * @param projectRoot - Optional project root for socket path
 * @returns Promise with the server instance and socket path
 * @throws Error with code 'EADDRINUSE' if socket already exists and is in use
 */
export async function startIpcServer(
  handler: IpcHandler,
  projectRoot?: string
): Promise<{ server: net.Server; socketPath: string }> {
  const socketPath = getSocketPath(projectRoot);

  // Only clean up socket if it's truly stale (file exists but no server responding)
  // This prevents race conditions where we delete another server's active socket
  const stale = await isSocketStale(socketPath);
  if (stale) {
    cleanupSocket(socketPath);
  }
  // If not stale, server.listen() will fail with EADDRINUSE - that's intentional

  const server = net.createServer((connection) => {
    let buffer = '';

    connection.on('data', (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited)
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const request: IpcRequest = JSON.parse(line);
          // Handle async handlers
          const maybePromise = handler(request);
          if (maybePromise instanceof Promise) {
            maybePromise
              .then((response) => {
                connection.write(JSON.stringify(response) + '\n');
              })
              .catch((e) => {
                const errorResponse: IpcResponse = {
                  success: false,
                  error: `Handler error: ${e instanceof Error ? e.message : String(e)}`,
                };
                connection.write(JSON.stringify(errorResponse) + '\n');
              });
          } else {
            connection.write(JSON.stringify(maybePromise) + '\n');
          }
        } catch (e) {
          const errorResponse: IpcResponse = {
            success: false,
            error: `Invalid request: ${e instanceof Error ? e.message : String(e)}`,
          };
          connection.write(JSON.stringify(errorResponse) + '\n');
        }
      }
    });

    connection.on('error', () => {
      // Client disconnected or error - ignore
    });
  });

  // Wrap listen in a Promise to catch EADDRINUSE
  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    server.listen(socketPath, () => {
      resolve();
    });
  });

  // Ensure socket is cleaned up on process exit
  const cleanup = () => {
    try {
      server.close();
      cleanupSocket(socketPath);
    } catch {
      // Ignore cleanup errors
    }
  };

  process.on('exit', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  return { server, socketPath };
}

/**
 * Send a message to the IPC server.
 *
 * Connects to the Unix socket, sends a message, and waits for response.
 *
 * @param request - The IPC request to send
 * @param projectRoot - Optional project root for socket path
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns The response from the server
 * @throws Error if connection fails or times out
 */
export function sendIpcMessage(
  request: IpcRequest,
  projectRoot?: string,
  timeout: number = 5000
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = getSocketPath(projectRoot);

    // Check if socket exists
    if (!fs.existsSync(socketPath)) {
      reject(new Error(`Bus not running (socket not found: ${socketPath})`));
      return;
    }

    const client = net.createConnection(socketPath);
    let buffer = '';
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.destroy();
        reject(new Error('IPC request timed out'));
      }
    }, timeout);

    client.on('connect', () => {
      client.write(JSON.stringify(request) + '\n');
    });

    client.on('data', (data) => {
      buffer += data.toString();

      // Look for complete response
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx);
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.end();

          try {
            const response: IpcResponse = JSON.parse(line);
            resolve(response);
          } catch (e) {
            reject(new Error(`Invalid response: ${e instanceof Error ? e.message : String(e)}`));
          }
        }
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(new Error(`IPC connection failed: ${err.message}`));
      }
    });

    client.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        reject(new Error('IPC connection closed unexpectedly'));
      }
    });
  });
}

/**
 * Send a worker_done notification to the bus.
 *
 * Convenience function for CLI usage.
 *
 * @param beadId - The bead ID that was completed
 * @param projectRoot - Optional project root for socket path
 * @returns The response from the server
 */
export async function notifyWorkerDone(
  beadId: string,
  projectRoot?: string
): Promise<IpcResponse> {
  return sendIpcMessage({ type: 'worker_done', bead_id: beadId }, projectRoot);
}

/**
 * Send a task_failed notification to the bus.
 *
 * @param beadId - The bead ID that failed
 * @param reason - The reason for failure
 * @param projectRoot - Optional project root for socket path
 * @returns The response from the server
 */
export async function notifyTaskFailed(
  beadId: string,
  reason: string,
  projectRoot?: string
): Promise<IpcResponse> {
  return sendIpcMessage(
    { type: 'task_failed', bead_id: beadId, reason },
    projectRoot
  );
}

/**
 * Check if the bus is running by pinging it.
 *
 * @param projectRoot - Optional project root for socket path
 * @returns true if bus is running, false otherwise
 */
export async function isBusRunning(projectRoot?: string): Promise<boolean> {
  try {
    const response = await sendIpcMessage({ type: 'ping' }, projectRoot, 1000);
    return response.success;
  } catch {
    return false;
  }
}

/**
 * Try to connect to an existing bus server.
 *
 * Used for singleton detection - if connection succeeds, there's already
 * a server running for this codebase.
 *
 * @param projectRoot - Optional project root for socket path
 * @param timeout - Connection timeout in ms (default: 1000)
 * @returns Connected socket if server exists, null otherwise
 */
export async function tryConnectToServer(
  projectRoot?: string,
  timeout: number = 1000
): Promise<net.Socket | null> {
  const socketPath = getSocketPath(projectRoot);

  // Check if socket exists
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
 * Forward an MCP tool call to the bus server via IPC.
 *
 * Used in client mode to proxy tool calls to the real server.
 *
 * @param toolName - Name of the MCP tool
 * @param args - Tool arguments
 * @param projectRoot - Optional project root for socket path
 * @returns The tool response data
 */
export async function forwardToolCall(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot?: string
): Promise<unknown> {
  const response = await sendIpcMessage(
    { type: 'forward_tool', tool_name: toolName, tool_args: args },
    projectRoot,
    60000 // 60s timeout for tool calls (some like poll_task block)
  );

  if (!response.success) {
    throw new Error(response.error || 'Tool forwarding failed');
  }

  return response.data;
}
