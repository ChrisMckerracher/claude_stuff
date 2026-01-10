/**
 * Spelunk Report Generator
 *
 * Formats exploration results into readable Markdown with YAML frontmatter.
 * Writes reports to docs/spelunk/ directories based on lens type.
 *
 * See: docs/plans/architect/coding-agent-spelunking-mode.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  LensType,
  ToolChain,
  LENS_DIRECTORIES,
} from './types';
import {
  writeSpelunkDoc,
  toSlug,
  ensureDirectoryStructure,
} from './persistence';

/**
 * A single exploration entry discovered during spelunking.
 *
 * This is the enriched format used for report generation, which extends
 * the base format from ast-executor with additional fields for formatting.
 */
export interface ExplorationEntry {
  /** Name of the discovered item (interface, function, class, etc.) */
  name: string;
  /** Kind of item (interface, type, function, class, handler, module, etc.) */
  kind: string;
  /** Path to the source file */
  filePath: string;
  /** Starting line number */
  line: number;
  /** Ending line number (optional) */
  endLine?: number;
  /** Code snippet (optional) */
  snippet?: string;
  /** Human-readable description (optional) */
  description?: string;
  /** Call chain for flow analysis (optional) */
  callChain?: string[];
  /** Exports for module boundaries (optional) */
  exports?: string[];
  /** Dependencies for boundary analysis (optional) */
  dependencies?: string[];
  /** Trust level for security analysis (optional) */
  trustLevel?: string;
}

/**
 * Alias for backward compatibility with LspExecutionResult naming
 */
export type LspExecutionResult = ExecutionResult;

/**
 * Alias for backward compatibility with AstExecutionResult naming
 */
export type AstExecutionResult = ExecutionResult;

/**
 * Result from LSP or AST-based exploration
 */
export interface ExecutionResult {
  /** The lens used for exploration */
  lens: LensType;
  /** The focus area explored */
  focus: string;
  /** Tool chain used (lsp, ast-grep, grep-fallback) */
  toolChain: ToolChain;
  /** Discovered entries */
  entries: ExplorationEntry[];
  /** Source files that were analyzed */
  sourceFiles: string[];
}

/**
 * Options for report generation
 */
export interface ReportOptions {
  /** Include code snippets in the report (default: true) */
  includeSnippets?: boolean;
  /** Maximum lines per snippet (default: 15) */
  maxSnippetLines?: number;
  /** Update the _index.md file (default: false) */
  updateIndex?: boolean;
  /** Project root directory (default: process.cwd()) */
  projectRoot?: string;
}

/**
 * Result of generating a report
 */
export interface GeneratedReport {
  /** Absolute path to the written file */
  path: string;
  /** Relative path from project root */
  relativePath: string;
  /** Lens type used */
  lens: LensType;
  /** Focus area */
  focus: string;
  /** Number of entries in the report */
  entriesCount: number;
}

// Default options
const DEFAULT_OPTIONS: Required<Omit<ReportOptions, 'projectRoot'>> = {
  includeSnippets: true,
  maxSnippetLines: 15,
  updateIndex: false,
};

/**
 * Generate a spelunk report from exploration results.
 *
 * @param result - The exploration result to format
 * @param options - Report generation options
 * @returns Information about the generated report
 */
export async function generateReport(
  result: ExecutionResult,
  options: ReportOptions = {}
): Promise<GeneratedReport> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    projectRoot: options.projectRoot ?? process.cwd(),
  };

  // Format the content based on lens type
  const content = formatReportContent(result, opts);

  // Write the document using the persistence layer
  const absolutePath = await writeSpelunkDoc(
    result.lens,
    result.focus,
    content,
    result.sourceFiles,
    {
      projectRoot: opts.projectRoot,
      toolChain: result.toolChain,
    }
  );

  // Get relative path
  const directory = LENS_DIRECTORIES[result.lens];
  const slug = toSlug(result.focus);
  const relativePath = path.join('docs/spelunk', directory, `${slug}.md`);

  // Update index if requested
  if (opts.updateIndex) {
    await updateIndexFile(result.lens, result.focus, slug, opts.projectRoot);
  }

  return {
    path: absolutePath,
    relativePath,
    lens: result.lens,
    focus: result.focus,
    entriesCount: result.entries.length,
  };
}

/**
 * Format the main report content based on lens type.
 */
function formatReportContent(
  result: ExecutionResult,
  opts: Required<Omit<ReportOptions, 'projectRoot'>> & { projectRoot: string }
): string {
  const formatOptions = {
    includeSnippets: opts.includeSnippets,
    maxSnippetLines: opts.maxSnippetLines,
  };

  switch (result.lens) {
    case 'interfaces':
      return formatInterfacesReport(result.entries, formatOptions);
    case 'flows':
      return formatFlowsReport(result.entries, formatOptions);
    case 'boundaries':
      return formatBoundariesReport(result.entries, formatOptions);
    case 'contracts':
      return formatContractsReport(result.entries, formatOptions);
    case 'trust-zones':
      return formatTrustZonesReport(result.entries, formatOptions);
    default:
      return formatInterfacesReport(result.entries, formatOptions);
  }
}

/**
 * Truncate a snippet to the maximum number of lines.
 */
function truncateSnippet(snippet: string, maxLines: number): string {
  const lines = snippet.split('\n');
  if (lines.length <= maxLines) {
    return snippet;
  }
  return lines.slice(0, maxLines).join('\n') + '\n  // ... (truncated)';
}

/**
 * Format a code block with optional truncation.
 */
function formatCodeBlock(
  snippet: string | undefined,
  opts: { includeSnippets: boolean; maxSnippetLines: number }
): string {
  if (!opts.includeSnippets || !snippet) {
    return '';
  }
  const truncated = truncateSnippet(snippet, opts.maxSnippetLines);
  return `\`\`\`typescript\n${truncated}\n\`\`\`\n`;
}

/**
 * Group entries by kind.
 */
function groupByKind(entries: ExplorationEntry[]): Map<string, ExplorationEntry[]> {
  const groups = new Map<string, ExplorationEntry[]>();
  for (const entry of entries) {
    const kind = entry.kind;
    if (!groups.has(kind)) {
      groups.set(kind, []);
    }
    groups.get(kind)!.push(entry);
  }
  return groups;
}

/**
 * Generate an overview section with counts.
 */
function generateOverview(entries: ExplorationEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const groups = groupByKind(entries);
  const counts: string[] = [];

  for (const [kind, items] of groups) {
    const plural = items.length === 1 ? kind : `${kind}s`;
    counts.push(`${items.length} ${plural}`);
  }

  const fileCount = new Set(entries.map(e => e.filePath)).size;

  return `## Overview

Found ${counts.join(', ')} across ${fileCount} file${fileCount === 1 ? '' : 's'}.

`;
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Format entries for a section.
 */
function formatEntries(
  entries: ExplorationEntry[],
  opts: { includeSnippets: boolean; maxSnippetLines: number }
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    const location = entry.endLine
      ? `${entry.filePath}:${entry.line}-${entry.endLine}`
      : `${entry.filePath}:${entry.line}`;

    lines.push(`### ${entry.name} (${location})`);

    if (entry.description) {
      lines.push(`\n${entry.description}\n`);
    }

    if (entry.snippet && opts.includeSnippets) {
      lines.push(formatCodeBlock(entry.snippet, opts));
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// Lens-specific formatters
// ============================================================================

interface FormatOptions {
  includeSnippets?: boolean;
  maxSnippetLines?: number;
}

const defaultFormatOptions: Required<FormatOptions> = {
  includeSnippets: true,
  maxSnippetLines: 15,
};

/**
 * Format a report for the interfaces lens.
 * Groups by kind (interface, type, class) and includes type signatures.
 */
export function formatInterfacesReport(
  entries: ExplorationEntry[],
  options: FormatOptions = {}
): string {
  const opts = { ...defaultFormatOptions, ...options };

  if (entries.length === 0) {
    return '## Overview\n\nNo interfaces found in the specified focus area.\n';
  }

  const lines: string[] = [];

  // Overview
  lines.push(generateOverview(entries));

  // Group by kind
  const groups = groupByKind(entries);

  // Format each group
  for (const [kind, items] of groups) {
    lines.push(`## ${capitalize(kind)}s\n`);
    lines.push(formatEntries(items, opts));
  }

  return lines.join('\n');
}

/**
 * Format a report for the flows lens.
 * Shows entry points, handlers, and call chains.
 */
export function formatFlowsReport(
  entries: ExplorationEntry[],
  options: FormatOptions = {}
): string {
  const opts = { ...defaultFormatOptions, ...options };

  if (entries.length === 0) {
    return '## Overview\n\nNo flows found in the specified focus area.\n';
  }

  const lines: string[] = [];

  // Overview
  lines.push(generateOverview(entries));

  // Group handlers and entry points
  const handlers = entries.filter(e => e.kind === 'handler' || e.kind === 'route');
  const functions = entries.filter(e => e.kind === 'function' || e.kind === 'method');
  const others = entries.filter(e => !['handler', 'route', 'function', 'method'].includes(e.kind));

  // Entry points section
  if (handlers.length > 0) {
    lines.push('## Entry Points\n');
    for (const entry of handlers) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);
      if (entry.description) {
        lines.push(`\n**Route:** ${entry.description}\n`);
      }
      if (entry.callChain && entry.callChain.length > 0) {
        lines.push('\n**Call chain:**');
        for (const call of entry.callChain) {
          lines.push(`- ${call}`);
        }
        lines.push('');
      }
      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Functions section
  if (functions.length > 0) {
    lines.push('## Functions\n');
    for (const entry of functions) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);
      if (entry.description) {
        lines.push(`\n${entry.description}\n`);
      }
      if (entry.callChain && entry.callChain.length > 0) {
        lines.push('\n**Calls:**');
        for (const call of entry.callChain) {
          lines.push(`- ${call}`);
        }
        lines.push('');
      }
      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Other entries
  if (others.length > 0) {
    const groups = groupByKind(others);
    for (const [kind, items] of groups) {
      lines.push(`## ${capitalize(kind)}s\n`);
      lines.push(formatEntries(items, opts));
    }
  }

  return lines.join('\n');
}

/**
 * Format a report for the boundaries lens.
 * Shows module exports, dependencies, and communication patterns.
 */
export function formatBoundariesReport(
  entries: ExplorationEntry[],
  options: FormatOptions = {}
): string {
  const opts = { ...defaultFormatOptions, ...options };

  if (entries.length === 0) {
    return '## Overview\n\nNo boundaries found in the specified focus area.\n';
  }

  const lines: string[] = [];

  // Overview
  lines.push(generateOverview(entries));

  // Group by kind
  const modules = entries.filter(e => e.kind === 'module');
  const classes = entries.filter(e => e.kind === 'class');
  const others = entries.filter(e => !['module', 'class'].includes(e.kind));

  // Modules section
  if (modules.length > 0) {
    lines.push('## Modules\n');
    for (const entry of modules) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);

      if (entry.exports && entry.exports.length > 0) {
        lines.push('\n**Exports:**');
        for (const exp of entry.exports) {
          lines.push(`- ${exp}`);
        }
        lines.push('');
      }

      if (entry.dependencies && entry.dependencies.length > 0) {
        lines.push('**Dependencies:**');
        for (const dep of entry.dependencies) {
          lines.push(`- ${dep}`);
        }
        lines.push('');
      }

      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Classes section
  if (classes.length > 0) {
    lines.push('## Classes\n');
    for (const entry of classes) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);

      if (entry.dependencies && entry.dependencies.length > 0) {
        lines.push('\n**Dependencies:**');
        for (const dep of entry.dependencies) {
          lines.push(`- ${dep}`);
        }
        lines.push('');
      }

      if (entry.exports && entry.exports.length > 0) {
        lines.push('**Exports:**');
        for (const exp of entry.exports) {
          lines.push(`- ${exp}`);
        }
        lines.push('');
      }

      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Other entries
  if (others.length > 0) {
    const groups = groupByKind(others);
    for (const [kind, items] of groups) {
      lines.push(`## ${capitalize(kind)}s\n`);
      lines.push(formatEntries(items, opts));
    }
  }

  return lines.join('\n');
}

/**
 * Format a report for the contracts lens.
 * Shows input/output schemas, validation rules, and error types.
 */
export function formatContractsReport(
  entries: ExplorationEntry[],
  options: FormatOptions = {}
): string {
  const opts = { ...defaultFormatOptions, ...options };

  if (entries.length === 0) {
    return '## Overview\n\nNo contracts found in the specified focus area.\n';
  }

  const lines: string[] = [];

  // Overview
  lines.push(generateOverview(entries));

  // Group by kind
  const groups = groupByKind(entries);

  // Format each group
  for (const [kind, items] of groups) {
    lines.push(`## ${capitalize(kind)}s\n`);
    lines.push(formatEntries(items, opts));
  }

  return lines.join('\n');
}

/**
 * Format a report for the trust-zones lens.
 * Shows auth checks, sanitization, and privilege boundaries.
 */
export function formatTrustZonesReport(
  entries: ExplorationEntry[],
  options: FormatOptions = {}
): string {
  const opts = { ...defaultFormatOptions, ...options };

  if (entries.length === 0) {
    return '## Overview\n\nNo trust zones found in the specified focus area.\n';
  }

  const lines: string[] = [];

  // Overview
  lines.push(generateOverview(entries));

  // Categorize entries by trust-related attributes
  const authEntries = entries.filter(e =>
    e.name.toLowerCase().includes('auth') ||
    e.description?.toLowerCase().includes('auth') ||
    e.description?.toLowerCase().includes('jwt') ||
    e.description?.toLowerCase().includes('token')
  );

  const authzEntries = entries.filter(e =>
    e.trustLevel ||
    e.name.toLowerCase().includes('role') ||
    e.name.toLowerCase().includes('permission') ||
    e.name.toLowerCase().includes('require')
  );

  const otherEntries = entries.filter(e =>
    !authEntries.includes(e) && !authzEntries.includes(e)
  );

  // Authentication section
  if (authEntries.length > 0) {
    lines.push('## Authentication\n');
    for (const entry of authEntries) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);
      if (entry.description) {
        lines.push(`\n${entry.description}\n`);
      }
      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Authorization section
  if (authzEntries.length > 0) {
    lines.push('## Authorization\n');

    // Group by trust level if available
    const byTrustLevel = new Map<string, ExplorationEntry[]>();
    const noTrustLevel: ExplorationEntry[] = [];

    for (const entry of authzEntries) {
      if (entry.trustLevel) {
        if (!byTrustLevel.has(entry.trustLevel)) {
          byTrustLevel.set(entry.trustLevel, []);
        }
        byTrustLevel.get(entry.trustLevel)!.push(entry);
      } else {
        noTrustLevel.push(entry);
      }
    }

    // Format by trust level
    for (const [level, items] of byTrustLevel) {
      lines.push(`### Trust Level: ${level}\n`);
      for (const entry of items) {
        const location = `${entry.filePath}:${entry.line}`;
        lines.push(`#### ${entry.name} (${location})`);
        if (entry.description) {
          lines.push(`\n${entry.description}\n`);
        }
        if (entry.snippet && opts.includeSnippets) {
          lines.push(formatCodeBlock(entry.snippet, opts));
        }
        lines.push('');
      }
    }

    // Format entries without trust level
    for (const entry of noTrustLevel) {
      const location = `${entry.filePath}:${entry.line}`;
      lines.push(`### ${entry.name} (${location})`);
      if (entry.description) {
        lines.push(`\n${entry.description}\n`);
      }
      if (entry.snippet && opts.includeSnippets) {
        lines.push(formatCodeBlock(entry.snippet, opts));
      }
      lines.push('');
    }
  }

  // Other security-related entries
  if (otherEntries.length > 0) {
    lines.push('## Other Security Boundaries\n');
    lines.push(formatEntries(otherEntries, opts));
  }

  return lines.join('\n');
}

// ============================================================================
// Index management
// ============================================================================

/**
 * Update the _index.md file with a new entry.
 */
async function updateIndexFile(
  lens: LensType,
  focus: string,
  slug: string,
  projectRoot: string
): Promise<void> {
  await ensureDirectoryStructure(projectRoot);

  const indexPath = path.join(projectRoot, 'docs/spelunk/_index.md');
  const directory = LENS_DIRECTORIES[lens];
  const docPath = `${directory}/${slug}.md`;

  let content: string;
  try {
    content = await fs.readFile(indexPath, 'utf-8');
  } catch {
    // Create new index file
    content = `# Spelunk Documentation Index

Last updated: ${new Date().toISOString()}

`;
  }

  // Check if entry already exists
  if (content.includes(docPath)) {
    // Update timestamp
    content = content.replace(
      /Last updated: .+/,
      `Last updated: ${new Date().toISOString()}`
    );
    await fs.writeFile(indexPath, content, 'utf-8');
    return;
  }

  // Find or create section for this directory
  const sectionHeader = `## ${capitalize(directory)}`;
  const tableHeader = '| Document | Focus | Last Updated |\n|----------|-------|--------------|';

  if (!content.includes(sectionHeader)) {
    // Add new section
    content += `\n${sectionHeader}\n${tableHeader}\n`;
  }

  // Find the section and add entry
  const sectionIndex = content.indexOf(sectionHeader);
  const nextSectionIndex = content.indexOf('\n## ', sectionIndex + sectionHeader.length);
  const insertPoint = nextSectionIndex === -1
    ? content.length
    : nextSectionIndex;

  const newEntry = `| [${slug}.md](${docPath}) | ${focus} | ${new Date().toISOString().split('T')[0]} |\n`;

  // Insert the new entry at the end of the section
  content = content.slice(0, insertPoint) + newEntry + content.slice(insertPoint);

  // Update timestamp
  content = content.replace(
    /Last updated: .+/,
    `Last updated: ${new Date().toISOString()}`
  );

  await fs.writeFile(indexPath, content, 'utf-8');
}
