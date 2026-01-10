/**
 * Spelunk Persistence Layer
 *
 * Functions for writing spelunk findings to docs/spelunk/ and managing
 * the staleness index for cross-session, cross-agent reuse.
 *
 * See: docs/plans/architect/coding-agent-spelunking-mode.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  LensType,
  ToolChain,
  SpelunkFrontmatter,
  StalenessIndex,
  StalenessDocEntry,
  SourceFileEntry,
  LENS_DIRECTORIES,
  SPELUNK_DIRECTORIES,
  MAX_SLUG_LENGTH,
  HASH_LENGTH,
} from './types';

/**
 * Default base path for spelunk documentation
 */
const DEFAULT_SPELUNK_BASE = 'docs/spelunk';

/**
 * Convert a focus string to a file slug.
 *
 * Rules:
 * 1. Convert to lowercase
 * 2. Replace spaces and special chars with hyphens
 * 3. Remove consecutive hyphens
 * 4. Truncate to MAX_SLUG_LENGTH chars (50), adding hash suffix if truncated
 *
 * @param focus - The focus area string (e.g., "authentication layer")
 * @returns Slug for file naming (e.g., "authentication-layer")
 *
 * @example
 * toSlug("authentication layer") // "authentication-layer"
 * toSlug("User Onboarding Flow") // "user-onboarding-flow"
 * toSlug("checkout process including cart validation and payment") // "checkout-process-including-cart-validat-a3f2"
 */
export function toSlug(focus: string): string {
  // Convert to lowercase and replace non-alphanumeric chars with hyphens
  let slug = focus
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens

  // If slug is too long, truncate and add hash suffix
  if (slug.length > MAX_SLUG_LENGTH) {
    // Create a short hash of the full focus string for uniqueness
    const hash = crypto
      .createHash('sha256')
      .update(focus)
      .digest('hex')
      .slice(0, 4);

    // Truncate slug to make room for the hash suffix (-XXXX = 5 chars)
    const truncateLength = MAX_SLUG_LENGTH - 5;
    slug = slug.slice(0, truncateLength).replace(/-+$/, '') + '-' + hash;
  }

  return slug;
}

/**
 * Compute the SHA-256 hash of a file's contents.
 *
 * Returns the first HASH_LENGTH (8) characters of the hex-encoded hash,
 * matching the format used in _staleness.json.
 *
 * @param filePath - Absolute path to the file
 * @returns First 8 characters of the SHA-256 hash
 * @throws Error if file cannot be read
 *
 * @example
 * await computeHash("/path/to/file.ts") // "a1b2c3d4"
 */
export async function computeHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  const fullHash = crypto.createHash('sha256').update(content).digest('hex');
  return fullHash.slice(0, HASH_LENGTH);
}

/**
 * Ensure the docs/spelunk/ directory structure exists.
 *
 * Creates the following directories if they don't exist:
 * - docs/spelunk/contracts/
 * - docs/spelunk/flows/
 * - docs/spelunk/boundaries/
 * - docs/spelunk/trust-zones/
 * - docs/spelunk/state/
 *
 * @param projectRoot - Root directory of the project (optional, defaults to cwd)
 *
 * @example
 * await ensureDirectoryStructure() // Creates structure in current working directory
 * await ensureDirectoryStructure("/path/to/project")
 */
export async function ensureDirectoryStructure(
  projectRoot: string = process.cwd()
): Promise<void> {
  const spelunkBase = path.join(projectRoot, DEFAULT_SPELUNK_BASE);

  for (const dir of SPELUNK_DIRECTORIES) {
    const dirPath = path.join(spelunkBase, dir);
    await fs.mkdir(dirPath, { recursive: true });
  }
}

/**
 * Generate YAML frontmatter for a spelunk document.
 *
 * @param frontmatter - Frontmatter data
 * @returns YAML frontmatter string with --- delimiters
 */
function generateFrontmatter(frontmatter: SpelunkFrontmatter): string {
  const lines = [
    '---',
    `lens: ${frontmatter.lens}`,
    `focus: "${frontmatter.focus}"`,
    `generated: ${frontmatter.generated}`,
    'source_files:',
  ];

  for (const file of frontmatter.source_files) {
    lines.push(`  - path: ${file.path}`);
    lines.push(`    hash: ${file.hash}`);
  }

  lines.push(`tool_chain: ${frontmatter.tool_chain}`);
  lines.push('---');

  return lines.join('\n');
}

/**
 * Write a spelunk document with frontmatter to the appropriate directory.
 *
 * @param lens - The lens type used for this spelunk
 * @param focus - The focus area being documented
 * @param content - The markdown content (without frontmatter)
 * @param sourceFiles - Array of source file paths that were analyzed
 * @param options - Additional options
 * @returns Absolute path to the written document
 *
 * @example
 * await writeSpelunkDoc(
 *   'interfaces',
 *   'authentication layer',
 *   '# Authentication Layer\n\n...',
 *   ['src/auth/handler.ts', 'src/auth/types.ts'],
 *   { toolChain: 'lsp' }
 * )
 */
export async function writeSpelunkDoc(
  lens: LensType,
  focus: string,
  content: string,
  sourceFiles: string[],
  options: {
    projectRoot?: string;
    toolChain?: ToolChain;
  } = {}
): Promise<string> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const toolChain = options.toolChain ?? 'grep-fallback';

  // Ensure directory structure exists
  await ensureDirectoryStructure(projectRoot);

  // Compute hashes for all source files
  const sourceFileEntries: SourceFileEntry[] = [];
  for (const filePath of sourceFiles) {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(projectRoot, filePath);

    try {
      const hash = await computeHash(absolutePath);
      // Store relative path in the doc
      const relativePath = path.isAbsolute(filePath)
        ? path.relative(projectRoot, filePath)
        : filePath;
      sourceFileEntries.push({ path: relativePath, hash });
    } catch (error) {
      // If file doesn't exist or can't be read, skip it
      console.warn(`Warning: Could not hash source file: ${filePath}`);
    }
  }

  // Generate frontmatter
  const frontmatter: SpelunkFrontmatter = {
    lens,
    focus,
    generated: new Date().toISOString(),
    source_files: sourceFileEntries,
    tool_chain: toolChain,
  };

  // Determine output path
  const directory = LENS_DIRECTORIES[lens];
  const slug = toSlug(focus);
  const fileName = `${slug}.md`;
  const relativePath = path.join(DEFAULT_SPELUNK_BASE, directory, fileName);
  const absolutePath = path.join(projectRoot, relativePath);

  // Combine frontmatter and content
  const fullContent = `${generateFrontmatter(frontmatter)}\n\n${content}`;

  // Write the document
  await fs.writeFile(absolutePath, fullContent, 'utf-8');

  // Update the staleness index
  const sourceFileHashes: Record<string, string> = {};
  for (const entry of sourceFileEntries) {
    sourceFileHashes[entry.path] = entry.hash;
  }

  const docRelativePath = path.join(directory, fileName);
  await updateStalenessIndex(docRelativePath, sourceFileHashes, { projectRoot });

  return absolutePath;
}

/**
 * Update the _staleness.json index with a document's metadata.
 *
 * Creates the index file if it doesn't exist. Merges with existing
 * entries to preserve information about other documents.
 *
 * @param docPath - Relative path from docs/spelunk/ (e.g., "contracts/auth.md")
 * @param sourceFiles - Map of source file paths to their hashes
 * @param options - Additional options
 *
 * @example
 * await updateStalenessIndex(
 *   'contracts/authentication-layer.md',
 *   { 'src/auth/handler.ts': 'a1b2c3d4' }
 * )
 */
export async function updateStalenessIndex(
  docPath: string,
  sourceFiles: Record<string, string>,
  options: { projectRoot?: string } = {}
): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const stalenessPath = path.join(
    projectRoot,
    DEFAULT_SPELUNK_BASE,
    '_staleness.json'
  );

  // Load existing index or create new one
  let index: StalenessIndex;
  try {
    const content = await fs.readFile(stalenessPath, 'utf-8');
    index = JSON.parse(content);
  } catch (error) {
    // File doesn't exist or is invalid, create new index
    index = { version: 1, docs: {} };
  }

  // Update the entry for this document
  const entry: StalenessDocEntry = {
    generated: new Date().toISOString(),
    source_files: sourceFiles,
  };

  index.docs[docPath] = entry;

  // Write the updated index
  await fs.writeFile(stalenessPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Read the staleness index file.
 *
 * @param projectRoot - Root directory of the project
 * @returns The staleness index or null if it doesn't exist
 */
export async function readStalenessIndex(
  projectRoot: string = process.cwd()
): Promise<StalenessIndex | null> {
  const stalenessPath = path.join(
    projectRoot,
    DEFAULT_SPELUNK_BASE,
    '_staleness.json'
  );

  try {
    const content = await fs.readFile(stalenessPath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Get the path where a spelunk document would be written.
 *
 * @param lens - The lens type
 * @param focus - The focus area
 * @param projectRoot - Root directory of the project
 * @returns Object with relative and absolute paths
 */
export function getSpelunkDocPath(
  lens: LensType,
  focus: string,
  projectRoot: string = process.cwd()
): { relative: string; absolute: string } {
  const directory = LENS_DIRECTORIES[lens];
  const slug = toSlug(focus);
  const fileName = `${slug}.md`;
  const relativePath = path.join(DEFAULT_SPELUNK_BASE, directory, fileName);
  const absolutePath = path.join(projectRoot, relativePath);

  return { relative: relativePath, absolute: absolutePath };
}

/**
 * Check if a spelunk document exists.
 *
 * @param lens - The lens type
 * @param focus - The focus area
 * @param projectRoot - Root directory of the project
 * @returns True if the document exists
 */
export async function spelunkDocExists(
  lens: LensType,
  focus: string,
  projectRoot: string = process.cwd()
): Promise<boolean> {
  const { absolute } = getSpelunkDocPath(lens, focus, projectRoot);
  try {
    await fs.access(absolute);
    return true;
  } catch {
    return false;
  }
}
