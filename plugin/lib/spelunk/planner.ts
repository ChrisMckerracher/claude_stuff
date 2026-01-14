/**
 * Spelunk Planner - Returns Tool Call Specifications
 *
 * The planner analyzes the focus area and returns a specification of
 * what LSP tool calls the AI agent should perform. It does NOT execute
 * any LSP operations itself - that's delegated to the agent.
 *
 * @see docs/plans/architect/spelunker-lsp-improvements.md
 */

import type { LensType, LspToolCall, SpelunkPlan, LspOperation } from './types';
import { getLens } from './lens-specs';
import { findFilesInFocus, pathToUri } from './file-finder';

/**
 * Planner options for controlling scope and depth
 */
export interface PlannerOptions {
  /** Maximum number of files to examine (default: 50) */
  maxFiles?: number;
  /** Project root directory (default: cwd) */
  projectRoot?: string;
  /** Maximum depth for reference tracing (default: 3) */
  maxDepth?: number;
}

/**
 * Symbol discovered during planning for phase 2 reference finding
 */
export interface DiscoveredSymbol {
  name: string;
  uri: string;
  position: { line: number; character: number };
  kind: number;
}

/**
 * Plan a spelunk operation
 *
 * Returns a specification of WHAT to explore, not the results.
 * The AI agent will execute the LSP tool calls and pass results to the processor.
 *
 * @param lens - The lens type to apply
 * @param focus - The focus area to explore (e.g., "authentication layer")
 * @param options - Planner options
 * @returns SpelunkPlan with files to examine and tool calls to make
 *
 * @example
 * const plan = await planSpelunk('interfaces', 'authentication', { maxFiles: 20 });
 * // Returns:
 * // {
 * //   filesToExamine: ['src/auth/handler.ts', 'src/auth/types.ts'],
 * //   toolCalls: [
 * //     { operation: 'documentSymbol', uri: 'file:///path/to/handler.ts' },
 * //     { operation: 'documentSymbol', uri: 'file:///path/to/types.ts' }
 * //   ],
 * //   lens: 'interfaces',
 * //   focus: 'authentication'
 * // }
 */
export async function planSpelunk(
  lens: LensType,
  focus: string,
  options: PlannerOptions = {}
): Promise<SpelunkPlan> {
  const lensSpec = getLens(lens);
  const projectRoot = options.projectRoot ?? process.cwd();
  const maxFiles = options.maxFiles ?? 50;

  // Find files to examine based on focus and lens specifications
  const files = await findFilesInFocus(focus, lensSpec, projectRoot, maxFiles);

  // Build tool call specifications based on lens operations
  const toolCalls: LspToolCall[] = [];

  for (const file of files) {
    const uri = pathToUri(file);

    // Add documentSymbol call for each file (primary operation)
    if (lensSpec.lsp.operations.includes('documentSymbol')) {
      toolCalls.push({
        operation: 'documentSymbol',
        uri,
      });
    }
  }

  // Note: findReferences and hover are handled in phase 2
  // after documentSymbol results are available

  return {
    filesToExamine: files,
    toolCalls,
    lens,
    focus,
  };
}

/**
 * Plan phase 2: findReferences and hover for discovered symbols
 *
 * Called after the agent has executed phase 1 documentSymbol calls.
 * Takes the discovered symbols and returns tool calls for finding
 * references and getting hover information.
 *
 * @param symbols - Symbols discovered from phase 1 documentSymbol calls
 * @param options - Planner options
 * @returns LSP tool calls for references and hover
 *
 * @example
 * const symbols = [
 *   { name: 'authenticate', uri: 'file:///path.ts', position: { line: 10, character: 0 }, kind: 12 }
 * ];
 * const phase2Calls = await planReferencesPhase(symbols, { maxDepth: 2 });
 * // Returns tool calls for findReferences and hover on each symbol
 */
export async function planReferencesPhase(
  symbols: DiscoveredSymbol[],
  options: PlannerOptions = {}
): Promise<LspToolCall[]> {
  const maxDepth = options.maxDepth ?? 3;
  const maxSymbols = 50; // Limit to avoid overwhelming the agent

  const toolCalls: LspToolCall[] = [];

  for (const symbol of symbols.slice(0, maxSymbols)) {
    // Add findReferences call for each symbol
    toolCalls.push({
      operation: 'findReferences',
      uri: symbol.uri,
      position: symbol.position,
    });

    // Add hover call for type information
    toolCalls.push({
      operation: 'hover',
      uri: symbol.uri,
      position: symbol.position,
    });
  }

  return toolCalls;
}

/**
 * Extract symbols from LSP documentSymbol results for phase 2 planning
 *
 * The agent calls this after getting documentSymbol results to determine
 * which symbols should have findReferences/hover calls in phase 2.
 *
 * @param documentSymbols - documentSymbol results from LSP
 * @param lensSpec - Lens specification for filtering
 * @param maxSymbols - Maximum symbols to return (default: 50)
 * @returns Symbols for phase 2 reference finding
 */
export function extractSymbolsForPhase2(
  documentSymbols: Record<string, import('./types').LspSymbolInfo[]>,
  lensSpec: import('./lens-specs').LensSpec,
  maxSymbols: number = 50
): DiscoveredSymbol[] {
  const symbols: DiscoveredSymbol[] = [];

  for (const [uri, symbolList] of Object.entries(documentSymbols)) {
    for (const symbol of symbolList) {
      // Apply lens filters
      if (!matchesSymbolFilter(symbol.kind, lensSpec.lsp.symbolFilters)) {
        continue;
      }

      if (!matchesExtractPatterns(symbol.name, lensSpec.extractPatterns)) {
        continue;
      }

      if (matchesIgnorePatterns(symbol.name, uri, lensSpec.ignorePatterns)) {
        continue;
      }

      symbols.push({
        name: symbol.name,
        uri,
        position: {
          line: symbol.location.range.start.line,
          character: symbol.location.range.start.character,
        },
        kind: symbol.kind,
      });

      if (symbols.length >= maxSymbols) {
        return symbols;
      }
    }
  }

  return symbols;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a symbol kind matches the filter
 */
function matchesSymbolFilter(kind: number, filters?: import('./lens-specs').SymbolKind[]): boolean {
  if (!filters || filters.length === 0) {
    return true;
  }

  const SYMBOL_KIND_TO_LSP: Record<import('./lens-specs').SymbolKind, number[]> = {
    interface: [11],
    type: [26],
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

  for (const filter of filters) {
    const lspKinds = SYMBOL_KIND_TO_LSP[filter] ?? [];
    if (lspKinds.includes(kind)) {
      return true;
    }
  }

  return false;
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
        if (testString.toLowerCase().includes(pattern.toLowerCase())) {
          return true;
        }
      }
    }
  }

  return false;
}
