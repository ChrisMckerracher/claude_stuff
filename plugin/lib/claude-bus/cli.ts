#!/usr/bin/env node
/**
 * Claude Bus CLI Entry Point
 *
 * Run the MCP server as a standalone process.
 * Claude Code spawns this via the mcpServers config.
 *
 * Singleton behavior: First instance for a codebase becomes the server.
 * Subsequent instances connect as clients and proxy MCP calls via IPC.
 *
 * Usage:
 *   claude-bus serve              # Start the MCP server (stdio transport)
 *   claude-bus notify-done <id>   # Notify bus that a task is complete
 *   claude-bus notify-failed <id> <reason>  # Notify bus that a task failed
 *   claude-bus status             # Check if bus is running
 *
 * @module claude-bus/cli
 */

import { startServer, startClientMode, EADDRINUSE } from './server.js';
import { notifyWorkerDone, notifyTaskFailed, isBusRunning, tryConnectToServer } from './ipc.js';

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'serve':
    case undefined: {
      // Singleton detection: check if a server already exists for this codebase
      const existingServer = await tryConnectToServer();

      if (existingServer) {
        // Server already running - run as client, proxying MCP calls via IPC
        existingServer.destroy(); // Close test connection
        console.error('[claude-bus] Server already running, starting as client');
        await startClientMode();
      } else {
        // No server running - try to become the server
        // Race condition handling: if another process wins the race and creates
        // the socket first, we'll get EADDRINUSE and fall back to client mode
        try {
          console.error('[claude-bus] Starting as server');
          await startServer();
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code === EADDRINUSE) {
            // Another process won the race - fall back to client mode
            console.error('[claude-bus] Server race lost, starting as client');
            await startClientMode();
          } else {
            throw err;
          }
        }
      }
      break;
    }

    case 'notify-done': {
      const beadId = process.argv[3];
      if (!beadId) {
        console.error('Usage: claude-bus notify-done <bead_id>');
        process.exit(1);
      }
      try {
        const response = await notifyWorkerDone(beadId);
        if (response.success) {
          console.log(`Notified bus: task ${beadId} complete`);
        } else {
          console.error(`Bus notification failed: ${response.error}`);
          // Exit 0 even on failure - notification is non-blocking
        }
      } catch (e) {
        // Bus not running - this is expected and OK
        console.error(`Bus not available: ${e instanceof Error ? e.message : String(e)}`);
        // Exit 0 - notification is non-blocking
      }
      break;
    }

    case 'notify-failed': {
      const beadId = process.argv[3];
      const reason = process.argv.slice(4).join(' ');
      if (!beadId || !reason) {
        console.error('Usage: claude-bus notify-failed <bead_id> <reason>');
        process.exit(1);
      }
      try {
        const response = await notifyTaskFailed(beadId, reason);
        if (response.success) {
          console.log(`Notified bus: task ${beadId} failed - ${reason}`);
        } else {
          console.error(`Bus notification failed: ${response.error}`);
        }
      } catch (e) {
        console.error(`Bus not available: ${e instanceof Error ? e.message : String(e)}`);
      }
      break;
    }

    case 'status': {
      const running = await isBusRunning();
      if (running) {
        console.log('Bus is running');
      } else {
        console.log('Bus is not running');
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage:');
      console.error('  claude-bus serve              # Start the MCP server');
      console.error('  claude-bus notify-done <id>   # Notify task complete');
      console.error('  claude-bus notify-failed <id> <reason>  # Notify task failed');
      console.error('  claude-bus status             # Check if bus is running');
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Error:', error);
  process.exit(1);
});
