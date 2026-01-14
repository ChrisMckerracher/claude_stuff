/**
 * Spelunk Result Processor
 *
 * Processes LSP results returned by the AI agent.
 * Applies lens filtering to extract only relevant information.
 *
 * @see docs/plans/architect/spelunker-lsp-improvements.md
 */

import type {
  LensType,
  SpelunkPlan,
  SpelunkResults,
  SpelunkOutput,
  ExplorationEntry,
  LspSymbolInfo,
  LspLocation,
  LspHoverResult,
} from './types';
import { getLens } from './lens-specs';
import { uriToPath } from './file-finder';

/**
 * Processor options for controlling output
 */
export interface ProcessorOptions {
  /** Maximum number of entries to output (default: 500) */
  maxOutput?: number;
  /** Whether to include code snippets (default: true) */
  includeSnippets?: boolean;
  /** Maximum lines per snippet (default: 20) */
  snippetMaxLines?: number;
}

/**
 * Mapping from LSP SymbolKind numbers to string names
 */
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

/**
 * Mapping from SymbolKind string to LSP number(s)
 */
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

/**
 * Process LSP results returned by the agent
 *
 * Takes raw LSP results from the agent and applies lens filtering
 * to extract only relevant information.
 *
 * @param plan - The original spelunk plan
 * @param results - LSP results returned by the agent
 * @param options - Processor options
 * @returns Processed output with filtered entries
 *
 * @example
 * const output = await processLspResults(plan, {
 *   documentSymbols: {
 *     'file:///path/to/file.ts': [
 *       { name: 'AuthHandler', kind: 5, location: {...} }
 *     ]
 *   },
 *   references: {},
 *   hovers: {}
 * });
 */
export async function processLspResults(
  plan: SpelunkPlan,
  results: SpelunkResults,
  options: ProcessorOptions = {}
): Promise<SpelunkOutput> {
  const lensSpec = getLens(plan.lens);
  const entries: ExplorationEntry[] = [];
  const maxOutput = options.maxOutput ?? 500;
  const warnings: string[] = [];

  // Process documentSymbol results
  for (const [uri, symbols] of Object.entries(results.documentSymbols)) {
    const filePath = uriToPath(uri);

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
      const endLine = symbol.location.range.end.line + 1;

      // Get hover info if available
      const hoverKey = `${uri}:${symbol.location.range.start.line}:${symbol.location.range.start.character}`;
      const hover = results.hovers[hoverKey];
      const signature = extractHoverContent(hover);

      // Build entry
      const entry: ExplorationEntry = {
        name: symbol.name,
        kind: symbolKindToString(symbol.kind),
        filePath,
        line,
        endLine,
        signature,
        description: signature,
      };

      // Add references if available (for flows/boundaries lenses)
      if ((plan.lens === 'flows' || plan.lens === 'boundaries') && results.references) {
        const refKey = `${uri}:${symbol.name}`;
        const refs = results.references[refKey];
        if (refs && refs.length > 0) {
          entry.references = refs.map((ref) => {
            const refPath = uriToPath(ref.uri);
            return `${refPath}:${ref.range.start.line + 1}`;
          }).slice(0, 20); // Limit references
        }
      }

      entries.push(entry);

      if (entries.length >= maxOutput) {
        warnings.push(`Output truncated at ${maxOutput} entries`);
        break;
      }
    }

    if (entries.length >= maxOutput) {
      break;
    }
  }

  return {
    lens: plan.lens,
    focus: plan.focus,
    entries,
    filesExamined: plan.filesToExamine,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Convert LSP symbol kind number to string name
 */
export function symbolKindToString(kind: number): string {
  return LSP_SYMBOL_KIND_MAP[kind] ?? 'unknown';
}

/**
 * Extract hover content as a string
 */
export function extractHoverContent(hover: LspHoverResult | undefined): string | undefined {
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
 * Check if a symbol kind matches the filter
 */
function matchesSymbolFilter(
  kind: number,
  filters?: import('./lens-specs').SymbolKind[]
): boolean {
  if (!filters || filters.length === 0) {
    return true;
  }

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
