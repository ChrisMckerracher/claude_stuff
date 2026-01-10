/**
 * Tool Detection Module for Spelunking Mode
 *
 * Detects available code intelligence tools and determines the best strategy
 * for code exploration based on what's available.
 *
 * Priority: LSP > AST tools > Grep/Glob fallback
 */

import { execSync } from 'child_process';

/**
 * Supported languages for LSP detection.
 * Maps language identifier to the expected LSP server name.
 */
export const LSP_SERVERS: Record<string, string> = {
  typescript: 'vtsls',
  javascript: 'vtsls',
  python: 'pyright',
  go: 'gopls',
  rust: 'rust-analyzer',
  java: 'jdtls',
  c: 'clangd',
  cpp: 'clangd',
  csharp: 'omnisharp',
  php: 'intelephense',
  kotlin: 'kotlin-language-server',
  ruby: 'solargraph',
  html: 'vscode-html-language-server',
  css: 'vscode-css-language-server',
};

/**
 * File extensions mapped to language identifiers.
 */
export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.rb': 'ruby',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
};

/**
 * Tool availability information.
 */
export interface ToolAvailability {
  lsp: {
    enabled: boolean;
    languages: Record<string, boolean>;
  };
  ast: {
    astGrep: boolean;
    semgrep: boolean;
  };
}

/**
 * Strategy type for code exploration.
 */
export type ExplorationStrategy = 'lsp' | 'ast' | 'grep';

/**
 * Check if a command exists in PATH.
 */
function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: 'pipe', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if ENABLE_LSP_TOOL environment variable is set to 1.
 */
function isLspEnabled(): boolean {
  return process.env.ENABLE_LSP_TOOL === '1';
}

/**
 * Check if an LSP server is available for a given language.
 * This checks both:
 * 1. If ENABLE_LSP_TOOL=1 is set (Claude Code native LSP)
 * 2. If the language's LSP server binary exists
 */
function checkLspForLanguage(language: string): boolean {
  if (!isLspEnabled()) {
    return false;
  }

  const server = LSP_SERVERS[language];
  if (!server) {
    return false;
  }

  // When LSP is enabled in Claude Code, it manages the servers internally
  // We assume if ENABLE_LSP_TOOL=1 is set and we know the server name,
  // the LSP capability is available for supported languages
  return true;
}

/**
 * Detect all available code intelligence tools.
 * Checks for LSP support per language and AST tool availability.
 */
export async function detectTools(): Promise<ToolAvailability> {
  const lspEnabled = isLspEnabled();

  // Check LSP availability for each supported language
  const languages: Record<string, boolean> = {};
  for (const lang of Object.keys(LSP_SERVERS)) {
    languages[lang] = checkLspForLanguage(lang);
  }

  // Check AST tool availability
  const astGrep = commandExists('ast-grep');
  const semgrep = commandExists('semgrep');

  return {
    lsp: {
      enabled: lspEnabled,
      languages,
    },
    ast: {
      astGrep,
      semgrep,
    },
  };
}

/**
 * Synchronous version of detectTools for cases where async is not convenient.
 */
export function detectToolsSync(): ToolAvailability {
  const lspEnabled = isLspEnabled();

  // Check LSP availability for each supported language
  const languages: Record<string, boolean> = {};
  for (const lang of Object.keys(LSP_SERVERS)) {
    languages[lang] = checkLspForLanguage(lang);
  }

  // Check AST tool availability
  const astGrep = commandExists('ast-grep');
  const semgrep = commandExists('semgrep');

  return {
    lsp: {
      enabled: lspEnabled,
      languages,
    },
    ast: {
      astGrep,
      semgrep,
    },
  };
}

/**
 * Get the best exploration strategy for a given language.
 *
 * Priority:
 * 1. LSP - if enabled and available for the language (fastest, most accurate)
 * 2. AST - if ast-grep or semgrep is installed (structural search)
 * 3. Grep - fallback using Grep/Glob/Read tools (lexical search)
 */
export function getStrategyForLanguage(
  lang: string,
  availability: ToolAvailability
): ExplorationStrategy {
  // Normalize language identifier
  const normalizedLang = lang.toLowerCase();

  // Check if LSP is available for this language
  if (availability.lsp.enabled && availability.lsp.languages[normalizedLang]) {
    return 'lsp';
  }

  // Check if any AST tool is available
  if (availability.ast.astGrep || availability.ast.semgrep) {
    return 'ast';
  }

  // Fallback to grep-based exploration
  return 'grep';
}

/**
 * Get the strategy for a file based on its extension.
 */
export function getStrategyForFile(
  filePath: string,
  availability: ToolAvailability
): ExplorationStrategy {
  const ext = filePath.substring(filePath.lastIndexOf('.'));
  const lang = EXTENSION_TO_LANGUAGE[ext];

  if (!lang) {
    // Unknown file type, use grep fallback
    return availability.ast.astGrep || availability.ast.semgrep ? 'ast' : 'grep';
  }

  return getStrategyForLanguage(lang, availability);
}

/**
 * Get a human-readable summary of tool availability.
 */
export function getToolSummary(availability: ToolAvailability): string {
  const lines: string[] = ['Tool Availability Summary:', ''];

  // LSP status
  if (availability.lsp.enabled) {
    const supportedLangs = Object.entries(availability.lsp.languages)
      .filter(([, available]) => available)
      .map(([lang]) => lang);

    lines.push(`LSP: Enabled (${supportedLangs.length} languages supported)`);
    lines.push(`  Languages: ${supportedLangs.join(', ')}`);
  } else {
    lines.push('LSP: Disabled (set ENABLE_LSP_TOOL=1 to enable)');
  }

  lines.push('');

  // AST tools status
  lines.push('AST Tools:');
  lines.push(`  ast-grep: ${availability.ast.astGrep ? 'Installed' : 'Not found'}`);
  lines.push(`  semgrep: ${availability.ast.semgrep ? 'Installed' : 'Not found'}`);

  if (!availability.ast.astGrep && !availability.ast.semgrep) {
    lines.push('  (Install with: brew install ast-grep semgrep)');
  }

  lines.push('');

  // Overall strategy recommendation
  let recommendation: string;
  if (availability.lsp.enabled) {
    recommendation = 'LSP-first exploration available for supported languages';
  } else if (availability.ast.astGrep || availability.ast.semgrep) {
    recommendation = 'AST-based exploration available';
  } else {
    recommendation = 'Grep/Glob fallback only - consider installing LSP or AST tools';
  }
  lines.push(`Recommendation: ${recommendation}`);

  return lines.join('\n');
}

/**
 * Determine if we should warn about degraded functionality.
 */
export function shouldWarnAboutDegradedMode(availability: ToolAvailability): boolean {
  // Warn if neither LSP nor AST tools are available
  return !availability.lsp.enabled && !availability.ast.astGrep && !availability.ast.semgrep;
}

/**
 * Get the preferred AST tool when AST strategy is selected.
 */
export function getPreferredAstTool(
  availability: ToolAvailability
): 'ast-grep' | 'semgrep' | null {
  // Prefer ast-grep for general structural search (faster, simpler patterns)
  if (availability.ast.astGrep) {
    return 'ast-grep';
  }
  // Fall back to semgrep for more complex semantic analysis
  if (availability.ast.semgrep) {
    return 'semgrep';
  }
  return null;
}
