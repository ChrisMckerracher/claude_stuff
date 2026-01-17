#!/usr/bin/env node
/**
 * Claude Bus CLI Entry Point
 *
 * Run the MCP server as a standalone process.
 * Claude Code spawns this via the mcpServers config.
 *
 * Usage:
 *   claude-bus serve              # Start the MCP server (stdio transport)
 *   claude-bus notify-done <id>   # Notify bus that a task is complete
 *   claude-bus notify-failed <id> <reason>  # Notify bus that a task failed
 *   claude-bus status             # Check if bus is running
 *
 * @module claude-bus/cli
 */

import { startServer } from './server.js';
import { notifyWorkerDone, notifyTaskFailed, isBusRunning } from './ipc.js';

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'serve':
    case undefined:
      // Start the MCP server
      await startServer();
      break;

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
