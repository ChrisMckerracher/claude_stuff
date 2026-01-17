/**
 * Claude Bus Module
 *
 * MCP server components for multi-instance Claude Code coordination.
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

// Legacy tmux discovery and dispatch functions have been removed.
// All workers now use polling-based dispatch (register_worker + poll_task + ack_task).
// See: docs/plans/architect/claude-bus-polling.md

// Re-export server
export { createClaudeBusServer, startServer } from './server.js';

// Re-export IPC functions
export {
  getSocketPath,
  startIpcServer,
  sendIpcMessage,
  notifyWorkerDone,
  notifyTaskFailed,
  isBusRunning,
  IpcRequest,
  IpcResponse,
  IpcMessageType,
  IpcHandler,
} from './ipc.js';
