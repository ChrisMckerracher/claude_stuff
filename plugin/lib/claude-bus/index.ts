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

// Re-export worker discovery
export {
  getWorkerPattern,
  parseTmuxOutput,
  discoverWorkers,
  discoverAllWorkers,
} from './tmux.js';

// Re-export dispatch functions
export {
  escapeForShell,
  verifyPaneExists,
  dispatchToWorker,
  findFirstWorkerPane,
  WorkerPaneInfo,
} from './dispatch.js';

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
