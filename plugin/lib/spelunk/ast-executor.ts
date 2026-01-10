/**
 * AST Executor for Spelunking Mode
 *
 * Executes AST-based code exploration when LSP is unavailable.
 * Uses ast-grep (preferred) or semgrep as fallback for structural pattern matching.
 *
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

import { execSync } from 'child_process';
import * as path from 'path';
import { LensType } from './types';
import { LENS_SPECS, AstPatterns } from './lens-specs';
import {
  detectToolsSync,
  getPreferredAstTool,
  ToolAvailability,
  EXTENSION_TO_LANGUAGE,
} from './tool-detection';

// =============================================================================
// Types
// =============================================================================

/**
 * An entry from AST exploration matching the LSP executor format
 */
export interface ExplorationEntry {
  /** The file path where the match was found */
  filePath: string;
  /** Line number (1-based) */
  line: number;
  /** Column number (1-based) */
  column: number;
  /** The matched code snippet */
  text: string;
  /** Symbol name if extractable */
  symbolName?: string;
  /** The pattern that matched */
  matchedPattern: string;
}

/**
 * Result from AST-based exploration
 */
export interface AstExecutionResult {
  /** The lens used for exploration */
  lens: LensType;
  /** The focus area explored */
  focus: string;
  /** Exploration entries found */
  entries: ExplorationEntry[];
  /** List of files that were examined */
  filesExamined: string[];
  /** Whether results were truncated due to limits */
  truncated: boolean;
  /** Which AST tool was used */
  strategy: 'ast-grep' | 'semgrep';
  /** Patterns that were executed */
  patternsUsed: string[];
}

/**
 * Options for AST execution
 */
export interface AstExecutionOptions {
  /** Maximum number of files to examine (default: 50) */
  maxFiles?: number;
  /** Maximum depth for directory traversal (default: 3) */
  maxDepth?: number;
  /** Language to use for pattern selection */
  language?: string;
  /** Project root directory (default: cwd) */
  projectRoot?: string;
}

/**
 * Raw match from ast-grep JSON output
 */
interface AstGrepMatch {
  file: string;
  range: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  text: string;
  metaVariables?: Record<string, { text: string }>;
}

/**
 * Raw match from semgrep JSON output
 */
interface SemgrepMatch {
  path: string;
  start: { line: number; col: number };
  end: { line: number; col: number };
  extra: {
    lines: string;
    metavars?: Record<string, { abstract_content: string }>;
  };
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_DEPTH = 3;
const EXECUTION_TIMEOUT_MS = 30000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Detect the language from file extension or path
 */
function detectLanguage(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXTENSION_TO_LANGUAGE[ext] || null;
}

/**
 * Get the primary language from a focus path or default
 */
function inferLanguageFromFocus(focus: string): string {
  // Check if focus contains a file extension hint
  const extMatch = focus.match(/\.(ts|tsx|js|jsx|py|go|rs|java)$/);
  if (extMatch) {
    const ext = `.${extMatch[1]}`;
    return EXTENSION_TO_LANGUAGE[ext] || 'typescript';
  }
  // Default to TypeScript for most modern projects
  return 'typescript';
}

/**
 * Get AST patterns for a lens and language
 */
function getPatternsForLens(lens: LensType, language: string): string[] {
  const spec = LENS_SPECS[lens];
  if (!spec) {
    return [];
  }

  const patterns: string[] = [];
  const astPatterns = spec.astPatterns as AstPatterns;

  // Get language-specific patterns
  const langPatterns = astPatterns[language as keyof AstPatterns];
  if (langPatterns && Array.isArray(langPatterns)) {
    patterns.push(...langPatterns);
  }

  // Also include generic patterns if available
  if (astPatterns.generic && Array.isArray(astPatterns.generic)) {
    patterns.push(...astPatterns.generic);
  }

  return patterns;
}

/**
 * Execute ast-grep with a pattern and return matches
 */
function executeAstGrep(
  pattern: string,
  targetPath: string,
  language: string
): ExplorationEntry[] {
  const entries: ExplorationEntry[] = [];

  try {
    // ast-grep requires language flag for pattern matching
    const langFlag = getAstGrepLangFlag(language);
    const cmd = `ast-grep scan --pattern '${escapeShellArg(pattern)}' ${langFlag} --json "${targetPath}"`;

    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: EXECUTION_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!output.trim()) {
      return entries;
    }

    const matches: AstGrepMatch[] = JSON.parse(output);
    for (const match of matches) {
      entries.push({
        filePath: match.file,
        line: match.range.start.line,
        column: match.range.start.column,
        text: match.text.slice(0, 500), // Truncate long matches
        symbolName: extractSymbolName(match.metaVariables),
        matchedPattern: pattern,
      });
    }
  } catch (error) {
    // ast-grep returns exit code 1 when no matches found
    // Only log actual errors
    if (error instanceof Error && !error.message.includes('exit code 1')) {
      console.warn(`ast-grep pattern "${pattern}" failed: ${error.message}`);
    }
  }

  return entries;
}

/**
 * Execute semgrep with a pattern and return matches
 */
function executeSemgrep(
  pattern: string,
  targetPath: string,
  language: string
): ExplorationEntry[] {
  const entries: ExplorationEntry[] = [];

  try {
    // semgrep requires language specification
    const langFlag = getSemgrepLangFlag(language);
    const cmd = `semgrep --pattern '${escapeShellArg(pattern)}' ${langFlag} --json "${targetPath}"`;

    const output = execSync(cmd, {
      encoding: 'utf-8',
      timeout: EXECUTION_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!output.trim()) {
      return entries;
    }

    const result = JSON.parse(output);
    const matches: SemgrepMatch[] = result.results || [];

    for (const match of matches) {
      entries.push({
        filePath: match.path,
        line: match.start.line,
        column: match.start.col,
        text: match.extra.lines.slice(0, 500),
        symbolName: extractSemgrepSymbolName(match.extra.metavars),
        matchedPattern: pattern,
      });
    }
  } catch (error) {
    if (error instanceof Error && !error.message.includes('exit code 1')) {
      console.warn(`semgrep pattern "${pattern}" failed: ${error.message}`);
    }
  }

  return entries;
}

/**
 * Get ast-grep language flag
 */
function getAstGrepLangFlag(language: string): string {
  const langMap: Record<string, string> = {
    typescript: '--lang ts',
    javascript: '--lang js',
    python: '--lang python',
    go: '--lang go',
    rust: '--lang rust',
    java: '--lang java',
  };
  return langMap[language] || '';
}

/**
 * Get semgrep language flag
 */
function getSemgrepLangFlag(language: string): string {
  const langMap: Record<string, string> = {
    typescript: '--lang ts',
    javascript: '--lang js',
    python: '--lang python',
    go: '--lang go',
    rust: '--lang rust',
    java: '--lang java',
  };
  return langMap[language] || '';
}

/**
 * Escape shell argument to prevent injection
 */
function escapeShellArg(arg: string): string {
  // Replace single quotes with escaped version
  return arg.replace(/'/g, "'\\''");
}

/**
 * Extract symbol name from ast-grep metavariables
 */
function extractSymbolName(
  metaVariables?: Record<string, { text: string }>
): string | undefined {
  if (!metaVariables) {
    return undefined;
  }

  // Common metavariable names for symbol names
  const nameVars = ['$NAME', '$IDENTIFIER', '$ID', '$FUNC', '$CLASS'];
  for (const varName of nameVars) {
    if (metaVariables[varName]) {
      return metaVariables[varName].text;
    }
  }
  return undefined;
}

/**
 * Extract symbol name from semgrep metavariables
 */
function extractSemgrepSymbolName(
  metavars?: Record<string, { abstract_content: string }>
): string | undefined {
  if (!metavars) {
    return undefined;
  }

  const nameVars = ['$NAME', '$IDENTIFIER', '$ID', '$FUNC', '$CLASS'];
  for (const varName of nameVars) {
    if (metavars[varName]) {
      return metavars[varName].abstract_content;
    }
  }
  return undefined;
}

/**
 * Deduplicate entries by file path and line number
 */
function deduplicateEntries(entries: ExplorationEntry[]): ExplorationEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = `${entry.filePath}:${entry.line}:${entry.column}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Extract unique file paths from entries
 */
function extractFilesExamined(entries: ExplorationEntry[]): string[] {
  const files = new Set<string>();
  for (const entry of entries) {
    files.add(entry.filePath);
  }
  return Array.from(files).sort();
}

// =============================================================================
// Main API
// =============================================================================

/**
 * Execute AST-based exploration for a given lens and focus area.
 *
 * This function provides LSP-fallback functionality using ast-grep or semgrep
 * for structural code search. It extracts patterns defined in lens-specs.ts
 * and executes them against the codebase.
 *
 * @param lens - The lens type defining what patterns to search for
 * @param focus - The focus area (path or glob pattern) to explore
 * @param options - Execution options
 * @returns Promise resolving to exploration results
 *
 * @example
 * const result = await executeAstFallback('interfaces', 'src/auth', {
 *   language: 'typescript',
 *   maxFiles: 20
 * });
 */
export async function executeAstFallback(
  lens: LensType,
  focus: string,
  options: AstExecutionOptions = {}
): Promise<AstExecutionResult> {
  const {
    maxFiles = DEFAULT_MAX_FILES,
    language = inferLanguageFromFocus(focus),
    projectRoot = process.cwd(),
  } = options;

  // Detect available AST tools
  const availability = detectToolsSync();
  const preferredTool = getPreferredAstTool(availability);

  if (!preferredTool) {
    throw new Error(
      'No AST tool available. Install ast-grep or semgrep for AST-based exploration.'
    );
  }

  // Get patterns for this lens and language
  const patterns = getPatternsForLens(lens, language);
  if (patterns.length === 0) {
    return {
      lens,
      focus,
      entries: [],
      filesExamined: [],
      truncated: false,
      strategy: preferredTool,
      patternsUsed: [],
    };
  }

  // Determine target path
  const targetPath = path.isAbsolute(focus) ? focus : path.join(projectRoot, focus);

  // Execute patterns and collect results
  const allEntries: ExplorationEntry[] = [];
  const usedPatterns: string[] = [];

  for (const pattern of patterns) {
    const entries =
      preferredTool === 'ast-grep'
        ? executeAstGrep(pattern, targetPath, language)
        : executeSemgrep(pattern, targetPath, language);

    if (entries.length > 0) {
      usedPatterns.push(pattern);
      allEntries.push(...entries);
    }

    // Check if we've exceeded max files
    const uniqueFiles = new Set(allEntries.map((e) => e.filePath));
    if (uniqueFiles.size >= maxFiles) {
      break;
    }
  }

  // Deduplicate and limit results
  const deduped = deduplicateEntries(allEntries);
  const filesExamined = extractFilesExamined(deduped);
  const truncated = filesExamined.length > maxFiles;

  // Limit to maxFiles if needed
  const limitedEntries = truncated
    ? deduped.filter((e) => filesExamined.slice(0, maxFiles).includes(e.filePath))
    : deduped;

  return {
    lens,
    focus,
    entries: limitedEntries,
    filesExamined: filesExamined.slice(0, maxFiles),
    truncated,
    strategy: preferredTool,
    patternsUsed: usedPatterns,
  };
}

/**
 * Check if AST-based exploration is available
 */
export function isAstAvailable(): boolean {
  const availability = detectToolsSync();
  return availability.ast.astGrep || availability.ast.semgrep;
}

/**
 * Get the preferred AST tool name
 */
export function getPreferredTool(): 'ast-grep' | 'semgrep' | null {
  const availability = detectToolsSync();
  return getPreferredAstTool(availability);
}

/**
 * Get patterns available for a lens/language combination
 */
export function getAvailablePatterns(lens: LensType, language: string): string[] {
  return getPatternsForLens(lens, language);
}
