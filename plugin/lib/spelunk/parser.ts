/**
 * Spelunk Command Parser
 *
 * Parses command-line arguments for the `/code spelunk` subcommand.
 * Part of the Coding Agent spelunking mode feature.
 *
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

// Valid agent types that can be specified with --for
export type AgentType = 'architect' | 'product' | 'qa' | 'security';

// Valid lens names for codebase exploration
export type LensName =
  | 'interfaces'
  | 'flows'
  | 'boundaries'
  | 'contracts'
  | 'trust-zones';

/**
 * Parsed options for the spelunk command
 */
export interface SpelunkOptions {
  // What to analyze
  for?: AgentType;       // Agent-specific shorthand (auto-selects lens)
  lens?: LensName[];     // Explicit lenses (overrides --for)
  focus: string;         // Required: area to explore

  // Behavior modifiers
  refresh?: boolean;     // Force re-spelunk even if FRESH
  checkOnly?: boolean;   // Just check staleness, don't spelunk

  // Depth limits
  maxFiles?: number;     // Default: 50
  maxDepth?: number;     // Default: 3
  maxOutput?: number;    // Default: 500 lines
}

/**
 * Default depth limits
 */
export const DEFAULT_MAX_FILES = 50;
export const DEFAULT_MAX_DEPTH = 3;
export const DEFAULT_MAX_OUTPUT = 500;

/**
 * Mapping from agent type to default lenses
 */
export const AGENT_TO_LENSES: Record<AgentType, LensName[]> = {
  architect: ['interfaces', 'boundaries'],
  product: ['flows'],
  qa: ['contracts'],
  security: ['trust-zones', 'contracts'],
};

/**
 * List of all valid lens names
 */
export const VALID_LENSES: LensName[] = [
  'interfaces',
  'flows',
  'boundaries',
  'contracts',
  'trust-zones',
];

/**
 * Error thrown when parsing fails
 */
export class SpelunkParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpelunkParseError';
  }
}

/**
 * Parse a flag value from args string
 * Handles both --flag=value and --flag="value with spaces" formats
 */
function extractFlagValue(args: string, flag: string): string | undefined {
  // First check for empty value (--flag= followed by space or end)
  const emptyPattern = new RegExp(`--${flag}=(?=\\s|$)`, 'i');
  if (emptyPattern.test(args)) {
    return undefined; // Explicitly empty
  }

  // Pattern for --flag=value or --flag="value" or --flag='value'
  const patterns = [
    // --flag="value with spaces"
    new RegExp(`--${flag}="([^"]*)"`, 'i'),
    // --flag='value with spaces'
    new RegExp(`--${flag}='([^']*)'`, 'i'),
    // --flag=value (simple case - stops at whitespace, must not start with -)
    // This avoids matching the next flag as the value
    new RegExp(`--${flag}=([^\\s-][^\\s]*)`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = args.match(pattern);
    if (match) {
      const value = match[1];
      // Return undefined for empty values
      if (value === '' || value === undefined) {
        return undefined;
      }
      return value;
    }
  }

  return undefined;
}

/**
 * Check if a boolean flag is present
 */
function hasFlag(args: string, flag: string): boolean {
  // Match --flag as a standalone word (not part of another flag)
  const pattern = new RegExp(`(^|\\s)--${flag}(\\s|$)`, 'i');
  return pattern.test(args);
}

/**
 * Check if a flag with value is present (--flag= or --flag=value)
 */
function hasFlagWithValue(args: string, flag: string): boolean {
  const pattern = new RegExp(`--${flag}=`, 'i');
  return pattern.test(args);
}

/**
 * Extract a raw flag value (including numeric with negative sign)
 */
function extractRawFlagValue(args: string, flag: string): string | undefined {
  // Pattern that allows negative numbers: --flag=-123
  const pattern = new RegExp(`--${flag}=(-?[^\\s]+)`, 'i');
  const match = args.match(pattern);
  if (match) {
    return match[1];
  }
  return undefined;
}

/**
 * Parse a numeric flag value
 */
function extractNumericFlag(args: string, flag: string): number | undefined {
  const value = extractRawFlagValue(args, flag);
  if (value === undefined) {
    return undefined;
  }
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new SpelunkParseError(`--${flag} must be a positive number, got: ${value}`);
  }
  return num;
}

/**
 * Validate lens names against the allowed list
 */
function validateLenses(lenses: string[]): LensName[] {
  const validatedLenses: LensName[] = [];

  for (const lens of lenses) {
    const normalized = lens.trim().toLowerCase() as LensName;
    if (!VALID_LENSES.includes(normalized)) {
      const validList = VALID_LENSES.join(', ');
      throw new SpelunkParseError(
        `Unknown lens: "${lens}". Valid lenses are: ${validList}`
      );
    }
    validatedLenses.push(normalized);
  }

  return validatedLenses;
}

/**
 * Parse the spelunk command arguments
 *
 * @param args - The argument string after "/code spelunk"
 * @returns Parsed SpelunkOptions
 * @throws SpelunkParseError if validation fails
 *
 * @example
 * parseSpelunkArgs('--for=architect --focus="authentication layer"')
 * parseSpelunkArgs('--lens=interfaces,boundaries --focus="data layer"')
 * parseSpelunkArgs('--check --focus="auth"')
 * parseSpelunkArgs('--refresh --for=qa --focus="payment"')
 */
export function parseSpelunkArgs(args: string): SpelunkOptions {
  const trimmedArgs = args.trim();

  // Extract --for flag
  const forValue = extractFlagValue(trimmedArgs, 'for');
  let agentFor: AgentType | undefined;
  if (forValue) {
    const normalized = forValue.toLowerCase() as AgentType;
    const validAgents: AgentType[] = ['architect', 'product', 'qa', 'security'];
    if (!validAgents.includes(normalized)) {
      throw new SpelunkParseError(
        `Unknown agent type: "${forValue}". Valid types are: ${validAgents.join(', ')}`
      );
    }
    agentFor = normalized;
  }

  // Extract --lens flag (comma-separated)
  const lensValue = extractFlagValue(trimmedArgs, 'lens');
  let lenses: LensName[] | undefined;
  // Check if --lens= was specified but empty
  if (hasFlagWithValue(trimmedArgs, 'lens') && !lensValue) {
    throw new SpelunkParseError('--lens requires at least one lens name');
  }
  if (lensValue) {
    const lensArray = lensValue.split(',').map((l) => l.trim()).filter(Boolean);
    if (lensArray.length === 0) {
      throw new SpelunkParseError('--lens requires at least one lens name');
    }
    lenses = validateLenses(lensArray);
  }

  // Validate mutual exclusivity of --for and --lens
  if (agentFor && lenses) {
    throw new SpelunkParseError(
      '--for and --lens are mutually exclusive. Use --for for agent shorthand or --lens for explicit lenses.'
    );
  }

  // Extract --focus flag (required in most cases)
  const focus = extractFlagValue(trimmedArgs, 'focus');

  // Extract boolean flags
  const refresh = hasFlag(trimmedArgs, 'refresh');
  const checkOnly = hasFlag(trimmedArgs, 'check');

  // Extract depth limit flags
  const maxFiles = extractNumericFlag(trimmedArgs, 'max-files');
  const maxDepth = extractNumericFlag(trimmedArgs, 'max-depth');
  const maxOutput = extractNumericFlag(trimmedArgs, 'max-output');

  // Validate --focus requirement
  // --focus is required unless --check with no focus (lists all docs)
  if (!focus && !checkOnly) {
    throw new SpelunkParseError(
      '--focus is required. Specify the area to explore, e.g., --focus="authentication layer"'
    );
  }

  // Build the options object
  const options: SpelunkOptions = {
    focus: focus || '', // Empty string when --check without focus
  };

  if (agentFor) {
    options.for = agentFor;
  }
  if (lenses) {
    options.lens = lenses;
  }
  if (refresh) {
    options.refresh = true;
  }
  if (checkOnly) {
    options.checkOnly = true;
  }
  if (maxFiles !== undefined) {
    options.maxFiles = maxFiles;
  }
  if (maxDepth !== undefined) {
    options.maxDepth = maxDepth;
  }
  if (maxOutput !== undefined) {
    options.maxOutput = maxOutput;
  }

  return options;
}

/**
 * Resolve lenses from SpelunkOptions
 *
 * If --lens is specified, returns those lenses.
 * If --for is specified, returns the default lenses for that agent.
 * If neither is specified, returns all lenses.
 *
 * @param options - Parsed SpelunkOptions
 * @returns Array of lens names to use
 */
export function resolveLenses(options: SpelunkOptions): LensName[] {
  // Explicit --lens takes precedence
  if (options.lens && options.lens.length > 0) {
    return options.lens;
  }

  // --for maps to default lenses
  if (options.for) {
    return AGENT_TO_LENSES[options.for];
  }

  // Neither specified - return all lenses (broad exploration)
  return [...VALID_LENSES];
}

/**
 * Get the effective options with defaults applied
 *
 * @param options - Parsed SpelunkOptions
 * @returns Options with defaults filled in
 */
export function withDefaults(options: SpelunkOptions): Required<Omit<SpelunkOptions, 'for' | 'lens'>> & Pick<SpelunkOptions, 'for' | 'lens'> {
  return {
    ...options,
    focus: options.focus,
    refresh: options.refresh ?? false,
    checkOnly: options.checkOnly ?? false,
    maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxOutput: options.maxOutput ?? DEFAULT_MAX_OUTPUT,
  };
}

/**
 * Convert focus string to a slug for file naming
 *
 * Rules from design doc:
 * - Convert to kebab-case
 * - Spaces become hyphens
 * - Special chars removed
 * - Maximum 50 characters (truncated with hash suffix if longer)
 * - All lowercase
 *
 * @param focus - The focus area string
 * @returns Slugified string suitable for filenames
 */
export function focusToSlug(focus: string): string {
  // Convert to lowercase
  let slug = focus.toLowerCase();

  // Replace spaces with hyphens
  slug = slug.replace(/\s+/g, '-');

  // Remove special characters (keep alphanumeric and hyphens)
  slug = slug.replace(/[^a-z0-9-]/g, '');

  // Collapse multiple hyphens
  slug = slug.replace(/-+/g, '-');

  // Remove leading/trailing hyphens
  slug = slug.replace(/^-+|-+$/g, '');

  // Truncate if longer than 50 chars
  if (slug.length > 50) {
    // Generate a simple hash suffix from the original focus
    const hash = simpleHash(focus).toString(16).slice(0, 4);
    slug = slug.slice(0, 45) + '-' + hash;
  }

  return slug || 'unnamed';
}

/**
 * Simple string hash function (DJB2 algorithm)
 */
function simpleHash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned
}
