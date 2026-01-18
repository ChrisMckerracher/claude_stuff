#!/usr/bin/env node
/**
 * Claude Bus CLI Entry Point
 *
 * Run the MCP client that connects to the external daemon.
 * Claude Code spawns this via the mcpServers config.
 *
 * The daemon is automatically started if not already running.
 *
 * Usage:
 *   claude-bus serve              # Start the MCP client (connects to daemon)
 *   claude-bus daemon             # Run daemon in foreground
 *   claude-bus start              # Start daemon in background
 *   claude-bus stop               # Stop running daemon
 *   claude-bus status             # Show daemon status for current project
 *   claude-bus list               # List all running daemons
 *   claude-bus stop-all           # Stop all running daemons
 *   claude-bus notify-done <id>   # Notify bus that a task is complete
 *   claude-bus notify-failed <id> <reason>  # Notify bus that a task failed
 *
 * @module claude-bus/cli
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { startClientMode } from './server.js';
import { ensureDaemon, forwardToolCall, isDaemonRunning as clientIsDaemonRunning } from './client.js';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
  isDaemonRunning,
  getSocketPath,
  getPidFilePath,
  isSocketStale,
} from './daemon.js';

const command = process.argv[2];

/**
 * Find all socket files matching the claude-bus pattern in /tmp.
 * Returns array of socket paths.
 */
function findAllSockets(): string[] {
  const tmpDir = '/tmp';
  const socketPattern = /^claude-bus-[a-f0-9]{8}\.sock$/;

  try {
    const files = fs.readdirSync(tmpDir);
    return files
      .filter((f) => socketPattern.test(f))
      .map((f) => path.join(tmpDir, f));
  } catch {
    return [];
  }
}

/**
 * Get status info for a socket file.
 */
function getSocketInfo(socketPath: string): {
  socketPath: string;
  running: boolean;
  pid?: number;
  stale: boolean;
} {
  const pidFile = getPidFilePath(socketPath);
  const stale = isSocketStale(socketPath);

  if (stale) {
    return { socketPath, running: false, stale: true };
  }

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    return { socketPath, running: true, pid, stale: false };
  } catch {
    return { socketPath, running: true, stale: false };
  }
}

/**
 * Stop a daemon by its socket path.
 */
function stopDaemonBySocket(socketPath: string): boolean {
  const pidFile = getPidFilePath(socketPath);

  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    if (!isNaN(pid)) {
      process.kill(pid, 'SIGTERM');
      return true;
    }
  } catch {
    // Could not read PID or send signal
  }

  return false;
}

async function main(): Promise<void> {
  switch (command) {
    case 'serve':
    case undefined: {
      // Ensure daemon is running (auto-start if needed)
      try {
        const socket = await ensureDaemon();
        socket.destroy(); // Close the test connection
        console.error('[claude-bus] Daemon ready, starting MCP client');
      } catch (e) {
        console.error(
          `[claude-bus] Failed to start daemon: ${e instanceof Error ? e.message : String(e)}`
        );
        process.exit(1);
      }

      // Start MCP client mode that forwards to daemon
      await startClientMode();
      break;
    }

    case 'daemon': {
      // Run daemon in foreground - keeps running until SIGTERM/SIGINT
      console.error('[claude-bus] Starting daemon in foreground...');
      try {
        const daemon = await startDaemon();
        console.error(`[claude-bus] Daemon started at ${daemon.socketPath}`);
        // Keep running - daemon handles SIGTERM/SIGINT
      } catch (e) {
        console.error(`[claude-bus] Failed to start daemon: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
      break;
    }

    case 'start': {
      // Start daemon in background
      const socketPath = getSocketPath();

      // Check if already running
      if (isDaemonRunning()) {
        const status = getDaemonStatus();
        console.log(`Bus daemon already running (PID: ${status.pid}) at ${socketPath}`);
        break;
      }

      // Spawn daemon process detached
      // Use process.argv[1] to get the path to the current script
      const scriptPath = process.argv[1];
      const child = spawn(process.execPath, [scriptPath, 'daemon'], {
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.unref();

      // Wait for socket to appear (with retries)
      const maxRetries = 20;
      const retryDelay = 250;
      let started = false;

      for (let i = 0; i < maxRetries; i++) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        if (isDaemonRunning()) {
          started = true;
          break;
        }
      }

      if (started) {
        const status = getDaemonStatus();
        console.log(`Bus daemon started (PID: ${status.pid}) at ${socketPath}`);
      } else {
        console.error('Failed to start daemon (timeout waiting for socket)');
        process.exit(1);
      }
      break;
    }

    case 'stop': {
      // Stop running daemon for current project
      const socketPath = getSocketPath();

      if (!isDaemonRunning()) {
        console.log('Bus daemon is not running');
        break;
      }

      const status = getDaemonStatus();
      const stopped = stopDaemon();

      if (stopped) {
        console.log(`Bus daemon stopped (was PID: ${status.pid}) at ${socketPath}`);
      } else {
        console.error('Failed to stop daemon');
        process.exit(1);
      }
      break;
    }

    case 'status': {
      // Show daemon status for current project
      const status = getDaemonStatus();

      if (status.running) {
        console.log('Bus daemon status: running');
        console.log(`  PID: ${status.pid}`);
        console.log(`  Socket: ${status.socketPath}`);

        // Calculate uptime if we can read process start time
        if (status.pid) {
          try {
            // On macOS/Linux, we can get process start time
            const procStat = fs.statSync(`/proc/${status.pid}`);
            const uptimeMs = Date.now() - procStat.ctimeMs;
            const uptimeSec = Math.floor(uptimeMs / 1000);
            const hours = Math.floor(uptimeSec / 3600);
            const minutes = Math.floor((uptimeSec % 3600) / 60);
            const seconds = uptimeSec % 60;
            console.log(`  Uptime: ${hours}h ${minutes}m ${seconds}s`);
          } catch {
            // /proc not available (macOS) - skip uptime
          }
        }
      } else {
        console.log('Bus daemon status: not running');
        console.log(`  Socket: ${status.socketPath}`);
        process.exit(1);
      }
      break;
    }

    case 'list': {
      // List all running daemons
      const sockets = findAllSockets();

      if (sockets.length === 0) {
        console.log('No bus daemons found');
        break;
      }

      console.log('Bus daemons:');
      for (const socketPath of sockets) {
        const info = getSocketInfo(socketPath);
        if (info.running) {
          console.log(`  [running] ${socketPath} (PID: ${info.pid ?? 'unknown'})`);
        } else if (info.stale) {
          console.log(`  [stale]   ${socketPath}`);
        }
      }
      break;
    }

    case 'stop-all': {
      // Stop all running daemons
      const sockets = findAllSockets();

      if (sockets.length === 0) {
        console.log('No bus daemons found');
        break;
      }

      let stopped = 0;
      let cleaned = 0;

      for (const socketPath of sockets) {
        const info = getSocketInfo(socketPath);

        if (info.running && info.pid) {
          const success = stopDaemonBySocket(socketPath);
          if (success) {
            console.log(`Stopped daemon at ${socketPath} (PID: ${info.pid})`);
            stopped++;
          } else {
            console.error(`Failed to stop daemon at ${socketPath}`);
          }
        } else if (info.stale) {
          // Clean up stale socket files
          try {
            fs.unlinkSync(socketPath);
            const pidFile = getPidFilePath(socketPath);
            if (fs.existsSync(pidFile)) {
              fs.unlinkSync(pidFile);
            }
            console.log(`Cleaned up stale socket: ${socketPath}`);
            cleaned++;
          } catch {
            // Ignore cleanup errors
          }
        }
      }

      console.log(`Stopped ${stopped} daemon(s), cleaned up ${cleaned} stale socket(s)`);
      break;
    }

    case 'notify-done': {
      const beadId = process.argv[3];
      if (!beadId) {
        console.error('Usage: claude-bus notify-done <bead_id>');
        process.exit(1);
      }
      try {
        const response = await forwardToolCall('worker_done', { bead_id: beadId });
        const result = response as { success: boolean; bead_id: string; worker?: string };
        if (result.success) {
          console.log(`Notified bus: task ${beadId} complete`);
        } else {
          console.error(`Bus notification failed`);
        }
      } catch (e) {
        // Daemon not running - this is expected and OK
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
        const response = await forwardToolCall('task_failed', {
          bead_id: beadId,
          reason: reason,
        });
        const result = response as { success: boolean };
        if (result.success) {
          console.log(`Notified bus: task ${beadId} failed - ${reason}`);
        } else {
          console.error(`Bus notification failed`);
        }
      } catch (e) {
        console.error(`Bus not available: ${e instanceof Error ? e.message : String(e)}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Usage:');
      console.error('  claude-bus serve              # Start the MCP client (auto-starts daemon)');
      console.error('  claude-bus daemon             # Run daemon in foreground');
      console.error('  claude-bus start              # Start daemon in background');
      console.error('  claude-bus stop               # Stop running daemon');
      console.error('  claude-bus status             # Show daemon status');
      console.error('  claude-bus list               # List all running daemons');
      console.error('  claude-bus stop-all           # Stop all running daemons');
      console.error('  claude-bus notify-done <id>   # Notify task complete');
      console.error('  claude-bus notify-failed <id> <reason>  # Notify task failed');
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error('Error:', error);
  process.exit(1);
});
