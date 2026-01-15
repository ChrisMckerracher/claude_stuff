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
export type ToolChain = 'lsp' | 'lsp-simulated' | 'ast-grep' | 'semgrep' | 'grep-fallback';

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

// =============================================================================
// LSP Tool Call Delegation Types
// =============================================================================

/**
 * LSP operations that can be delegated to the AI agent
 */
export type LspOperation = 'documentSymbol' | 'findReferences' | 'hover' | 'goToDefinition' | 'getDiagnostics';

/**
 * A single LSP tool call for the agent to execute
 */
export interface LspToolCall {
  /** The LSP operation to perform */
  operation: LspOperation;
  /** File URI for the operation (e.g., "file:///path/to/file.ts") */
  uri: string;
  /** Position for hover, goToDefinition operations */
  position?: { line: number; character: number };
}

/**
 * Result from the planner - specifies WHAT to explore
 *
 * The planner returns file paths and tool call specifications.
 * The AI agent executes these tool calls and passes results to the processor.
 */
export interface SpelunkPlan {
  /** Files to examine via LSP */
  filesToExamine: string[];
  /** LSP tool calls the agent should perform */
  toolCalls: LspToolCall[];
  /** Lens being applied */
  lens: LensType;
  /** Focus area */
  focus: string;
}

/**
 * LSP Symbol Information (subset of LSP spec)
 * This is what the agent returns from documentSymbol calls
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
 * LSP Location (subset of LSP spec)
 */
export interface LspLocation {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
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
 * LSP results returned by the agent after executing tool calls
 *
 * The agent collects these from LSP tool responses and passes to processor
 */
export interface SpelunkResults {
  /** documentSymbol results, keyed by file URI */
  documentSymbols: Record<string, LspSymbolInfo[]>;
  /** findReferences results, keyed by symbol identifier */
  references: Record<string, LspLocation[]>;
  /** hover results, keyed by position key (uri:line:character) */
  hovers: Record<string, LspHoverResult>;
}

/**
 * A single exploration entry after processing
 */
export interface ExplorationEntry {
  /** Symbol or match name */
  name: string;
  /** Symbol kind or match type */
  kind: string;
  /** File path */
  filePath: string;
  /** Line number (1-indexed) */
  line: number;
  /** End line for range */
  endLine?: number;
  /** Type signature or declaration */
  signature?: string;
  /** Code snippet */
  snippet?: string;
  /** References to this symbol (for flows/boundaries lenses) */
  references?: string[];
  /** Description or hover content */
  description?: string;
}

/**
 * Final processed output from the processor
 */
export interface SpelunkOutput {
  lens: LensType;
  focus: string;
  entries: ExplorationEntry[];
  filesExamined: string[];
  warnings?: string[];
}
