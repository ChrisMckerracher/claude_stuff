/**
 * File Finding Utilities for Spelunking Mode
 *
 * Extracted from lsp-executor.ts for shared use across planner and fallback executors.
 */

import * as path from 'path';
import { promisify } from 'util';
import globCallback from 'glob';
import type { LensSpec } from './lens-specs';

// Promisify glob for async usage with glob 7.x
const glob = promisify(globCallback);

/**
 * Find files matching entry point patterns for a lens
 */
export async function findEntryPointFiles(
  patterns: string[],
  projectRoot: string,
  maxFiles: number
): Promise<string[]> {
  const files: string[] = [];

  for (const pattern of patterns) {
    if (files.length >= maxFiles) {
      break;
    }

    try {
      const matches = await glob(pattern, {
        cwd: projectRoot,
        absolute: true,
        nodir: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**'],
      });

      for (const match of matches) {
        if (files.length >= maxFiles) {
          break;
        }
        if (!files.includes(match)) {
          files.push(match);
        }
      }
    } catch {
      // Skip invalid patterns
    }
  }

  return files;
}

/**
 * Find files in the focus area based on lens specifications
 */
export async function findFilesInFocus(
  focus: string,
  lensSpec: LensSpec,
  projectRoot: string,
  maxFiles: number
): Promise<string[]> {
  // First, try to interpret focus as a directory or file pattern
  const focusPatterns = [
    `**/${focus}/**/*.{ts,tsx,js,jsx,py,go,rs,java}`,
    `**/*${focus}*/**/*.{ts,tsx,js,jsx,py,go,rs,java}`,
    `**/*${focus}*.{ts,tsx,js,jsx,py,go,rs,java}`,
    `src/**/${focus}/**/*.{ts,tsx,js,jsx,py,go,rs,java}`,
  ];

  // Add lens-specific entry point patterns if available
  if (lensSpec.lsp.entryPointPatterns) {
    focusPatterns.push(...lensSpec.lsp.entryPointPatterns);
  }

  // Also add grep patterns file globs
  if (lensSpec.grepPatterns.fileGlobs.length > 0) {
    for (const globPattern of lensSpec.grepPatterns.fileGlobs) {
      focusPatterns.push(`**/${globPattern}`);
    }
  }

  return findEntryPointFiles(focusPatterns, projectRoot, maxFiles);
}

/**
 * Check if a path refers to a directory (vs file)
 */
export function isDirectory(filePath: string): boolean {
  try {
    const stats = require('fs').statSync(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Convert a file path to a file URI
 */
export function pathToUri(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  return `file://${absolutePath.replace(/%/g, '%25').replace(/\\/g, '/')}`;
}

/**
 * Convert a file URI to a file path
 */
export function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    const decoded = decodeURIComponent(uri.slice(7));
    return decoded.replace(/^([A-Za-z]):\//, '$1:/'); // Handle Windows drive letters
  }
  return uri;
}

/**
 * Convert a focus string to a slug for file naming
 */
export function focusToSlug(focus: string): string {
  const slug = focus
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, MAX_SLUG_LENGTH);

  // Add hash suffix if truncated
  if (focus.length > MAX_SLUG_LENGTH) {
    const hash = Buffer.from(focus).toString('base64').substring(0, 4);
    return `${slug}-${hash}`;
  }

  return slug;
}

const MAX_SLUG_LENGTH = 50;
