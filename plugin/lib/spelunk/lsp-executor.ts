/**
 * LSP-Based Lens Execution for Spelunking Mode
 *
 * Executes LSP operations based on lens specifications to extract
 * code intelligence from the codebase. Uses Claude Code's native LSP
 * support (ENABLE_LSP_TOOL=1) for accurate symbol resolution.
 *
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

import * as path from 'path';
import { promisify } from 'util';
import globCallback from 'glob';

// Promisify glob for async usage with glob 7.x
const glob = promisify(globCallback);
import {
  LensSpec,
  LspOperation,
  SymbolKind,
  getLens,
} from './lens-specs';
import {
  detectToolsSync,
  ToolAvailability,
  EXTENSION_TO_LANGUAGE,
} from './tool-detection';
import { LensType } from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Represents a single exploration entry found during LSP lens execution
 */
export interface LspExplorationEntry {
  /** Symbol name (function, class, interface, etc.) */
  symbol: string;
  /** Symbol kind (function, class, interface, type, etc.) */
  kind: string;
  /** Absolute file path where the symbol is defined */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Type signature or declaration (from hover) */
  signature?: string;
  /** References to this symbol (file:line format) */
  references?: string[];
  /** Code snippet around the symbol */
  snippet?: string;
  /** Column position (1-indexed) */
  column?: number;
  /** End line for range */
  endLine?: number;
  /** End column for range */
  endColumn?: number;
}

/**
 * Result of executing a lens via LSP
 */
export interface LensExecutionResult {
  /** The lens that was executed */
  lens: LensType;
  /** The focus area that was explored */
  focus: string;
  /** Exploration entries found */
  entries: LspExplorationEntry[];
  /** Files that were examined during exploration */
  filesExamined: string[];
  /** Whether results were truncated due to limits */
  truncated: boolean;
  /** Strategy used for exploration - 'lsp' indicates proper LSP delegation */
  strategy: 'lsp';
  /** Any warnings or notes from execution */
  warnings?: string[];
}

/**
 * Options for lens execution
 */
export interface LspExecutionOptions {
  /** Maximum number of files to examine (default: 50) */
  maxFiles?: number;
  /** Maximum depth for reference/definition tracing (default: 3) */
  maxDepth?: number;
  /** Maximum entries in output (default: 500) */
  maxOutput?: number;
  /** Project root directory (default: cwd) */
  projectRoot?: string;
}

/**
 * LSP Symbol Information (subset of LSP spec)
 */
export interface LspSymbolInfo {
  name: string;
  kind: number;
  location: {
    uri: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  containerName?: string;
  children?: LspSymbolInfo[];
}

/**
 * LSP Hover Result (subset of LSP spec)
 */
export interface LspHoverResult {
  contents: string | { value: string; language?: string } | Array<string | { value: string }>;
  range?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * LSP Location (subset of LSP spec)
 */
export interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

// =============================================================================
// Constants
// =============================================================================

/** Default options for lens execution */
const DEFAULT_OPTIONS: Required<Omit<LspExecutionOptions, 'projectRoot'>> = {
  maxFiles: 50,
  maxDepth: 3,
  maxOutput: 500,
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find files matching entry point patterns for a lens
 */
async function findEntryPointFiles(
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
 * Find files in the focus area
 */
async function findFilesInFocus(
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
    for (const glob of lensSpec.grepPatterns.fileGlobs) {
      focusPatterns.push(`**/${glob}`);
    }
  }

  return findEntryPointFiles(focusPatterns, projectRoot, maxFiles);
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute a lens exploration via LSP operations
 *
 * NOTE: This function now requires LSP to be enabled via the two-phase workflow.
 * The old regex-based simulation has been removed. If LSP is not enabled,
 * this function returns empty results with a warning indicating that the
 * caller should use the two-phase workflow (planSpelunk + processLspResults)
 * or fall back to AST/grep strategies.
 *
 * @param lens - The lens type to execute
 * @param focus - The focus area to explore (e.g., "authentication layer")
 * @param options - Execution options
 * @returns LSP execution result with exploration entries
 *
 * @example
 * // For LSP execution, use the two-phase workflow instead:
 * const plan = await planSpelunk('interfaces', 'authentication', { maxFiles: 20 });
 * // Agent executes plan.toolCalls...
 * const output = await processLspResults(plan, lspResults);
 */
export async function executeLens(
  lens: LensType,
  focus: string,
  options: LspExecutionOptions = {}
): Promise<LensExecutionResult> {
  const projectRoot = options.projectRoot ?? process.cwd();
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
    projectRoot,
  };

  const warnings: string[] = [];

  // Check tool availability
  const toolAvailability = detectToolsSync();
  if (!toolAvailability.lsp.enabled) {
    warnings.push(
      'LSP not enabled. Use the two-phase workflow (planSpelunk + processLspResults) ' +
        'with agent LSP delegation, or fall back to AST/grep strategies.'
    );
  }

  // Get lens specification
  const lensSpec = getLens(lens);

  // Find files to examine based on focus
  const files = await findFilesInFocus(
    focus,
    lensSpec,
    projectRoot,
    resolvedOptions.maxFiles
  );

  if (files.length === 0) {
    warnings.push(`No files found matching focus "${focus}"`);
  }

  // Without the old simulation functions, we return empty results
  // The caller should use the two-phase workflow for actual LSP execution
  return {
    lens,
    focus,
    entries: [],
    filesExamined: files,
    truncated: false,
    strategy: 'lsp',
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Check if LSP execution is available
 */
export function isLspAvailable(): boolean {
  const availability = detectToolsSync();
  return availability.lsp.enabled;
}

/**
 * Get supported languages for LSP execution
 */
export function getSupportedLanguages(): string[] {
  const availability = detectToolsSync();
  return Object.entries(availability.lsp.languages)
    .filter(([_, available]) => available)
    .map(([lang]) => lang);
}

/**
 * Get the language for a file extension
 */
export function getLanguageForFile(filePath: string): string | undefined {
  const ext = path.extname(filePath);
  return EXTENSION_TO_LANGUAGE[ext];
}

/**
 * Execute multiple lenses in parallel
 */
export async function executeLenses(
  lenses: LensType[],
  focus: string,
  options: LspExecutionOptions = {}
): Promise<LensExecutionResult[]> {
  const results = await Promise.all(
    lenses.map((lens) => executeLens(lens, focus, options))
  );
  return results;
}

// Re-export types for convenience
export { LensSpec, LspOperation, SymbolKind, ToolAvailability };
