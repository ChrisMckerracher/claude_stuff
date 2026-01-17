/**
 * Verify Cycle Parser
 *
 * Parses plain markdown files with Run: and When: lines for verify cycle definitions.
 * See: docs/plans/architect/verify-cycle-skill.md
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Represents a parsed verify cycle
 */
export interface VerifyCycle {
  /** Human-readable name extracted from markdown header */
  name: string;
  /** 'automated' if has Run: line, 'manual' otherwise */
  type: 'automated' | 'manual';
  /** Command to execute (only for automated cycles) */
  run?: string;
  /** Plain English description of when this cycle applies */
  when: string;
  /** Original filename for reference */
  filename: string;
  /** Full description content for context */
  description: string;
}

/**
 * Error thrown when a cycle file cannot be parsed
 */
export class ParseError extends Error {
  constructor(message: string, public filename: string) {
    super(`${filename}: ${message}`);
    this.name = 'ParseError';
  }
}

/**
 * Parse a verify cycle from markdown content
 *
 * @param content - Raw markdown file content
 * @param filename - Name of the file (for error messages and fallback name)
 * @returns Parsed VerifyCycle object
 * @throws ParseError if required fields are missing
 */
export function parseVerifyCycle(content: string, filename: string): VerifyCycle {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new ParseError('File is empty', filename);
  }

  const lines = trimmed.split('\n');

  // Extract name from first header line or first non-empty line
  let name = extractName(lines, filename);

  // Extract Run: line (optional - determines if automated)
  const runLine = lines.find(line => line.trim().toLowerCase().startsWith('run:'));
  const run = runLine ? runLine.replace(/^run:\s*/i, '').trim() : undefined;

  // Extract When: line (required)
  const whenLine = lines.find(line => line.trim().toLowerCase().startsWith('when:'));
  if (!whenLine) {
    throw new ParseError('Missing required When: line', filename);
  }
  const when = whenLine.replace(/^when:\s*/i, '').trim();

  // Determine type
  const type = run ? 'automated' : 'manual';

  // Extract description (everything after the parsed lines)
  const description = extractDescription(lines);

  return {
    name,
    type,
    run,
    when,
    filename,
    description,
  };
}

/**
 * Extract the cycle name from the content
 */
function extractName(lines: string[], filename: string): string {
  // Look for markdown header
  const headerLine = lines.find(line => line.trim().startsWith('#'));
  if (headerLine) {
    return headerLine.replace(/^#+\s*/, '').trim();
  }

  // Fall back to first non-empty, non-directive line
  const firstContentLine = lines.find(line => {
    const trimmed = line.trim();
    return trimmed &&
      !trimmed.toLowerCase().startsWith('run:') &&
      !trimmed.toLowerCase().startsWith('when:');
  });

  if (firstContentLine) {
    return firstContentLine.trim();
  }

  // Ultimate fallback: use filename without extension
  return filename.replace(/\.md$/, '');
}

/**
 * Extract the description from content (everything that's not metadata)
 */
function extractDescription(lines: string[]): string {
  const descriptionLines = lines.filter(line => {
    const trimmed = line.trim().toLowerCase();
    return !trimmed.startsWith('#') &&
      !trimmed.startsWith('run:') &&
      !trimmed.startsWith('when:');
  });

  return descriptionLines.join('\n').trim();
}

/**
 * Discover all verify cycles in a directory
 *
 * @param cyclesDir - Path to the verify-cycles directory
 * @returns Array of parsed VerifyCycle objects (invalid cycles are skipped with warning)
 */
export async function discoverCycles(cyclesDir: string): Promise<VerifyCycle[]> {
  // Check if directory exists
  if (!fs.existsSync(cyclesDir)) {
    return [];
  }

  const stat = fs.statSync(cyclesDir);
  if (!stat.isDirectory()) {
    return [];
  }

  const files = fs.readdirSync(cyclesDir)
    .filter(f => f.endsWith('.md'));

  const cycles: VerifyCycle[] = [];

  for (const file of files) {
    const filePath = path.join(cyclesDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const cycle = parseVerifyCycle(content, file);
      cycles.push(cycle);
    } catch (error) {
      if (error instanceof ParseError) {
        // Log warning but continue processing other cycles
        console.warn(`Warning: Skipping malformed cycle: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  return cycles;
}
