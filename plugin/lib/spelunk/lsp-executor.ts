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
import * as fs from 'fs/promises';
import { promisify } from 'util';
import globCallback from 'glob';

// Promisify glob for async usage with glob 7.x
const glob = promisify(globCallback);
import {
  LensSpec,
  LspOperation,
  SymbolKind,
  getLens,
  LENS_SPECS,
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
  /** Strategy used for exploration */
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

/** Mapping from LSP SymbolKind numbers to string names */
const LSP_SYMBOL_KIND_MAP: Record<number, string> = {
  1: 'file',
  2: 'module',
  3: 'namespace',
  4: 'package',
  5: 'class',
  6: 'method',
  7: 'property',
  8: 'field',
  9: 'constructor',
  10: 'enum',
  11: 'interface',
  12: 'function',
  13: 'variable',
  14: 'constant',
  15: 'string',
  16: 'number',
  17: 'boolean',
  18: 'array',
  19: 'object',
  20: 'key',
  21: 'null',
  22: 'enummember',
  23: 'struct',
  24: 'event',
  25: 'operator',
  26: 'typeparameter',
};

/** Mapping from SymbolKind string to LSP number(s) */
const SYMBOL_KIND_TO_LSP: Record<SymbolKind, number[]> = {
  interface: [11],
  type: [26], // TypeParameter, closest match for type aliases
  class: [5],
  function: [12],
  method: [6],
  property: [7],
  variable: [13],
  constant: [14],
  enum: [10],
  module: [2],
  namespace: [3],
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert LSP symbol kind number to string name
 */
function symbolKindToString(kind: number): string {
  return LSP_SYMBOL_KIND_MAP[kind] ?? 'unknown';
}

/**
 * Check if a symbol kind matches the filter
 */
function matchesSymbolFilter(kind: number, filters?: SymbolKind[]): boolean {
  if (!filters || filters.length === 0) {
    return true; // No filter means accept all
  }

  const kindString = symbolKindToString(kind);

  for (const filter of filters) {
    const lspKinds = SYMBOL_KIND_TO_LSP[filter] ?? [];
    if (lspKinds.includes(kind)) {
      return true;
    }
    // Also do a string comparison for flexibility
    if (kindString.toLowerCase() === filter.toLowerCase()) {
      return true;
    }
  }

  return false;
}

/**
 * Convert a file URI to a file path
 */
function uriToPath(uri: string): string {
  if (uri.startsWith('file://')) {
    return decodeURIComponent(uri.slice(7));
  }
  return uri;
}

/**
 * Convert a file path to a file URI
 */
function pathToUri(filePath: string): string {
  return `file://${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;
}

/**
 * Check if a symbol name matches extract patterns
 */
function matchesExtractPatterns(symbolName: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(symbolName)) {
        return true;
      }
    } catch {
      // Invalid regex, try literal match
      if (symbolName.toLowerCase().includes(pattern.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a symbol name or path matches ignore patterns
 */
function matchesIgnorePatterns(
  symbolName: string,
  filePath: string,
  patterns: string[]
): boolean {
  const testStrings = [symbolName, filePath];

  for (const pattern of patterns) {
    for (const testString of testStrings) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(testString)) {
          return true;
        }
      } catch {
        // Invalid regex, try literal match
        if (testString.toLowerCase().includes(pattern.toLowerCase())) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Extract hover content as a string
 */
function extractHoverContent(hover: LspHoverResult | null): string | undefined {
  if (!hover) {
    return undefined;
  }

  if (typeof hover.contents === 'string') {
    return hover.contents;
  }

  if (Array.isArray(hover.contents)) {
    return hover.contents
      .map((c) => (typeof c === 'string' ? c : c.value))
      .join('\n');
  }

  if (typeof hover.contents === 'object' && 'value' in hover.contents) {
    return hover.contents.value;
  }

  return undefined;
}

/**
 * Read a code snippet from a file
 */
async function readSnippet(
  filePath: string,
  startLine: number,
  endLine: number,
  maxLines: number
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const actualEndLine = Math.min(endLine, startLine + maxLines - 1);
    const snippetLines = lines.slice(startLine - 1, actualEndLine);

    return snippetLines.join('\n');
  } catch {
    return undefined;
  }
}

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

/**
 * Deduplicate entries by file:line:symbol
 */
function deduplicateEntries(entries: LspExplorationEntry[]): LspExplorationEntry[] {
  const seen = new Set<string>();
  const result: LspExplorationEntry[] = [];

  for (const entry of entries) {
    const key = `${entry.file}:${entry.line}:${entry.symbol}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }

  return result;
}

/**
 * Sort entries by file path then line number
 */
function sortEntries(entries: LspExplorationEntry[]): LspExplorationEntry[] {
  return entries.sort((a, b) => {
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }
    return a.line - b.line;
  });
}

// =============================================================================
// LSP Operation Simulators
// =============================================================================

/**
 * Note: These functions simulate LSP operations by parsing code.
 * In a real environment with ENABLE_LSP_TOOL=1, Claude Code would
 * provide native LSP operations. These simulators serve as:
 * 1. Documentation of expected LSP behavior
 * 2. Fallback when native LSP is unavailable
 * 3. Test fixtures
 */

/**
 * Simulated documentSymbol operation using regex patterns
 * Extracts symbols from TypeScript/JavaScript files
 */
async function simulateDocumentSymbol(filePath: string): Promise<LspSymbolInfo[]> {
  const symbols: LspSymbolInfo[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Patterns to match common declarations
    const patterns: Array<{ regex: RegExp; kind: number; nameGroup: number }> = [
      // Interfaces
      { regex: /^(?:export\s+)?interface\s+(\w+)/m, kind: 11, nameGroup: 1 },
      // Type aliases
      { regex: /^(?:export\s+)?type\s+(\w+)\s*=/m, kind: 26, nameGroup: 1 },
      // Classes
      { regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/m, kind: 5, nameGroup: 1 },
      // Functions (named)
      { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/m, kind: 12, nameGroup: 1 },
      // Arrow functions (const)
      { regex: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\(/m, kind: 12, nameGroup: 1 },
      // Enums
      { regex: /^(?:export\s+)?enum\s+(\w+)/m, kind: 10, nameGroup: 1 },
      // Const declarations
      { regex: /^(?:export\s+)?const\s+(\w+)\s*:/m, kind: 14, nameGroup: 1 },
      // Module/namespace
      { regex: /^(?:export\s+)?(?:namespace|module)\s+(\w+)/m, kind: 2, nameGroup: 1 },
    ];

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      for (const { regex, kind, nameGroup } of patterns) {
        const match = line.match(regex);
        if (match && match[nameGroup]) {
          symbols.push({
            name: match[nameGroup],
            kind,
            location: {
              uri: pathToUri(filePath),
              range: {
                start: { line: lineIndex, character: 0 },
                end: { line: lineIndex, character: line.length },
              },
            },
          });
        }
      }
    }
  } catch {
    // File read error
  }

  return symbols;
}

/**
 * Simulated hover operation - extracts type signature from declaration
 */
async function simulateHover(
  filePath: string,
  line: number,
  _character: number
): Promise<LspHoverResult | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    if (line < 0 || line >= lines.length) {
      return null;
    }

    const lineText = lines[line];

    // For functions, capture the full signature
    const funcMatch = lineText.match(
      /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?/
    );
    if (funcMatch) {
      return {
        contents: { value: funcMatch[0].trim(), language: 'typescript' },
      };
    }

    // For interfaces/types/classes, capture the declaration line
    const declMatch = lineText.match(
      /(?:export\s+)?(?:interface|type|class|enum)\s+\w+[^{]*/
    );
    if (declMatch) {
      return {
        contents: { value: declMatch[0].trim(), language: 'typescript' },
      };
    }

    return {
      contents: lineText.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Simulated findReferences operation
 * Finds references to a symbol by simple text search
 */
async function simulateFindReferences(
  symbolName: string,
  projectRoot: string,
  maxFiles: number
): Promise<LspLocation[]> {
  const locations: LspLocation[] = [];

  // Find all relevant files
  const files = await glob('**/*.{ts,tsx,js,jsx}', {
    cwd: projectRoot,
    absolute: true,
    nodir: true,
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
  });

  for (const file of files.slice(0, maxFiles)) {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const lines = content.split('\n');

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        // Use word boundary to match symbol name
        const regex = new RegExp(`\\b${symbolName}\\b`);
        const match = line.match(regex);
        if (match) {
          locations.push({
            uri: pathToUri(file),
            range: {
              start: { line: lineIndex, character: match.index ?? 0 },
              end: { line: lineIndex, character: (match.index ?? 0) + symbolName.length },
            },
          });
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return locations;
}

// =============================================================================
// Lens Execution
// =============================================================================

/**
 * Execute document symbol extraction for a file
 */
async function executeDocumentSymbol(
  filePath: string,
  lensSpec: LensSpec,
  options: Required<Omit<LspExecutionOptions, 'projectRoot'>> & { projectRoot: string }
): Promise<LspExplorationEntry[]> {
  const entries: LspExplorationEntry[] = [];
  const symbols = await simulateDocumentSymbol(filePath);

  for (const symbol of symbols) {
    // Filter by symbol kind
    if (!matchesSymbolFilter(symbol.kind, lensSpec.lsp.symbolFilters)) {
      continue;
    }

    // Filter by extract patterns
    if (!matchesExtractPatterns(symbol.name, lensSpec.extractPatterns)) {
      continue;
    }

    // Filter by ignore patterns
    if (matchesIgnorePatterns(symbol.name, filePath, lensSpec.ignorePatterns)) {
      continue;
    }

    const line = symbol.location.range.start.line + 1; // Convert to 1-indexed

    // Get hover information for signature
    const hover = await simulateHover(
      filePath,
      symbol.location.range.start.line,
      symbol.location.range.start.character
    );

    // Get code snippet if enabled
    let snippet: string | undefined;
    if (lensSpec.includeSnippets) {
      const endLine = symbol.location.range.end.line + 1;
      snippet = await readSnippet(filePath, line, endLine, lensSpec.snippetMaxLines);
    }

    entries.push({
      symbol: symbol.name,
      kind: symbolKindToString(symbol.kind),
      file: filePath,
      line,
      signature: extractHoverContent(hover),
      snippet,
      column: symbol.location.range.start.character + 1,
      endLine: symbol.location.range.end.line + 1,
      endColumn: symbol.location.range.end.character + 1,
    });
  }

  return entries;
}

/**
 * Execute reference finding for entry point symbols
 */
async function executeReferenceFinding(
  entryFiles: string[],
  lensSpec: LensSpec,
  options: Required<Omit<LspExecutionOptions, 'projectRoot'>> & { projectRoot: string }
): Promise<LspExplorationEntry[]> {
  const entries: LspExplorationEntry[] = [];
  const processedSymbols = new Set<string>();

  for (const file of entryFiles) {
    // First get symbols from the file
    const symbols = await simulateDocumentSymbol(file);

    for (const symbol of symbols) {
      // Apply filters
      if (!matchesExtractPatterns(symbol.name, lensSpec.extractPatterns)) {
        continue;
      }
      if (matchesIgnorePatterns(symbol.name, file, lensSpec.ignorePatterns)) {
        continue;
      }

      // Skip if already processed
      if (processedSymbols.has(symbol.name)) {
        continue;
      }
      processedSymbols.add(symbol.name);

      // Find references
      const references = await simulateFindReferences(
        symbol.name,
        options.projectRoot,
        options.maxFiles
      );

      // Get hover for signature
      const hover = await simulateHover(
        file,
        symbol.location.range.start.line,
        symbol.location.range.start.character
      );

      const refStrings = references
        .slice(0, 20) // Limit references
        .map((ref) => {
          const refPath = uriToPath(ref.uri);
          const relativePath = path.relative(options.projectRoot, refPath);
          return `${relativePath}:${ref.range.start.line + 1}`;
        });

      entries.push({
        symbol: symbol.name,
        kind: symbolKindToString(symbol.kind),
        file,
        line: symbol.location.range.start.line + 1,
        signature: extractHoverContent(hover),
        references: refStrings.length > 0 ? refStrings : undefined,
      });

      if (entries.length >= options.maxOutput) {
        break;
      }
    }

    if (entries.length >= options.maxOutput) {
      break;
    }
  }

  return entries;
}

/**
 * Execute lens-specific LSP operations
 */
async function executeLensOperations(
  lensSpec: LensSpec,
  files: string[],
  options: Required<Omit<LspExecutionOptions, 'projectRoot'>> & { projectRoot: string }
): Promise<LspExplorationEntry[]> {
  const entries: LspExplorationEntry[] = [];
  const operations = lensSpec.lsp.operations;

  // Prioritize operations based on lens type
  if (operations.includes('documentSymbol')) {
    for (const file of files) {
      const fileEntries = await executeDocumentSymbol(file, lensSpec, options);
      entries.push(...fileEntries);

      if (entries.length >= options.maxOutput) {
        break;
      }
    }
  }

  if (operations.includes('findReferences') || operations.includes('goToDefinition')) {
    const refEntries = await executeReferenceFinding(files, lensSpec, options);
    entries.push(...refEntries);
  }

  return entries;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute a lens exploration via LSP operations
 *
 * @param lens - The lens type to execute
 * @param focus - The focus area to explore (e.g., "authentication layer")
 * @param options - Execution options
 * @returns LSP execution result with exploration entries
 *
 * @example
 * const result = await executeLens('interfaces', 'authentication', { maxFiles: 20 });
 * console.log(result.entries);
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
      'LSP not enabled (ENABLE_LSP_TOOL=1 not set). Using simulated LSP operations.'
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

  // Execute lens operations
  let entries = await executeLensOperations(lensSpec, files, resolvedOptions);

  // Deduplicate and sort
  entries = deduplicateEntries(entries);
  entries = sortEntries(entries);

  // Check if truncated
  const truncated = entries.length >= resolvedOptions.maxOutput;
  if (truncated) {
    entries = entries.slice(0, resolvedOptions.maxOutput);
  }

  return {
    lens,
    focus,
    entries,
    filesExamined: files,
    truncated,
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
