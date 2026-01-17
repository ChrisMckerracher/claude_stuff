/**
 * Beads CLI Client Wrapper
 *
 * Provides TypeScript functions to interact with the beads CLI (bd command).
 * Used by the claude-bus MCP server for task coordination.
 *
 * @module claude-bus/beads
 */

import { execSync } from 'child_process';

/**
 * Information about a bead (task)
 */
export interface BeadInfo {
  /** Unique bead identifier */
  id: string;
  /** Human-readable title */
  title: string;
  /** Current status (open, in_progress, blocked, closed) */
  status: string;
  /** Priority level (0-4, where 0 is highest) */
  priority: number;
}

/**
 * Result of validating a bead ID
 */
export interface ValidationResult {
  /** Whether the bead ID is valid and exists */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
}

/**
 * Raw bead data from bd show --json
 */
interface RawBeadData {
  id: string;
  title: string;
  status: string;
  priority: number;
  description?: string;
  issue_type?: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

/**
 * Execute a bd command and return stdout
 *
 * @param args - Command arguments to pass to bd
 * @returns stdout from the command
 * @throws Error if the command fails
 */
function execBd(args: string): string {
  try {
    return execSync(`bd ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error instanceof Error && 'stderr' in error) {
      const stderr = (error as { stderr: string }).stderr;
      throw new Error(`bd command failed: ${stderr || (error as Error).message}`);
    }
    throw error;
  }
}

/**
 * Validate that a bead ID exists and is accessible
 *
 * @param beadId - The bead ID to validate
 * @returns Validation result with valid flag and optional error
 */
export function validateBead(beadId: string): ValidationResult {
  if (!beadId || beadId.trim() === '') {
    return { valid: false, error: 'Bead ID is empty' };
  }

  try {
    execBd(`show ${beadId} --json`);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Bead not found: ${message}` };
  }
}

/**
 * Get information about a bead
 *
 * @param beadId - The bead ID to look up
 * @returns BeadInfo if found, null otherwise
 */
export function getBeadInfo(beadId: string): BeadInfo | null {
  if (!beadId || beadId.trim() === '') {
    return null;
  }

  try {
    const output = execBd(`show ${beadId} --json`);
    const parsed = JSON.parse(output);

    // bd show --json returns an array with one element
    const data: RawBeadData = Array.isArray(parsed) ? parsed[0] : parsed;

    if (!data || !data.id) {
      return null;
    }

    return {
      id: data.id,
      title: data.title || '',
      status: data.status || 'open',
      priority: typeof data.priority === 'number' ? data.priority : 2,
    };
  } catch {
    return null;
  }
}

/**
 * Set a bead's status to in_progress
 *
 * @param beadId - The bead ID to update
 * @throws Error if the update fails
 */
export function beadSetInProgress(beadId: string): void {
  if (!beadId || beadId.trim() === '') {
    throw new Error('Bead ID is required');
  }

  execBd(`update ${beadId} --status in_progress`);
}

/**
 * Mark a bead as blocked with a reason
 *
 * @param beadId - The bead ID to update
 * @param reason - The reason the bead is blocked
 * @throws Error if the update fails
 */
export function beadMarkBlocked(beadId: string, reason: string): void {
  if (!beadId || beadId.trim() === '') {
    throw new Error('Bead ID is required');
  }

  // Update status to blocked and add reason to notes
  execBd(`update ${beadId} --status blocked --notes "${reason.replace(/"/g, '\\"')}"`);
}

/**
 * Close a bead with a reason
 *
 * @param beadId - The bead ID to close
 * @param reason - The reason for closing
 * @throws Error if the close fails
 */
export function beadClose(beadId: string, reason: string): void {
  if (!beadId || beadId.trim() === '') {
    throw new Error('Bead ID is required');
  }

  execBd(`close ${beadId} --reason "${reason.replace(/"/g, '\\"')}"`);
}
