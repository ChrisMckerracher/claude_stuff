/**
 * Spelunk Orchestrator
 *
 * Main entry point for the spelunk subcommand. Coordinates parsing, staleness
 * checking, tool detection, execution, and report generation.
 *
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

import {
  parseSpelunkArgs,
  resolveLenses,
  withDefaults,
  SpelunkOptions,
  LensName,
} from './parser';
import { checkStaleness, checkMultipleLenses } from './staleness-check';
import {
  LensType,
  DocStatus,
  StalenessCheckResult,
  SpelunkPlan,
  SpelunkResults,
  SpelunkOutput,
} from './types';
import { executeLens, executeLenses, isLspAvailable } from './lsp-executor';
import { executeAstFallback, isAstAvailable } from './ast-executor';
import { generateReport, ExecutionResult, ExplorationEntry } from './report-generator';
import {
  detectToolsSync,
  getStrategyForLanguage,
  ToolAvailability,
  ExplorationStrategy,
} from './tool-detection';

// Re-export planner and processor for LSP tool delegation workflow
import { planSpelunk, PlannerOptions } from './planner';
import { processLspResults, ProcessorOptions } from './processor';

export {
  planSpelunk,
  planReferencesPhase,
  extractSymbolsForPhase2,
  type PlannerOptions,
  type DiscoveredSymbol,
} from './planner';

export {
  processLspResults,
  symbolKindToString,
  extractHoverContent,
  type ProcessorOptions,
} from './processor';

export {
  type SpelunkPlan,
  type SpelunkResults,
  type SpelunkOutput,
  type LspToolCall,
  type ExplorationEntry as LspExplorationEntry,
} from './types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the two-phase spelunk workflow
 */
export interface SpelunkTwoPhaseOptions {
  /** The lens type to apply */
  lens: LensType;
  /** The focus area to explore */
  focus: string;
  /** Project root directory (default: cwd) */
  projectRoot?: string;
  /** Maximum number of files to examine (default: 50) */
  maxFiles?: number;
  /** Maximum depth for reference tracing (default: 3) */
  maxDepth?: number;
  /** Maximum output entries (default: 500) */
  maxOutput?: number;
  /** LSP results from agent execution (Phase 2 output) */
  lspResults?: SpelunkResults;
  /** Skip LSP and use fallback strategy */
  skipLsp?: boolean;
  /** Execute fallback strategy immediately if LSP not available */
  executeOnFallback?: boolean;
}

/**
 * Result of the two-phase spelunk workflow
 */
export interface SpelunkTwoPhaseResult {
  /** The plan with tool call specifications (Phase 1 output) */
  plan: SpelunkPlan;
  /** The processed output (Phase 3 output, if lspResults provided) */
  output?: SpelunkOutput;
  /** Fallback strategy if LSP not available */
  fallbackStrategy?: 'ast' | 'grep';
  /** Warnings from execution */
  warnings?: string[];
}

/**
 * Result of a spelunk operation
 */
export interface SpelunkResult {
  /** Operation status */
  status: 'fresh' | 'generated' | 'check_only';
  /** Paths to generated/existing documents */
  docPaths: string[];
  /** Staleness information (when --check is used) */
  staleness?: Map<LensName, StalenessCheckResult>;
  /** Warnings or notes from execution */
  warnings?: string[];
}

/**
 * Internal options after resolving defaults
 */
interface ResolvedOptions extends SpelunkOptions {
  lenses: LensName[];
  projectRoot: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert LensName to LensType (they are compatible but typed differently)
 */
function lensNameToType(name: LensName): LensType {
  return name as LensType;
}

/**
 * Detect the primary language from focus area
 */
function detectLanguageFromFocus(focus: string): string {
  // Check for file extension hints
  if (focus.includes('.ts') || focus.includes('.tsx')) return 'typescript';
  if (focus.includes('.js') || focus.includes('.jsx')) return 'javascript';
  if (focus.includes('.py')) return 'python';
  if (focus.includes('.go')) return 'go';
  if (focus.includes('.rs')) return 'rust';
  if (focus.includes('.java')) return 'java';
  // Default to TypeScript for modern projects
  return 'typescript';
}

/**
 * Select the best execution strategy based on available tools
 */
function selectStrategy(
  availability: ToolAvailability,
  language: string
): ExplorationStrategy {
  return getStrategyForLanguage(language, availability);
}

/**
 * Execute exploration for a single lens using the appropriate strategy
 */
async function executeSingleLens(
  lens: LensName,
  focus: string,
  options: ResolvedOptions,
  strategy: ExplorationStrategy
): Promise<ExecutionResult> {
  const lensType = lensNameToType(lens);

  if (strategy === 'lsp') {
    const result = await executeLens(lensType, focus, {
      maxFiles: options.maxFiles,
      maxDepth: options.maxDepth,
      projectRoot: options.projectRoot,
    });

    // Convert LSP result to ExecutionResult format
    return {
      lens: lensType,
      focus,
      toolChain: 'lsp',
      entries: result.entries.map((e) => ({
        name: e.symbol,
        kind: e.kind,
        filePath: e.file,
        line: e.line,
        endLine: e.endLine,
        snippet: e.snippet,
        description: e.signature,
      })),
      sourceFiles: result.filesExamined,
    };
  }

  if (strategy === 'ast') {
    const result = await executeAstFallback(lensType, focus, {
      maxFiles: options.maxFiles,
      maxDepth: options.maxDepth,
      projectRoot: options.projectRoot,
    });

    // Convert AST result to ExecutionResult format
    return {
      lens: lensType,
      focus,
      toolChain: result.strategy,
      entries: result.entries.map((e) => ({
        name: e.symbolName || e.text.slice(0, 50),
        kind: 'match',
        filePath: e.filePath,
        line: e.line,
        snippet: e.text,
        description: `Matched pattern: ${e.matchedPattern}`,
      })),
      sourceFiles: result.filesExamined,
    };
  }

  // Grep fallback - return minimal result (actual grep execution would be added)
  return {
    lens: lensType,
    focus,
    toolChain: 'grep-fallback',
    entries: [],
    sourceFiles: [],
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Execute a spelunk command.
 *
 * This is the main entry point for the `/code spelunk` subcommand.
 * It orchestrates:
 * 1. Argument parsing
 * 2. Staleness checking
 * 3. Tool detection and strategy selection
 * 4. Lens execution
 * 5. Report generation
 *
 * @param args - The raw argument string (e.g., '--for=architect --focus="auth"')
 * @param projectRoot - Optional project root directory (defaults to cwd)
 * @returns Promise resolving to SpelunkResult
 *
 * @example
 * // Full exploration
 * const result = await spelunk('--for=architect --focus="authentication"');
 *
 * // Check staleness only
 * const check = await spelunk('--check --lens=flows --focus="auth"');
 *
 * // Force refresh
 * const fresh = await spelunk('--refresh --for=qa --focus="payment"');
 */
export async function spelunk(
  args: string,
  projectRoot: string = process.cwd()
): Promise<SpelunkResult> {
  // Parse arguments
  const parsed = parseSpelunkArgs(args);
  const lenses = resolveLenses(parsed);
  const options = withDefaults(parsed);

  const resolved: ResolvedOptions = {
    ...options,
    lenses,
    projectRoot,
  };

  const warnings: string[] = [];

  // Handle --check flag (staleness check only)
  if (resolved.checkOnly) {
    const stalenessMap = new Map<LensName, StalenessCheckResult>();

    for (const lens of lenses) {
      const result = await checkStaleness(
        lensNameToType(lens),
        resolved.focus,
        projectRoot
      );
      stalenessMap.set(lens, result);
    }

    // Collect existing doc paths
    const docPaths: string[] = [];
    Array.from(stalenessMap.values()).forEach((result) => {
      if (result.docPath) {
        docPaths.push(result.docPath);
      }
    });

    return {
      status: 'check_only',
      docPaths,
      staleness: stalenessMap,
    };
  }

  // Check staleness for all lenses
  const stalenessMap = new Map<LensName, StalenessCheckResult>();
  for (const lens of lenses) {
    const result = await checkStaleness(
      lensNameToType(lens),
      resolved.focus,
      projectRoot
    );
    stalenessMap.set(lens, result);
  }

  // Determine which lenses need regeneration
  const lensesToRegenerate: LensName[] = [];
  const freshDocPaths: string[] = [];

  Array.from(stalenessMap.entries()).forEach(([lens, status]) => {
    if (resolved.refresh || status.status !== 'FRESH') {
      lensesToRegenerate.push(lens);
    } else if (status.docPath) {
      freshDocPaths.push(status.docPath);
    }
  });

  // If all docs are fresh and no --refresh flag, return early
  if (lensesToRegenerate.length === 0) {
    return {
      status: 'fresh',
      docPaths: freshDocPaths,
      staleness: stalenessMap,
    };
  }

  // Detect available tools and select strategy
  const availability = detectToolsSync();
  const language = detectLanguageFromFocus(resolved.focus);
  const strategy = selectStrategy(availability, language);

  // Add warning for degraded mode
  if (strategy === 'grep') {
    warnings.push(
      'Using grep fallback. Update Claude Code for LSP support: `npm install -g @anthropics/claude-code@latest`'
    );
  } else if (strategy === 'ast') {
    warnings.push(
      'Using AST tools (ast-grep/semgrep). Update Claude Code for native LSP: `npm install -g @anthropics/claude-code@latest`'
    );
  }

  // Execute and generate reports for each lens
  const generatedPaths: string[] = [];

  for (const lens of lensesToRegenerate) {
    try {
      // Execute exploration
      const execResult = await executeSingleLens(lens, resolved.focus, resolved, strategy);

      // Generate report
      const report = await generateReport(execResult, {
        includeSnippets: true,
        projectRoot,
      });

      generatedPaths.push(report.path);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Failed to generate ${lens} report: ${message}`);
    }
  }

  return {
    status: 'generated',
    docPaths: [...freshDocPaths, ...generatedPaths],
    staleness: stalenessMap,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Check if spelunk execution is available with any strategy
 */
export function isSpelunkAvailable(): boolean {
  // Spelunk always has at least grep fallback available
  return true;
}

/**
 * Get a summary of available spelunk capabilities
 */
export function getSpelunkCapabilities(): {
  lsp: boolean;
  ast: boolean;
  grep: boolean;
  preferredStrategy: ExplorationStrategy;
} {
  const availability = detectToolsSync();

  return {
    lsp: availability.lsp.enabled,
    ast: availability.ast.astGrep || availability.ast.semgrep,
    grep: true, // Always available
    preferredStrategy: getStrategyForLanguage('typescript', availability),
  };
}

// =============================================================================
// Two-Phase Workflow
// =============================================================================

/**
 * Execute a two-phase spelunk workflow for agent delegation.
 *
 * This function supports a workflow where:
 * - Phase 1: Planner returns LSP tool call specifications
 * - Phase 2: Agent executes the specs (external to this function)
 * - Phase 3: Processor filters and transforms the results
 *
 * @param options - Configuration for the spelunk operation
 * @returns Promise resolving to SpelunkTwoPhaseResult
 *
 * @example
 * // Phase 1: Get the plan
 * const { plan } = await spelunkTwoPhase({
 *   lens: 'interfaces',
 *   focus: 'authentication',
 *   projectRoot: '/project'
 * });
 *
 * // Phase 2: Agent executes plan.toolCalls and collects results
 * // (handled externally)
 *
 * // Phase 3: Process the results
 * const { output } = await spelunkTwoPhase({
 *   lens: 'interfaces',
 *   focus: 'authentication',
 *   projectRoot: '/project',
 *   lspResults: collectedResults
 * });
 */
export async function spelunkTwoPhase(
  options: SpelunkTwoPhaseOptions
): Promise<SpelunkTwoPhaseResult> {
  const {
    lens,
    focus,
    projectRoot = process.cwd(),
    maxFiles = 50,
    maxDepth = 3,
    maxOutput = 500,
    lspResults,
    skipLsp = false,
    executeOnFallback = false,
  } = options;

  const warnings: string[] = [];

  // Detect available tools
  const availability = detectToolsSync();
  const lspAvailable = availability.lsp.enabled && !skipLsp;

  // Determine fallback strategy if LSP is not available
  let fallbackStrategy: 'ast' | 'grep' | undefined;
  if (!lspAvailable) {
    if (availability.ast.astGrep || availability.ast.semgrep) {
      fallbackStrategy = 'ast';
    } else {
      fallbackStrategy = 'grep';
    }
  }

  // Phase 1: Plan the exploration
  const plan = await planSpelunk(lens, focus, {
    projectRoot,
    maxFiles,
    maxDepth,
  });

  // If we have LSP results, process them (Phase 3)
  let output: SpelunkOutput | undefined;
  if (lspResults) {
    output = await processLspResults(plan, lspResults, {
      maxOutput,
    });
  } else if (fallbackStrategy && executeOnFallback) {
    // Execute fallback if requested and LSP not available
    const fallbackOutput = await executeFallbackStrategy(
      lens,
      focus,
      fallbackStrategy,
      projectRoot,
      maxFiles,
      maxDepth
    );
    output = fallbackOutput;
    if (fallbackStrategy === 'ast') {
      warnings.push(
        'Using AST fallback. For better results, enable LSP support.'
      );
    } else {
      warnings.push(
        'Using grep fallback. Install ast-grep or semgrep for better results.'
      );
    }
  }

  return {
    plan,
    output,
    fallbackStrategy,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Execute fallback strategy when LSP is not available
 */
async function executeFallbackStrategy(
  lens: LensType,
  focus: string,
  strategy: 'ast' | 'grep',
  projectRoot: string,
  maxFiles: number,
  maxDepth: number
): Promise<SpelunkOutput> {
  if (strategy === 'ast') {
    const result = await executeAstFallback(lens, focus, {
      maxFiles,
      maxDepth,
      projectRoot,
    });

    return {
      lens,
      focus,
      entries: result.entries.map((e) => ({
        name: e.symbolName || e.text.slice(0, 50),
        kind: 'match',
        filePath: e.filePath,
        line: e.line,
        snippet: e.text,
        description: `Matched pattern: ${e.matchedPattern}`,
      })),
      filesExamined: result.filesExamined,
    };
  }

  // Grep fallback - minimal implementation
  return {
    lens,
    focus,
    entries: [],
    filesExamined: [],
    warnings: ['Grep fallback provides limited results. Consider installing AST tools.'],
  };
}
