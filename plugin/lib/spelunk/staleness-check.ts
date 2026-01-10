/**
 * Spelunk Staleness Check
 *
 * Functions for checking if existing spelunk documents are fresh or stale
 * by comparing stored source file hashes against current file hashes.
 *
 * See: docs/plans/architect/coding-agent-spelunking-mode.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LensType,
  DocStatus,
  StalenessCheckResult,
  StalenessIndex,
  LENS_DIRECTORIES,
  SPELUNK_DIRECTORIES,
} from './types';
import {
  readStalenessIndex,
  computeHash,
  getSpelunkDocPath,
  spelunkDocExists,
} from './persistence';

/**
 * Default base path for spelunk documentation
 */
const DEFAULT_SPELUNK_BASE = 'docs/spelunk';

/**
 * Check if a spelunk document exists and whether it's fresh or stale.
 *
 * Status definitions:
 * - FRESH: Doc exists, in index, all source file hashes match current
 * - STALE: Doc exists, but one or more source files have changed (hash mismatch)
 * - MISSING: No doc file exists for this lens+focus
 * - ORPHANED: Doc file exists but no entry in _staleness.json (corrupted state)
 *
 * @param lens - The lens type used for this spelunk
 * @param focus - The focus area being documented
 * @param projectRoot - Root directory of the project (optional, defaults to cwd)
 * @returns Promise resolving to StalenessCheckResult
 *
 * @example
 * const status = await checkStaleness('contracts', 'authentication layer');
 * if (status.status === 'FRESH') {
 *   const doc = await fs.readFile(status.docPath);
 * } else if (status.status === 'STALE') {
 *   console.log(`Stale due to: ${status.staleSources.join(', ')}`);
 * }
 */
export async function checkStaleness(
  lens: LensType,
  focus: string,
  projectRoot: string = process.cwd()
): Promise<StalenessCheckResult> {
  // Get the expected document path
  const { relative, absolute } = getSpelunkDocPath(lens, focus, projectRoot);

  // Check if the document file exists
  const docExists = await spelunkDocExists(lens, focus, projectRoot);

  if (!docExists) {
    return {
      status: 'MISSING',
      docPath: null,
      missingDoc: true,
      reason: `No spelunk document exists for lens "${lens}" and focus "${focus}"`,
    };
  }

  // Document exists, now check the staleness index
  const index = await readStalenessIndex(projectRoot);

  // Get the key used in the staleness index (relative to docs/spelunk/)
  const directory = LENS_DIRECTORIES[lens];
  const docKey = path.join(directory, path.basename(absolute));

  if (!index || !index.docs[docKey]) {
    return {
      status: 'ORPHANED',
      docPath: absolute,
      reason: `Document exists at "${absolute}" but has no entry in _staleness.json`,
    };
  }

  // Document exists and is in the index, now compare hashes
  const entry = index.docs[docKey];
  const staleSources: string[] = [];

  for (const [sourcePath, storedHash] of Object.entries(entry.source_files)) {
    const absoluteSourcePath = path.join(projectRoot, sourcePath);

    try {
      const currentHash = await computeHash(absoluteSourcePath);
      if (currentHash !== storedHash) {
        staleSources.push(sourcePath);
      }
    } catch (error) {
      // File doesn't exist anymore - it's been deleted, which makes the doc stale
      staleSources.push(sourcePath);
    }
  }

  if (staleSources.length > 0) {
    return {
      status: 'STALE',
      docPath: absolute,
      staleSources,
      reason: `${staleSources.length} source file(s) have changed: ${staleSources.join(', ')}`,
    };
  }

  return {
    status: 'FRESH',
    docPath: absolute,
    reason: `All ${Object.keys(entry.source_files).length} source file(s) are unchanged`,
  };
}

/**
 * Check staleness for multiple lenses with the same focus.
 *
 * Useful when an agent (like architect) needs to check both contracts/
 * and boundaries/ for a given focus area.
 *
 * @param lenses - Array of lens types to check
 * @param focus - The focus area being documented
 * @param projectRoot - Root directory of the project (optional, defaults to cwd)
 * @returns Map of lens type to staleness check result
 *
 * @example
 * const results = await checkMultipleLenses(['contracts', 'boundaries'], 'authentication');
 * for (const [lens, status] of results) {
 *   console.log(`${lens}: ${status.status}`);
 * }
 */
export async function checkMultipleLenses(
  lenses: LensType[],
  focus: string,
  projectRoot: string = process.cwd()
): Promise<Map<LensType, StalenessCheckResult>> {
  const results = new Map<LensType, StalenessCheckResult>();

  // Run all checks in parallel for efficiency
  const checks = await Promise.all(
    lenses.map(async (lens) => ({
      lens,
      result: await checkStaleness(lens, focus, projectRoot),
    }))
  );

  for (const { lens, result } of checks) {
    results.set(lens, result);
  }

  return results;
}

/**
 * Check all documents in a lens directory for staleness.
 *
 * Scans the specified lens directory and checks each document's staleness.
 * Useful for getting an overview of which docs need refreshing.
 *
 * @param lens - The lens type to scan
 * @param projectRoot - Root directory of the project (optional, defaults to cwd)
 * @returns Array of staleness check results for all docs in the lens
 *
 * @example
 * const results = await checkLensDirectory('contracts');
 * const staleCount = results.filter(r => r.status === 'STALE').length;
 * console.log(`${staleCount} documents need refreshing`);
 */
export async function checkLensDirectory(
  lens: LensType,
  projectRoot: string = process.cwd()
): Promise<StalenessCheckResult[]> {
  const directory = LENS_DIRECTORIES[lens];
  const lensPath = path.join(projectRoot, DEFAULT_SPELUNK_BASE, directory);

  // Check if the directory exists
  let files: string[];
  try {
    const entries = await fs.readdir(lensPath, { withFileTypes: true });
    files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name);
  } catch (error) {
    // Directory doesn't exist - return empty array
    return [];
  }

  // Read the staleness index once
  const index = await readStalenessIndex(projectRoot);

  const results: StalenessCheckResult[] = [];

  for (const fileName of files) {
    const docKey = path.join(directory, fileName);
    const absolutePath = path.join(lensPath, fileName);

    if (!index || !index.docs[docKey]) {
      // Document exists but not in index - orphaned
      results.push({
        status: 'ORPHANED',
        docPath: absolutePath,
        reason: `Document exists at "${absolutePath}" but has no entry in _staleness.json`,
      });
      continue;
    }

    // Check source file hashes
    const entry = index.docs[docKey];
    const staleSources: string[] = [];

    for (const [sourcePath, storedHash] of Object.entries(entry.source_files)) {
      const absoluteSourcePath = path.join(projectRoot, sourcePath);

      try {
        const currentHash = await computeHash(absoluteSourcePath);
        if (currentHash !== storedHash) {
          staleSources.push(sourcePath);
        }
      } catch (error) {
        // File doesn't exist anymore
        staleSources.push(sourcePath);
      }
    }

    if (staleSources.length > 0) {
      results.push({
        status: 'STALE',
        docPath: absolutePath,
        staleSources,
        reason: `${staleSources.length} source file(s) have changed: ${staleSources.join(', ')}`,
      });
    } else {
      results.push({
        status: 'FRESH',
        docPath: absolutePath,
        reason: `All ${Object.keys(entry.source_files).length} source file(s) are unchanged`,
      });
    }
  }

  return results;
}
