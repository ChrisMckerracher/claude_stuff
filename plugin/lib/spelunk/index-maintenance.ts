/**
 * Spelunk Index Maintenance
 *
 * Functions for generating and maintaining the _index.md file that provides
 * a human-readable index of all spelunk documentation organized by lens.
 *
 * See: docs/plans/architect/coding-agent-spelunking-mode.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LensType,
  DocStatus,
  StalenessIndex,
  SPELUNK_DIRECTORIES,
} from './types';
import {
  readStalenessIndex,
  computeHash,
  ensureDirectoryStructure,
} from './persistence';

/**
 * Default base path for spelunk documentation
 */
const DEFAULT_SPELUNK_BASE = 'docs/spelunk';

/**
 * Lens display names for the index
 */
const LENS_DISPLAY_NAMES: Record<string, string> = {
  contracts: 'Contracts',
  flows: 'Flows',
  boundaries: 'Boundaries',
  'trust-zones': 'Trust Zones',
};

/**
 * Status emoji indicators
 */
const STATUS_EMOJI: Record<DocStatus, string> = {
  FRESH: '🟢',
  STALE: '🟡',
  MISSING: '⚪',
  ORPHANED: '🔴',
};

/**
 * Entry for a spelunk document in the index
 */
export interface IndexEntry {
  lens: string;
  focus: string;
  relativePath: string;
  status: DocStatus;
  generated: string;
  sourceFileCount: number;
}

/**
 * Parse frontmatter from a spelunk document to extract focus.
 */
async function parseFrontmatter(
  filePath: string
): Promise<{ focus: string; generated: string } | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = frontmatterMatch[1];
    const focusMatch = frontmatter.match(/^focus:\s*"(.+)"$/m);
    const generatedMatch = frontmatter.match(/^generated:\s*(.+)$/m);

    return {
      focus: focusMatch ? focusMatch[1] : path.basename(filePath, '.md'),
      generated: generatedMatch ? generatedMatch[1] : '',
    };
  } catch {
    return null;
  }
}

/**
 * Check staleness status for a document.
 */
async function checkDocStatus(
  docKey: string,
  index: StalenessIndex | null,
  projectRoot: string
): Promise<{ status: DocStatus; sourceFileCount: number }> {
  if (!index || !index.docs[docKey]) {
    return { status: 'ORPHANED', sourceFileCount: 0 };
  }

  const entry = index.docs[docKey];
  const sourceFiles = entry.source_files;
  const sourceFileCount = Object.keys(sourceFiles).length;

  // Check each source file hash
  for (const [sourcePath, storedHash] of Object.entries(sourceFiles)) {
    const absoluteSourcePath = path.join(projectRoot, sourcePath);
    try {
      const currentHash = await computeHash(absoluteSourcePath);
      if (currentHash !== storedHash) {
        return { status: 'STALE', sourceFileCount };
      }
    } catch {
      // File doesn't exist - stale
      return { status: 'STALE', sourceFileCount };
    }
  }

  return { status: 'FRESH', sourceFileCount };
}

/**
 * Get all index entries for spelunk documents.
 *
 * Scans all lens directories and returns metadata for each document,
 * including its freshness status.
 *
 * @param projectRoot - Root directory of the project
 * @returns Array of index entries sorted by lens then focus
 */
export async function getIndexEntries(
  projectRoot: string = process.cwd()
): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  const index = await readStalenessIndex(projectRoot);

  // Scan each lens directory (skip 'state' which is internal)
  const lensDirectories = SPELUNK_DIRECTORIES.filter((d) => d !== 'state');

  for (const lensDir of lensDirectories) {
    const lensPath = path.join(projectRoot, DEFAULT_SPELUNK_BASE, lensDir);

    let files: string[];
    try {
      const dirEntries = await fs.readdir(lensPath, { withFileTypes: true });
      files = dirEntries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    } catch {
      // Directory doesn't exist or is empty
      continue;
    }

    for (const fileName of files) {
      const docKey = path.join(lensDir, fileName);
      const absolutePath = path.join(lensPath, fileName);

      // Parse frontmatter to get focus
      const frontmatter = await parseFrontmatter(absolutePath);
      if (!frontmatter) {
        continue;
      }

      // Check staleness
      const { status, sourceFileCount } = await checkDocStatus(
        docKey,
        index,
        projectRoot
      );

      entries.push({
        lens: lensDir,
        focus: frontmatter.focus,
        relativePath: docKey,
        status,
        generated: frontmatter.generated,
        sourceFileCount,
      });
    }
  }

  // Sort by lens then by focus alphabetically
  entries.sort((a, b) => {
    if (a.lens !== b.lens) {
      return a.lens.localeCompare(b.lens);
    }
    return a.focus.localeCompare(b.focus);
  });

  return entries;
}

/**
 * Generate the _index.md content.
 *
 * Creates a human-readable markdown index of all spelunk documentation,
 * organized by lens with freshness indicators and statistics.
 *
 * @param projectRoot - Root directory of the project
 * @returns Markdown content for _index.md
 */
export async function generateIndex(
  projectRoot: string = process.cwd()
): Promise<string> {
  const entries = await getIndexEntries(projectRoot);
  const timestamp = new Date().toISOString();

  const lines: string[] = [
    '# Spelunking Documentation Index',
    '',
    `Last updated: ${timestamp}`,
    '',
    '## By Lens',
    '',
  ];

  // Group entries by lens
  const byLens = new Map<string, IndexEntry[]>();
  for (const entry of entries) {
    const existing = byLens.get(entry.lens) || [];
    existing.push(entry);
    byLens.set(entry.lens, existing);
  }

  // Generate section for each lens (in defined order)
  const lensOrder = ['contracts', 'flows', 'boundaries', 'trust-zones'];
  for (const lens of lensOrder) {
    const displayName = LENS_DISPLAY_NAMES[lens] || lens;
    lines.push(`### ${displayName}`);

    const lensEntries = byLens.get(lens) || [];
    if (lensEntries.length === 0) {
      lines.push('(empty)');
    } else {
      lines.push('| Focus | Status | Generated | Source Files |');
      lines.push('|-------|--------|-----------|--------------|');

      for (const entry of lensEntries) {
        const emoji = STATUS_EMOJI[entry.status];
        const dateStr = entry.generated
          ? entry.generated.split('T')[0]
          : 'unknown';
        const link = `[${entry.focus}](${entry.relativePath})`;
        lines.push(
          `| ${link} | ${emoji} ${entry.status} | ${dateStr} | ${entry.sourceFileCount} files |`
        );
      }
    }
    lines.push('');
  }

  // Statistics
  lines.push('## Statistics');

  const total = entries.length;
  const fresh = entries.filter((e) => e.status === 'FRESH').length;
  const stale = entries.filter((e) => e.status === 'STALE').length;
  const orphaned = entries.filter((e) => e.status === 'ORPHANED').length;

  const freshPct = total > 0 ? Math.round((fresh / total) * 100) : 0;
  const stalePct = total > 0 ? Math.round((stale / total) * 100) : 0;
  const orphanedPct = total > 0 ? Math.round((orphaned / total) * 100) : 0;

  lines.push(`- Total documents: ${total}`);
  lines.push(`- Fresh: ${fresh} (${freshPct}%)`);
  lines.push(`- Stale: ${stale} (${stalePct}%)`);
  lines.push(`- Orphaned: ${orphaned} (${orphanedPct}%)`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Update the _index.md file.
 *
 * Generates the index content and writes it to docs/spelunk/_index.md.
 * Call this after spelunk operations (e.g., after generateReport).
 *
 * @param projectRoot - Root directory of the project
 */
export async function updateIndex(
  projectRoot: string = process.cwd()
): Promise<void> {
  // Ensure directory structure exists
  await ensureDirectoryStructure(projectRoot);

  const content = await generateIndex(projectRoot);
  const indexPath = path.join(projectRoot, DEFAULT_SPELUNK_BASE, '_index.md');

  await fs.writeFile(indexPath, content, 'utf-8');
}
