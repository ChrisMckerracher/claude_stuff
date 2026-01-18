/**
 * Claude Bus Module
 *
 * MCP server components for multi-instance Claude Code coordination.
 *
 * Architecture:
 * - daemon.ts: External daemon process that owns state
 * - client.ts: Connection management with auto-start and retry
 * - server.ts: Thin MCP client that forwards to daemon
 *
 * @module claude-bus
 */

// Re-export beads client
export {
  BeadInfo,
  ValidationResult,
  validateBead,
  beadSetInProgress,
  beadMarkBlocked,
  beadClose,
  getBeadInfo,
} from './beads.js';

// Re-export types
export {
  Worker,
  State,
  createState,
  SubmitTaskResponse,
  WorkerDoneResponse,
  GetStatusResponse,
  ResetWorkerResponse,
  RetryTaskResponse,
  TaskFailedResponse,
} from './types.js';

// Re-export worker selection
export { selectWorker } from './selection.js';

// Re-export MCP server (client mode only)
export { startClientMode, TOOL_SCHEMAS, jsonResponse } from './server.js';

// Re-export client functions
export {
  ensureDaemon,
  forwardToolCall,
  isDaemonRunning as isClientConnected,
} from './client.js';

// Re-export daemon functions
export {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  isDaemonRunning,
  getSocketPath,
  getPidFilePath,
  isSocketStale,
  type DaemonInstance,
  type DaemonRequest,
  type DaemonResponse,
  type DaemonSuccessResponse,
  type DaemonErrorResponse,
  type DaemonErrorCode,
} from './daemon.js';

// Re-export IPC functions (for backward compatibility)
export {
  getSocketPath as getIpcSocketPath,
  sendIpcMessage,
  notifyWorkerDone,
  notifyTaskFailed,
  isBusRunning,
  IpcRequest,
  IpcResponse,
  IpcMessageType,
  IpcHandler,
} from './ipc.js';
