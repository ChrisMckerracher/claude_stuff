/**
 * Spelunk Persistence Layer Types
 *
 * Type definitions for the spelunking mode documentation persistence system.
 * See: docs/plans/architect/coding-agent-spelunking-mode.md
 */

/**
 * Valid lens types that map to output directories
 */
export type LensType = 'interfaces' | 'flows' | 'boundaries' | 'contracts' | 'trust-zones';

/**
 * Tool chain used for spelunking
 */
export type ToolChain = 'lsp' | 'ast-grep' | 'semgrep' | 'grep-fallback';

/**
 * Source file entry with path and content hash
 */
export interface SourceFileEntry {
  path: string;
  hash: string;
}

/**
 * Frontmatter for a spelunk document
 */
export interface SpelunkFrontmatter {
  lens: LensType;
  focus: string;
  generated: string; // ISO 8601 timestamp
  source_files: SourceFileEntry[];
  tool_chain: ToolChain;
}

/**
 * Entry in the staleness index for a single document
 */
export interface StalenessDocEntry {
  generated: string; // ISO 8601 timestamp
  source_files: Record<string, string>; // path -> hash
}

/**
 * The _staleness.json file structure
 */
export interface StalenessIndex {
  version: 1;
  docs: Record<string, StalenessDocEntry>; // relative path -> entry
}

/**
 * Staleness check result
 */
export type DocStatus = 'FRESH' | 'STALE' | 'MISSING' | 'ORPHANED';

/**
 * Result of a staleness check
 */
export interface StalenessCheckResult {
  status: DocStatus;
  docPath: string | null;
  staleSources?: string[];  // Files that changed (if STALE)
  missingDoc?: boolean;     // True if MISSING
  reason?: string;          // Human-readable explanation
}

/**
 * Lens to directory mapping
 */
export const LENS_DIRECTORIES: Record<LensType, string> = {
  'interfaces': 'contracts',
  'flows': 'flows',
  'boundaries': 'boundaries',
  'contracts': 'contracts',
  'trust-zones': 'trust-zones',
};

/**
 * All valid spelunk subdirectories
 */
export const SPELUNK_DIRECTORIES = [
  'contracts',
  'flows',
  'boundaries',
  'trust-zones',
  'state',
] as const;

/**
 * Maximum slug length before truncation with hash suffix
 */
export const MAX_SLUG_LENGTH = 50;

/**
 * Hash length for file content hashes (first N chars of SHA-256)
 */
export const HASH_LENGTH = 8;
