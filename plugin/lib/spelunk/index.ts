/**
 * Spelunk Module
 *
 * This module provides:
 * - Command parsing for the `/code spelunk` subcommand
 * - Persistence layer for spelunk documentation
 * - Types and utilities for codebase exploration
 *
 * @module spelunk
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

// Re-export persistence types
export {
  LensType,
  ToolChain,
  SpelunkFrontmatter,
  StalenessIndex,
  StalenessDocEntry,
  SourceFileEntry,
  DocStatus,
  StalenessCheckResult,
  LENS_DIRECTORIES,
  SPELUNK_DIRECTORIES,
  MAX_SLUG_LENGTH,
  HASH_LENGTH,
} from './types';

// Re-export LSP tool call delegation types (new for delegation)
export {
  type LspOperation as LspToolCallOperation,
  type LspToolCall,
  type SpelunkPlan,
  type SpelunkResults,
  type SpelunkOutput,
} from './types';

// Re-export planner types
export {
  type PlannerOptions,
  type DiscoveredSymbol,
} from './planner';

// Re-export planner functions
export {
  planSpelunk,
  planReferencesPhase,
  extractSymbolsForPhase2,
} from './planner';

// Re-export file-finder functions
export {
  findEntryPointFiles,
  findFilesInFocus,
  isDirectory,
  pathToUri,
  uriToPath,
  focusToSlug as focusToSlugFromFileFinder,
} from './file-finder';

// Re-export persistence functions
export {
  toSlug,
  computeHash,
  ensureDirectoryStructure,
  writeSpelunkDoc,
  updateStalenessIndex,
  readStalenessIndex,
  getSpelunkDocPath,
  spelunkDocExists,
} from './persistence';

// Re-export staleness check functions
export {
  checkStaleness,
  checkMultipleLenses,
  checkLensDirectory,
} from './staleness-check';

// Re-export parser types
export {
  type AgentType,
  type LensName,
  type SpelunkOptions,
} from './parser';

// Re-export parser functions
export {
  parseSpelunkArgs,
  resolveLenses,
  withDefaults,
  focusToSlug,
} from './parser';

// Re-export parser constants
export {
  AGENT_TO_LENSES,
  VALID_LENSES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OUTPUT,
  SpelunkParseError,
} from './parser';

// Re-export AST executor types
export {
  type ExplorationEntry,
  type AstExecutionResult,
  type AstExecutionOptions,
} from './ast-executor';

// Re-export AST executor functions
export {
  executeAstFallback,
  isAstAvailable,
  getPreferredTool,
  getAvailablePatterns,
} from './ast-executor';

// Re-export report generator types
export {
  type ExplorationEntry as ReportExplorationEntry,
  type ExecutionResult,
  type LspExecutionResult,
  type AstExecutionResult as ReportAstExecutionResult,
  type ReportOptions,
  type GeneratedReport,
} from './report-generator';

// Re-export report generator functions
export {
  generateReport,
  formatInterfacesReport,
  formatFlowsReport,
  formatBoundariesReport,
  formatContractsReport,
  formatTrustZonesReport,
} from './report-generator';

// Re-export LSP executor types
export {
  type LspExplorationEntry,
  type LensExecutionResult,
  type LspExecutionOptions,
  type LspSymbolInfo,
  type LspHoverResult,
  type LspLocation,
} from './lsp-executor';

// Re-export LSP executor functions
export {
  executeLens,
  executeLenses,
  isLspAvailable,
  getSupportedLanguages,
  getLanguageForFile,
} from './lsp-executor';

// Re-export index maintenance types
export { type IndexEntry } from './index-maintenance';

// Re-export index maintenance functions
export {
  generateIndex,
  updateIndex,
  getIndexEntries,
} from './index-maintenance';

// Re-export orchestrator types
export { type SpelunkResult } from './orchestrator';

// Re-export orchestrator functions
export {
  spelunk,
  isSpelunkAvailable,
  getSpelunkCapabilities,
} from './orchestrator';

// Re-export tool detection types
export {
  type ToolAvailability,
  type ExplorationStrategy,
} from './tool-detection';

// Re-export tool detection functions and constants
export {
  detectTools,
  detectToolsSync,
  getStrategyForLanguage,
  getStrategyForFile,
  getToolSummary,
  shouldWarnAboutDegradedMode,
  getPreferredAstTool,
  LSP_SERVERS,
  EXTENSION_TO_LANGUAGE,
} from './tool-detection';

// Re-export lens specs types
export {
  type LensSpec,
  type LspOperation,
  type SymbolKind,
  type LspConfig,
  type AstPatterns,
  type GrepPatterns,
} from './lens-specs';

// Re-export lens specs functions and constants
export {
  LENS_SPECS,
  AGENT_DEFAULT_LENSES,
  getLensesForAgent,
  getLens,
  getLensNames,
  getAgentNames,
} from './lens-specs';
