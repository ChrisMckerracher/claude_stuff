/**
 * Claude Bus Daemon
 *
 * External daemon process for multi-instance Claude Code coordination.
 * Runs independently of Claude Code and maintains shared state for all workers.
 *
 * IPC Protocol: NDJSON (Newline Delimited JSON) over Unix socket
 *
 * Request format:
 *   { "id": "uuid", "tool": "register_worker", "params": {...} }
 *
 * Success response:
 *   { "id": "uuid", "success": true, "data": {...} }
 *
 * Error response:
 *   { "id": "uuid", "success": false, "error": "CODE", "message": "..." }
 *
 * @module claude-bus/daemon
 */

import * as net from 'net';
import * as fs from 'fs';
import * as crypto from 'crypto';

import type {
  State,
  Worker,
  PendingTask,
} from './types.js';
import { createState } from './types.js';
import { validateBead, beadSetInProgress, beadMarkBlocked } from './beads.js';
import { selectWorker } from './selection.js';

// ─── IPC Protocol Types ─────────────────────────────────────────────────────

/**
 * IPC request message format (NDJSON)
 */
export interface DaemonRequest {
  /** Correlation ID for request-response matching */
  id: string;
  /** Tool name to execute */
  tool: string;
  /** Tool parameters */
  params: Record<string, unknown>;
}

/**
 * IPC success response format
 */
export interface DaemonSuccessResponse {
  /** Correlation ID from request */
  id: string;
  /** Success flag */
  success: true;
  /** Tool result data */
  data: unknown;
}

/**
 * IPC error response format
 */
export interface DaemonErrorResponse {
  /** Correlation ID from request */
  id: string;
  /** Success flag */
  success: false;
  /** Error code */
  error: DaemonErrorCode;
  /** Human-readable error message */
  message: string;
}

/**
 * IPC response (success or error)
 */
export type DaemonResponse = DaemonSuccessResponse | DaemonErrorResponse;

/**
 * Error codes for IPC responses
 */
export type DaemonErrorCode =
  | 'UNKNOWN_TOOL'
  | 'INVALID_PARAMS'
  | 'INTERNAL'
  | 'TIMEOUT';

/**
 * Shutdown notification sent to clients before daemon exits
 */
export interface ShutdownNotification {
  type: 'shutdown';
}

// ─── Worker Name Validation ─────────────────────────────────────────────────

/**
 * Worker name validation pattern.
 * - Must start with alphanumeric character
 * - Can contain letters, numbers, dots, underscores, hyphens
 * - Length: 1-64 characters
 */
const WORKER_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

/**
 * Validate a worker name against the pattern.
 * Returns an error message if invalid, or null if valid.
 */
function validateWorkerName(name: string): string | null {
  if (!name || name.trim() === '') {
    return 'Worker name is required';
  }
  if (!WORKER_NAME_PATTERN.test(name)) {
    return 'Invalid worker name: must start with alphanumeric, contain only a-z, 0-9, ., _, - and be 1-64 characters';
  }
  return null;
}

/**
 * Generate a unique worker name by appending a numeric suffix if needed.
 */
function generateUniqueName(baseName: string, workers: Map<string, Worker>): string {
  if (!workers.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  while (workers.has(`${baseName}-${suffix}`)) {
    suffix++;
  }
  return `${baseName}-${suffix}`;
}

// ─── Socket Path Utilities ──────────────────────────────────────────────────

/**
 * Get the socket path for the current project.
 *
 * Uses a hash of the project root to create a unique socket path per project.
 *
 * @param projectRoot - Project root path (defaults to cwd)
 * @returns Socket path like /tmp/claude-bus-abc123.sock
 */
export function getSocketPath(projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  const hash = crypto.createHash('md5').update(root).digest('hex').slice(0, 8);
  return `/tmp/claude-bus-${hash}.sock`;
}

/**
 * Get the PID file path for a socket.
 *
 * @param socketPath - Path to the socket file
 * @returns PID file path
 */
export function getPidFilePath(socketPath: string): string {
  return `${socketPath}.pid`;
}

/**
 * Check if a socket is stale by verifying the PID file.
 *
 * @param socketPath - Path to the socket file
 * @returns true if stale (safe to clean up), false if active
 */
export function isSocketStale(socketPath: string): boolean {
  const pidFile = getPidFilePath(socketPath);

  if (!fs.existsSync(pidFile)) {
    return true; // No PID file = stale
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (isNaN(pid)) {
      return true; // Invalid PID = stale
    }

    // Test if process exists (signal 0 doesn't kill, just checks)
    process.kill(pid, 0);
    return false; // Process exists = active
  } catch {
    return true; // Process dead or error = stale
  }
}

/**
 * Clean up stale socket and PID files.
 *
 * @param socketPath - Path to the socket file
 */
function cleanupSocketFiles(socketPath: string): void {
  const pidFile = getPidFilePath(socketPath);

  try {
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  } catch {
    // Ignore cleanup errors
  }

  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Write PID file for daemon management.
 *
 * @param socketPath - Path to the socket file
 */
function writePidFile(socketPath: string): void {
  const pidFile = getPidFilePath(socketPath);
  fs.writeFileSync(pidFile, process.pid.toString());
}

// ─── State Management ───────────────────────────────────────────────────────

/**
 * Internal helper to assign a task to a polling worker.
 */
function assignTaskToWorker(state: State, worker: Worker, beadId: string): void {
  // Track active bead (dedup)
  state.activeBeads.add(beadId);

  // Create pending task for this worker
  const pendingTask: PendingTask = {
    bead_id: beadId,
    assigned_at: Date.now(),
  };
  state.pendingTasks.set(worker.name, pendingTask);

  // Update worker state to pending (waiting for ack)
  worker.status = 'pending';
  worker.last_activity = Date.now();
  worker.current_task = beadId;
}

/**
 * Process the task queue, dispatching waiting tasks to available workers.
 */
function processQueue(state: State): void {
  while (state.taskQueue.length > 0) {
    const worker = selectWorker(state.workers);
    if (!worker) break;

    const beadId = state.taskQueue.shift()!;

    // Check if this worker has a blocked poll waiting
    const blockedPoller = state.blockedPollers.get(worker.name);

    if (blockedPoller) {
      // Resolve their blocked poll immediately
      assignTaskToWorker(state, worker, beadId);
      blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
    } else {
      // Worker not currently polling - just assign for their next poll
      assignTaskToWorker(state, worker, beadId);
    }
  }
}

// ─── Tool Handlers ──────────────────────────────────────────────────────────

/**
 * Tool handler function type
 */
type ToolHandler = (
  params: Record<string, unknown>,
  state: State
) => unknown | Promise<unknown>;

/**
 * Tool handlers map
 */
const toolHandlers: Record<string, ToolHandler> = {
  // ─── register_worker ────────────────────────────────────────────────────
  register_worker: (params: Record<string, unknown>, state: State) => {
    const name = params.name as string;

    // Validate worker name format
    const nameError = validateWorkerName(name);
    if (nameError) {
      return { success: false, error: nameError };
    }

    // Generate unique name (may append suffix if name already taken)
    const uniqueName = generateUniqueName(name, state.workers);

    // Create a new worker with the unique name
    const now = Date.now();
    const worker: Worker = {
      name: uniqueName,
      status: 'idle',
      registered_at: now,
      last_activity: now,
      current_task: null,
      task_started_at: null,
    };
    state.workers.set(uniqueName, worker);

    return {
      success: true,
      worker: uniqueName,
      message: uniqueName === name ? 'Registered' : `Registered as ${uniqueName}`,
    };
  },

  // ─── poll_task ──────────────────────────────────────────────────────────
  poll_task: (params: Record<string, unknown>, state: State) => {
    const name = params.name as string;
    const timeout = (params.timeout_ms as number) ?? 30000;

    // Validate worker name format
    const nameError = validateWorkerName(name);
    if (nameError) {
      return { error: nameError };
    }

    const worker = state.workers.get(name);

    if (!worker) {
      return { error: `Unknown worker: ${name} - call register_worker first` };
    }

    // Check if task already pending for this worker
    const pending = state.pendingTasks.get(name);
    if (pending) {
      return {
        task: {
          bead_id: pending.bead_id,
          assigned_at: pending.assigned_at,
        },
      };
    }

    // Mark worker as polling (actively waiting for task)
    worker.status = 'polling';
    worker.last_activity = Date.now();

    // Block until task or timeout
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        state.blockedPollers.delete(name);
        // Reset worker to idle on timeout
        if (worker.status === 'polling') {
          worker.status = 'idle';
          worker.last_activity = Date.now();
        }
        resolve({ task: null, timeout: true });
      }, timeout);

      state.blockedPollers.set(name, {
        resolve: (task: PendingTask | null) => {
          clearTimeout(timeoutId);
          state.blockedPollers.delete(name);
          if (task) {
            resolve({
              task: {
                bead_id: task.bead_id,
                assigned_at: task.assigned_at,
              },
            });
          } else {
            resolve({ task: null, timeout: true });
          }
        },
        timeout_id: timeoutId,
      });
    });
  },

  // ─── ack_task ───────────────────────────────────────────────────────────
  ack_task: (params: Record<string, unknown>, state: State) => {
    const name = params.name as string;
    const bead_id = params.bead_id as string;

    // Validate worker name format
    const nameError = validateWorkerName(name);
    if (nameError) {
      return { success: false, error: nameError };
    }

    const worker = state.workers.get(name);

    if (!worker) {
      return { success: false, error: `Unknown worker: ${name}` };
    }

    // Verify the task matches what was assigned
    const pending = state.pendingTasks.get(name);
    if (!pending || pending.bead_id !== bead_id) {
      return {
        success: false,
        error: `Task mismatch: expected ${pending?.bead_id ?? 'none'}, got ${bead_id}`,
      };
    }

    // Transition worker to executing state
    worker.status = 'executing';
    worker.last_activity = Date.now();
    worker.current_task = bead_id;
    worker.task_started_at = Date.now();

    // Remove from pending (now executing)
    state.pendingTasks.delete(name);

    // Mark bead as in_progress
    try {
      beadSetInProgress(bead_id);
    } catch (e) {
      // Rollback on failure
      worker.status = 'idle';
      worker.last_activity = Date.now();
      worker.current_task = null;
      worker.task_started_at = null;
      state.activeBeads.delete(bead_id);

      return {
        success: false,
        error: `Failed to update bead status: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    return { success: true, worker: name, bead_id };
  },

  // ─── submit_task ────────────────────────────────────────────────────────
  submit_task: (params: Record<string, unknown>, state: State) => {
    const bead_id = params.bead_id as string;

    // Validate bead exists and is in submittable state
    const validation = validateBead(bead_id);
    if (!validation.valid) {
      return { dispatched: false, error: validation.error, bead_id };
    }

    // Dedup: reject if already active or queued
    if (state.activeBeads.has(bead_id)) {
      return { dispatched: false, error: 'Task already active or queued', bead_id };
    }

    // Select LRU available worker
    const worker = selectWorker(state.workers);

    if (worker) {
      // Check if this worker has a blocked poll waiting
      const blockedPoller = state.blockedPollers.get(worker.name);

      if (blockedPoller) {
        // Resolve their blocked poll immediately
        assignTaskToWorker(state, worker, bead_id);
        blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
      } else {
        // Worker not currently polling - assign for their next poll
        assignTaskToWorker(state, worker, bead_id);
      }

      return { dispatched: true, worker: worker.name, bead_id };
    } else {
      // No worker available - queue the task
      state.activeBeads.add(bead_id);
      state.taskQueue.push(bead_id);
      return {
        dispatched: false,
        queued: true,
        position: state.taskQueue.length,
        bead_id,
      };
    }
  },

  // ─── worker_done ────────────────────────────────────────────────────────
  worker_done: (params: Record<string, unknown>, state: State) => {
    const bead_id = params.bead_id as string;

    // Remove from active set (allows resubmit if needed later)
    state.activeBeads.delete(bead_id);

    // Find worker with this task
    const worker = Array.from(state.workers.values()).find(
      (w) => w.current_task === bead_id
    );

    if (!worker) {
      return { success: true, bead_id, warning: 'Worker not found' };
    }

    // Mark worker idle
    worker.status = 'idle';
    worker.last_activity = Date.now();
    worker.current_task = null;
    worker.task_started_at = null;

    // Process queue to dispatch waiting tasks
    processQueue(state);

    return { success: true, bead_id, worker: worker.name };
  },

  // ─── task_failed ────────────────────────────────────────────────────────
  task_failed: (params: Record<string, unknown>, state: State) => {
    const bead_id = params.bead_id as string;
    const reason = params.reason as string;

    // Mark bead as blocked (not closed, not in_progress)
    try {
      beadMarkBlocked(bead_id, reason);
    } catch (e) {
      return {
        success: false,
        bead_id,
        status: 'blocked',
        reason: `Failed to mark bead blocked: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    // Remove from active set
    state.activeBeads.delete(bead_id);

    // Find and free the worker
    const worker = Array.from(state.workers.values()).find(
      (w) => w.current_task === bead_id
    );

    if (worker) {
      worker.status = 'idle';
      worker.last_activity = Date.now();
      worker.current_task = null;
      worker.task_started_at = null;
    }

    // Process queue to dispatch waiting tasks
    processQueue(state);

    return { success: true, bead_id, status: 'blocked', reason };
  },

  // ─── get_status ─────────────────────────────────────────────────────────
  get_status: (_params: Record<string, unknown>, state: State) => {
    // Build worker list
    const workers = Array.from(state.workers.values()).map((w) => {
      // Get pending task for this worker (if any)
      const pending = state.pendingTasks.get(w.name);

      return {
        name: w.name,
        status: w.status,
        current_task: w.current_task,
        idle_seconds:
          w.status === 'idle' || w.status === 'polling'
            ? Math.floor((Date.now() - w.last_activity) / 1000)
            : null,
        pending_task: pending?.bead_id ?? null,
      };
    });

    // Count polling statistics
    const pollingWorkers = state.blockedPollers.size;
    const pendingWorkers = state.pendingTasks.size;

    return {
      workers,
      queued_tasks: state.taskQueue.length,
      queue: [...state.taskQueue],
      polling_workers: pollingWorkers,
      pending_workers: pendingWorkers,
    };
  },

  // ─── reset_worker ───────────────────────────────────────────────────────
  reset_worker: (params: Record<string, unknown>, state: State) => {
    const worker_name = params.worker_name as string;
    const worker = state.workers.get(worker_name);

    if (!worker) {
      return { success: false, worker: worker_name, error: `Unknown worker: ${worker_name}` };
    }

    const previousTask = worker.current_task;

    // Remove task from active set (allows retry)
    if (previousTask) {
      state.activeBeads.delete(previousTask);
    }

    // Remove any pending task
    state.pendingTasks.delete(worker_name);

    // Cancel any blocked poller
    const blockedPoller = state.blockedPollers.get(worker_name);
    if (blockedPoller) {
      clearTimeout(blockedPoller.timeout_id);
      state.blockedPollers.delete(worker_name);
    }

    // Mark worker idle
    worker.status = 'idle';
    worker.last_activity = Date.now();
    worker.current_task = null;
    worker.task_started_at = null;

    // Process queue to dispatch waiting tasks
    processQueue(state);

    return { success: true, worker: worker_name, previous_task: previousTask };
  },

  // ─── retry_task ─────────────────────────────────────────────────────────
  retry_task: (params: Record<string, unknown>, state: State) => {
    const bead_id = params.bead_id as string;

    // Dedup check: reject if task is still active
    if (state.activeBeads.has(bead_id)) {
      return {
        dispatched: false,
        error: 'Task still active - use reset_worker first if worker died',
        bead_id,
      };
    }

    // Validate bead is in retryable state
    const validation = validateBead(bead_id);
    if (!validation.valid) {
      return { dispatched: false, error: validation.error, bead_id };
    }

    // Select LRU available worker
    const worker = selectWorker(state.workers);

    if (worker) {
      const blockedPoller = state.blockedPollers.get(worker.name);

      if (blockedPoller) {
        assignTaskToWorker(state, worker, bead_id);
        blockedPoller.resolve(state.pendingTasks.get(worker.name)!);
      } else {
        assignTaskToWorker(state, worker, bead_id);
      }

      return { dispatched: true, worker: worker.name, bead_id };
    } else {
      // No worker available - queue the task
      state.activeBeads.add(bead_id);
      state.taskQueue.push(bead_id);
      return {
        dispatched: false,
        queued: true,
        position: state.taskQueue.length,
        bead_id,
      };
    }
  },
};

// ─── Connection Management ──────────────────────────────────────────────────

/**
 * Track connected clients for graceful shutdown
 */
interface ClientConnection {
  socket: net.Socket;
  buffer: string;
}

// ─── Daemon Core ────────────────────────────────────────────────────────────

/**
 * Daemon instance returned by startDaemon()
 */
export interface DaemonInstance {
  /** The net.Server instance */
  server: net.Server;
  /** Path to the Unix socket */
  socketPath: string;
  /** Shared state */
  state: State;
  /** Graceful shutdown function */
  shutdown: () => Promise<void>;
}

/**
 * Handle a single IPC request from a client.
 *
 * @param request - The parsed request
 * @param state - Daemon state
 * @returns Response to send back
 */
async function handleRequest(
  request: DaemonRequest,
  state: State
): Promise<DaemonResponse> {
  const { id, tool, params } = request;

  // Validate request has required fields
  if (!id) {
    return {
      id: 'unknown',
      success: false,
      error: 'INVALID_PARAMS',
      message: 'Request must include id field',
    };
  }

  if (!tool) {
    return {
      id,
      success: false,
      error: 'INVALID_PARAMS',
      message: 'Request must include tool field',
    };
  }

  // Find handler for this tool
  const handler = toolHandlers[tool];
  if (!handler) {
    return {
      id,
      success: false,
      error: 'UNKNOWN_TOOL',
      message: `No handler for tool: ${tool}`,
    };
  }

  // Execute handler
  try {
    const result = await handler(params || {}, state);
    return {
      id,
      success: true,
      data: result,
    };
  } catch (e) {
    return {
      id,
      success: false,
      error: 'INTERNAL',
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Handle data received from a client connection.
 * Implements NDJSON protocol (newline-delimited JSON).
 *
 * @param client - Client connection state
 * @param data - Raw data received
 * @param state - Daemon state
 */
async function handleClientData(
  client: ClientConnection,
  data: Buffer,
  state: State
): Promise<void> {
  client.buffer += data.toString();

  // Process complete messages (newline-delimited)
  const lines = client.buffer.split('\n');
  client.buffer = lines.pop() || ''; // Keep incomplete line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;

    let request: DaemonRequest;
    let requestId = 'unknown';

    try {
      request = JSON.parse(line);
      requestId = request.id || 'unknown';
    } catch (e) {
      // Invalid JSON - send error response
      const errorResponse: DaemonErrorResponse = {
        id: requestId,
        success: false,
        error: 'INVALID_PARAMS',
        message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      };
      client.socket.write(JSON.stringify(errorResponse) + '\n');
      continue;
    }

    // Handle the request
    const response = await handleRequest(request, state);
    client.socket.write(JSON.stringify(response) + '\n');
  }
}

/**
 * Start the daemon process.
 *
 * Creates a Unix socket server that listens for IPC requests from MCP clients.
 *
 * @param projectRoot - Optional project root for socket path
 * @returns Daemon instance with server, state, and shutdown function
 */
export async function startDaemon(projectRoot?: string): Promise<DaemonInstance> {
  const socketPath = getSocketPath(projectRoot);
  const state = createState();
  const clients: Set<ClientConnection> = new Set();

  // Clean up stale socket if it exists
  if (isSocketStale(socketPath)) {
    cleanupSocketFiles(socketPath);
  } else {
    throw new Error(`Daemon already running (socket: ${socketPath})`);
  }

  // Create the server
  const server = net.createServer((socket) => {
    const client: ClientConnection = {
      socket,
      buffer: '',
    };
    clients.add(client);

    socket.on('data', async (data) => {
      try {
        await handleClientData(client, data, state);
      } catch (e) {
        console.error('[daemon] Error handling client data:', e);
      }
    });

    socket.on('error', (err) => {
      // Client disconnected or error - clean up
      console.error('[daemon] Client error:', err.message);
      clients.delete(client);
    });

    socket.on('close', () => {
      clients.delete(client);
    });
  });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    server.listen(socketPath, () => {
      // Set socket permissions to owner-only (0600)
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch {
        // Ignore chmod errors on some platforms
      }
      resolve();
    });
  });

  // Write PID file
  writePidFile(socketPath);

  console.error(`[daemon] Listening on ${socketPath} (PID: ${process.pid})`);

  // Track signal handlers so we can remove them on shutdown
  let shuttingDown = false;
  const sigTermHandler = () => {
    if (!shuttingDown) {
      shuttingDown = true;
      console.error('[daemon] Received SIGTERM');
      shutdown().then(() => process.exit(0));
    }
  };
  const sigIntHandler = () => {
    if (!shuttingDown) {
      shuttingDown = true;
      console.error('[daemon] Received SIGINT');
      shutdown().then(() => process.exit(0));
    }
  };
  const exitHandler = () => {
    cleanupSocketFiles(socketPath);
  };

  // Register signal handlers for graceful shutdown
  process.on('SIGTERM', sigTermHandler);
  process.on('SIGINT', sigIntHandler);
  process.on('exit', exitHandler);

  // Graceful shutdown function
  const shutdown = async (): Promise<void> => {
    console.error('[daemon] Shutting down...');

    // Remove signal handlers to prevent memory leaks in tests
    process.removeListener('SIGTERM', sigTermHandler);
    process.removeListener('SIGINT', sigIntHandler);
    process.removeListener('exit', exitHandler);

    // 1. Stop accepting new connections
    server.close();

    // 2. Notify all connected clients
    const shutdownNotification: ShutdownNotification = { type: 'shutdown' };
    for (const client of clients) {
      try {
        client.socket.write(JSON.stringify(shutdownNotification) + '\n');
      } catch {
        // Ignore write errors during shutdown
      }
    }

    // 3. Wait a short time for clients to process notification
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Force close remaining connections
    for (const client of clients) {
      try {
        client.socket.destroy();
      } catch {
        // Ignore destroy errors
      }
    }
    clients.clear();

    // 5. Cancel all blocked pollers
    for (const [name, poller] of state.blockedPollers) {
      clearTimeout(poller.timeout_id);
      state.blockedPollers.delete(name);
    }

    // 6. Clean up socket and PID files
    cleanupSocketFiles(socketPath);

    console.error('[daemon] Shutdown complete');
  };

  return {
    server,
    socketPath,
    state,
    shutdown,
  };
}

/**
 * Check if daemon is running for a project.
 *
 * @param projectRoot - Optional project root
 * @returns true if daemon is running
 */
export function isDaemonRunning(projectRoot?: string): boolean {
  const socketPath = getSocketPath(projectRoot);
  return !isSocketStale(socketPath);
}

/**
 * Get daemon status information.
 *
 * @param projectRoot - Optional project root
 * @returns Status info or null if not running
 */
export function getDaemonStatus(projectRoot?: string): {
  running: boolean;
  socketPath: string;
  pid?: number;
} {
  const socketPath = getSocketPath(projectRoot);
  const pidFile = getPidFilePath(socketPath);

  if (isSocketStale(socketPath)) {
    return { running: false, socketPath };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return { running: true, socketPath, pid };
  } catch {
    return { running: true, socketPath };
  }
}

/**
 * Stop a running daemon by sending SIGTERM.
 *
 * @param projectRoot - Optional project root
 * @returns true if daemon was stopped, false if not running
 */
export function stopDaemon(projectRoot?: string): boolean {
  const status = getDaemonStatus(projectRoot);

  if (!status.running || !status.pid) {
    return false;
  }

  try {
    process.kill(status.pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}
