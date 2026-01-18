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
    const timeout = (params.timeout_ms as number) ?? 5000;

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
 * Track connected clients for graceful shutdown and connection lifecycle
 */
interface ClientConnection {
  socket: net.Socket;
  buffer: string;
  /** Worker names owned by this connection */
  ownedWorkers: Set<string>;
}

/**
 * Extended worker with connection tracking
 */
interface ExtendedWorker extends Worker {
  /** The connection that owns this worker */
  ownerConnection?: ClientConnection;
  /** Timestamp when worker disconnected (for grace period) */
  disconnectedAt?: number;
}

// ─── Configuration Constants ─────────────────────────────────────────────────

/**
 * Default timeout for stuck tasks (30 minutes)
 */
const DEFAULT_TASK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Grace period for worker reconnection after disconnect (30 seconds)
 */
const WORKER_DISCONNECT_GRACE_MS = 30 * 1000;

/**
 * Interval for checking stuck tasks (60 seconds)
 */
const TASK_CHECK_INTERVAL_MS = 60 * 1000;

/**
 * Grace period for graceful shutdown (5 seconds)
 */
const SHUTDOWN_GRACE_PERIOD_MS = 5000;

/**
 * Get task timeout from environment variable or default
 */
function getTaskTimeoutMs(): number {
  const envTimeout = process.env.CLAUDE_BUS_TASK_TIMEOUT_MS;
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TASK_TIMEOUT_MS;
}

// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * Logger interface for daemon
 */
interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  debug: (message: string) => void;
}

/**
 * Create a logger for foreground mode (stdout/stderr)
 */
function createForegroundLogger(): Logger {
  return {
    info: (msg: string) => console.error(`[daemon] ${msg}`),
    error: (msg: string) => console.error(`[daemon] ERROR: ${msg}`),
    warn: (msg: string) => console.error(`[daemon] WARN: ${msg}`),
    debug: (msg: string) => {
      if (process.env.CLAUDE_BUS_DEBUG) {
        console.error(`[daemon] DEBUG: ${msg}`);
      }
    },
  };
}

/**
 * Create a logger for background mode (file-based)
 */
function createFileLogger(logPath: string): Logger {
  const logDir = logPath.substring(0, logPath.lastIndexOf('/'));

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const writeLog = (level: string, msg: string) => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${level}] ${msg}\n`;
    fs.appendFileSync(logPath, line);
  };

  return {
    info: (msg: string) => writeLog('INFO', msg),
    error: (msg: string) => writeLog('ERROR', msg),
    warn: (msg: string) => writeLog('WARN', msg),
    debug: (msg: string) => {
      if (process.env.CLAUDE_BUS_DEBUG) {
        writeLog('DEBUG', msg);
      }
    },
  };
}

/**
 * Get log file path for background mode
 */
export function getLogFilePath(socketPath: string): string {
  const homeDir = process.env.HOME || '/tmp';
  const hash = socketPath.split('-').pop()?.replace('.sock', '') || 'unknown';
  return `${homeDir}/.claude-bus/logs/daemon-${hash}.log`;
}

// ─── Daemon Core ────────────────────────────────────────────────────────────

/**
 * Daemon startup options
 */
export interface DaemonOptions {
  /** Project root for socket path calculation */
  projectRoot?: string;
  /** Run in foreground mode (log to stdout/stderr) */
  foreground?: boolean;
  /** Custom log file path (overrides default) */
  logFile?: string;
}

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
  /** Logger instance */
  logger: Logger;
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
 * Handle connection close - mark owned workers as disconnected.
 *
 * @param client - The disconnected client
 * @param state - Daemon state
 * @param logger - Logger instance
 */
function handleConnectionClose(
  client: ClientConnection,
  state: State,
  logger: Logger
): void {
  const now = Date.now();

  for (const workerName of client.ownedWorkers) {
    const worker = state.workers.get(workerName) as ExtendedWorker | undefined;
    if (worker) {
      worker.disconnectedAt = now;
      worker.ownerConnection = undefined;
      logger.info(`Worker ${workerName} disconnected, grace period started`);
    }
  }
}

/**
 * Check for disconnected workers past grace period and stuck tasks.
 *
 * @param state - Daemon state
 * @param logger - Logger instance
 */
function checkWorkersAndTasks(state: State, logger: Logger): void {
  const now = Date.now();
  const taskTimeoutMs = getTaskTimeoutMs();

  // Check for disconnected workers past grace period
  for (const [name, worker] of state.workers) {
    const extWorker = worker as ExtendedWorker;

    // Check grace period for disconnected workers
    if (extWorker.disconnectedAt) {
      const elapsed = now - extWorker.disconnectedAt;
      if (elapsed >= WORKER_DISCONNECT_GRACE_MS) {
        logger.warn(`Worker ${name} grace period expired, removing`);

        // Return any active task to queue
        if (extWorker.current_task) {
          const taskId = extWorker.current_task;
          state.activeBeads.delete(taskId);
          state.taskQueue.push(taskId);
          logger.info(`Task ${taskId} returned to queue from disconnected worker ${name}`);
        }

        // Clean up worker
        state.workers.delete(name);
        state.pendingTasks.delete(name);

        // Cancel any blocked poller
        const poller = state.blockedPollers.get(name);
        if (poller) {
          clearTimeout(poller.timeout_id);
          state.blockedPollers.delete(name);
        }

        continue; // Worker removed, skip timeout check
      }
    }

    // Check for stuck tasks (tasks executing for too long)
    if (extWorker.status === 'executing' && extWorker.task_started_at) {
      const elapsed = now - extWorker.task_started_at;
      if (elapsed >= taskTimeoutMs) {
        const taskId = extWorker.current_task!;
        logger.warn(`Task ${taskId} timed out on worker ${name} after ${elapsed}ms`);

        // Return task to queue
        state.activeBeads.delete(taskId);
        state.taskQueue.push(taskId);

        // Reset worker to idle
        extWorker.status = 'idle';
        extWorker.last_activity = now;
        extWorker.current_task = null;
        extWorker.task_started_at = null;

        logger.info(`Task ${taskId} returned to queue due to timeout`);
      }
    }
  }

  // Process queue after cleanup
  processQueue(state);
}

/**
 * Start the daemon process.
 *
 * Creates a Unix socket server that listens for IPC requests from MCP clients.
 *
 * @param options - Daemon options or project root string for backward compatibility
 * @returns Daemon instance with server, state, and shutdown function
 */
export async function startDaemon(options?: DaemonOptions | string): Promise<DaemonInstance> {
  // Handle backward compatibility with string argument
  const opts: DaemonOptions = typeof options === 'string'
    ? { projectRoot: options }
    : options || {};

  const socketPath = getSocketPath(opts.projectRoot);
  const state = createState();
  const clients: Set<ClientConnection> = new Set();

  // Setup logger
  const isForeground = opts.foreground !== false; // Default to foreground for backward compatibility
  const logPath = opts.logFile || getLogFilePath(socketPath);
  const logger: Logger = isForeground
    ? createForegroundLogger()
    : createFileLogger(logPath);

  // Clean up stale socket if it exists
  if (isSocketStale(socketPath)) {
    cleanupSocketFiles(socketPath);
  } else {
    throw new Error(`Daemon already running (socket: ${socketPath})`);
  }

  // Start periodic check for stuck tasks and disconnected workers
  const taskCheckInterval = setInterval(() => {
    try {
      checkWorkersAndTasks(state, logger);
    } catch (e) {
      logger.error(`Task check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, TASK_CHECK_INTERVAL_MS);

  // Unref the interval so it doesn't prevent process exit during tests
  taskCheckInterval.unref();

  // Create the server
  const server = net.createServer((socket) => {
    const client: ClientConnection = {
      socket,
      buffer: '',
      ownedWorkers: new Set(),
    };
    clients.add(client);

    logger.debug(`Client connected`);

    socket.on('data', async (data) => {
      try {
        // Track worker polling for connection lifecycle
        // Only associate workers with connections during poll_task (persistent connections)
        // NOT during register_worker (short-lived connections)
        const originalPollTask = toolHandlers.poll_task;
        toolHandlers.poll_task = (params: Record<string, unknown>, s: State) => {
          const name = params.name as string;
          const worker = s.workers.get(name) as ExtendedWorker | undefined;

          // Associate this connection with the worker when they start polling
          if (worker) {
            client.ownedWorkers.add(name);
            worker.ownerConnection = client;
            worker.disconnectedAt = undefined;
          }

          return originalPollTask(params, s);
        };

        await handleClientData(client, data, state);

        // Restore original handler
        toolHandlers.poll_task = originalPollTask;
      } catch (e) {
        logger.error(`Error handling client data: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    socket.on('error', (err) => {
      logger.error(`Client error: ${err.message}`);
      handleConnectionClose(client, state, logger);
      clients.delete(client);
    });

    socket.on('close', () => {
      logger.debug(`Client disconnected`);
      handleConnectionClose(client, state, logger);
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

  logger.info(`Listening on ${socketPath} (PID: ${process.pid})`);

  // Track signal handlers so we can remove them on shutdown
  let shuttingDown = false;
  const sigTermHandler = () => {
    if (!shuttingDown) {
      shuttingDown = true;
      logger.info('Received SIGTERM');
      shutdown().then(() => process.exit(0));
    }
  };
  const sigIntHandler = () => {
    if (!shuttingDown) {
      shuttingDown = true;
      logger.info('Received SIGINT');
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
    logger.info('Shutting down...');

    // Remove signal handlers to prevent memory leaks in tests
    process.removeListener('SIGTERM', sigTermHandler);
    process.removeListener('SIGINT', sigIntHandler);
    process.removeListener('exit', exitHandler);

    // Stop periodic task check
    clearInterval(taskCheckInterval);

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

    // 3. Cancel all blocked pollers with shutdown response
    for (const [name, poller] of state.blockedPollers) {
      clearTimeout(poller.timeout_id);
      // Resolve with null to signal shutdown
      poller.resolve(null);
    }
    state.blockedPollers.clear();

    // 4. Wait for active requests to complete (up to grace period)
    const activeRequestsCount = () => {
      let count = 0;
      for (const worker of state.workers.values()) {
        if (worker.status === 'executing') {
          count++;
        }
      }
      return count;
    };

    const shutdownStart = Date.now();
    while (activeRequestsCount() > 0) {
      const elapsed = Date.now() - shutdownStart;
      if (elapsed >= SHUTDOWN_GRACE_PERIOD_MS) {
        logger.warn(`Shutdown grace period exceeded, ${activeRequestsCount()} active requests abandoned`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 5. Force close remaining connections
    for (const client of clients) {
      try {
        client.socket.destroy();
      } catch {
        // Ignore destroy errors
      }
    }
    clients.clear();

    // 6. Clean up socket and PID files
    cleanupSocketFiles(socketPath);

    logger.info('Shutdown complete');
  };

  return {
    server,
    socketPath,
    state,
    logger,
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
