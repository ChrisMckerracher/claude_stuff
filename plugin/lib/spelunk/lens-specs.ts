/**
 * Lens Specifications for Spelunking Mode
 *
 * This module defines the 5 granularity lenses that control what the Coding Agent
 * extracts during spelunking operations. Each lens maps to specific LSP operations
 * and AST fallback patterns optimized for different specialist agents.
 *
 * @see docs/plans/architect/coding-agent-spelunking-mode.md
 */

// =============================================================================
// Types
// =============================================================================

/**
 * LSP operations that can be used for code exploration
 */
export type LspOperation =
  | 'documentSymbol'     // Get file structure (classes, functions, exports)
  | 'findReferences'     // Find all usages of a symbol
  | 'goToDefinition'     // Navigate to definition
  | 'hover'              // Get type information and docs
  | 'getDiagnostics';    // Get errors and warnings

/**
 * Symbol kinds to filter from LSP documentSymbol results
 */
export type SymbolKind =
  | 'interface'
  | 'type'
  | 'class'
  | 'function'
  | 'method'
  | 'property'
  | 'variable'
  | 'constant'
  | 'enum'
  | 'module'
  | 'namespace';

/**
 * Configuration for LSP-based exploration
 */
export interface LspConfig {
  /** Primary LSP operations to use */
  operations: LspOperation[];
  /** Symbol kinds to include from documentSymbol */
  symbolFilters?: SymbolKind[];
  /** Entry point patterns for findReferences (file globs) */
  entryPointPatterns?: string[];
  /** Trace depth limit for reference/definition chains */
  maxTraceDepth?: number;
}

/**
 * Language-specific AST patterns for fallback exploration
 *
 * Patterns are written for ast-grep or semgrep syntax
 */
export interface AstPatterns {
  typescript?: string[];
  javascript?: string[];
  python?: string[];
  go?: string[];
  rust?: string[];
  java?: string[];
  /** Generic patterns that work across languages */
  generic?: string[];
}

/**
 * Grep-based fallback patterns for when AST tools are unavailable
 */
export interface GrepPatterns {
  /** Regex patterns to search for */
  include: string[];
  /** File glob patterns to search in */
  fileGlobs: string[];
}

/**
 * Complete specification for a spelunking lens
 */
export interface LensSpec {
  /** Unique identifier for the lens */
  name: string;
  /** Agent this lens is optimized for */
  targetAgent: 'architect' | 'product' | 'qa' | 'security';
  /** Human-readable description of what this lens extracts */
  description: string;
  /** Output directory under docs/spelunk/ */
  outputDirectory: string;

  // Extraction Configuration
  /** LSP operations and settings */
  lsp: LspConfig;
  /** AST patterns for fallback (language -> patterns) */
  astPatterns: AstPatterns;
  /** Grep patterns for final fallback */
  grepPatterns: GrepPatterns;

  // Filtering Rules
  /** Patterns for what to extract (regexes for symbol names/paths) */
  extractPatterns: string[];
  /** Patterns for what to ignore (regexes for symbol names/paths) */
  ignorePatterns: string[];

  // Output Settings
  /** Whether to include code snippets in output */
  includeSnippets: boolean;
  /** Max lines per snippet (signatures vs full bodies) */
  snippetMaxLines: number;
}

// =============================================================================
// Lens Specifications
// =============================================================================

/**
 * Interfaces Lens - For Architect Agent
 *
 * Extracts type definitions, public APIs, method signatures, and module exports.
 * Ignores implementation bodies and private methods.
 */
export const INTERFACES_LENS: LensSpec = {
  name: 'interfaces',
  targetAgent: 'architect',
  description: 'Type definitions, public APIs, method signatures, module exports',
  outputDirectory: 'contracts',

  lsp: {
    operations: ['documentSymbol', 'hover'],
    symbolFilters: ['interface', 'type', 'class', 'enum', 'module', 'namespace'],
    maxTraceDepth: 1,
  },

  astPatterns: {
    typescript: [
      // Interface declarations
      'interface $NAME { $$$ }',
      'interface $NAME extends $_ { $$$ }',
      // Type aliases
      'type $NAME = $_',
      // Exported functions (signature only)
      'export function $NAME($$$): $_',
      'export async function $NAME($$$): $_',
      // Exported classes
      'export class $NAME { $$$ }',
      'export class $NAME extends $_ { $$$ }',
      // Module exports
      'export { $$$ }',
      'export default $_',
      // Const exports with type annotations
      'export const $NAME: $TYPE = $_',
    ],
    javascript: [
      // ES6 exports
      'export function $NAME($$$) { $$$ }',
      'export class $NAME { $$$ }',
      'export { $$$ }',
      'export default $_',
      // JSDoc type definitions
      '/** @typedef {$_} $NAME */',
    ],
    python: [
      // Class definitions
      'class $NAME: $$$',
      'class $NAME($_): $$$',
      // Protocol definitions (typing)
      'class $NAME(Protocol): $$$',
      // Type aliases
      '$NAME: TypeAlias = $_',
      // Abstract base classes
      '@abstractmethod',
      'def $NAME(self, $$$) -> $_: ...',
    ],
    go: [
      // Interface declarations
      'type $NAME interface { $$$ }',
      // Struct declarations (public)
      'type $NAME struct { $$$ }',
      // Type aliases
      'type $NAME = $_',
      // Exported function signatures
      'func $NAME($$$) $_',
      'func ($_ $_) $NAME($$$) $_',
    ],
    rust: [
      // Trait definitions
      'pub trait $NAME { $$$ }',
      'trait $NAME { $$$ }',
      // Struct definitions
      'pub struct $NAME { $$$ }',
      // Enum definitions
      'pub enum $NAME { $$$ }',
      // Type aliases
      'pub type $NAME = $_',
    ],
    java: [
      // Interface declarations
      'public interface $NAME { $$$ }',
      'interface $NAME { $$$ }',
      // Abstract classes
      'public abstract class $NAME { $$$ }',
      // Public method signatures
      'public $TYPE $NAME($$$)',
    ],
  },

  grepPatterns: {
    include: [
      '^export (interface|type|class|enum|function|const)',
      '^(public |)interface ',
      '^(pub |)trait ',
      '^(pub |)struct ',
      'class.*Protocol',
      ': TypeAlias',
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.rs', '*.java'],
  },

  extractPatterns: [
    '^[A-Z]',                    // PascalCase names (types, classes)
    '^I[A-Z]',                   // Interface prefix convention
    'Handler$',                  // Handler suffixes
    'Service$',                  // Service suffixes
    'Repository$',              // Repository suffixes
    'Interface$',               // Explicit interface suffixes
    '^(export|pub|public)',      // Exported symbols
  ],

  ignorePatterns: [
    '^_',                       // Private/internal (underscore prefix)
    '^#',                       // JS private fields
    'private ',                 // Explicit private
    'internal',                 // Internal markers
    '\\.test\\.',               // Test files
    '\\.spec\\.',               // Spec files
    '__mock__',                 // Mock files
    'node_modules',             // Dependencies
    '/test/',                   // Test directories
    '/tests/',                  // Test directories
  ],

  includeSnippets: true,
  snippetMaxLines: 20, // Signatures only, not full implementations
};

/**
 * Flows Lens - For Product Agent
 *
 * Extracts entry points, user-facing paths, route handlers, and command handlers.
 * Ignores internal algorithms and utility functions.
 */
export const FLOWS_LENS: LensSpec = {
  name: 'flows',
  targetAgent: 'product',
  description: 'Entry points, user-facing paths, route handlers, command handlers',
  outputDirectory: 'flows',

  lsp: {
    operations: ['findReferences', 'goToDefinition'],
    entryPointPatterns: [
      '**/routes/**',
      '**/handlers/**',
      '**/controllers/**',
      '**/commands/**',
      '**/pages/**',
      '**/api/**',
      '**/main.*',
      '**/index.*',
      '**/app.*',
    ],
    maxTraceDepth: 3,
  },

  astPatterns: {
    typescript: [
      // Express/Fastify routes
      'app.get($PATH, $$$)',
      'app.post($PATH, $$$)',
      'app.put($PATH, $$$)',
      'app.delete($PATH, $$$)',
      'router.get($PATH, $$$)',
      'router.post($PATH, $$$)',
      // Next.js handlers
      'export async function GET($_) { $$$ }',
      'export async function POST($_) { $$$ }',
      'export default function $NAME($_) { $$$ }',
      // CLI commands
      'program.command($NAME)',
      '.command($NAME, $$$)',
    ],
    javascript: [
      'app.get($PATH, $$$)',
      'app.post($PATH, $$$)',
      'router.get($PATH, $$$)',
      'router.post($PATH, $$$)',
      'exports.handler = $_',
    ],
    python: [
      // FastAPI/Flask routes
      '@app.route($PATH)',
      '@app.get($PATH)',
      '@app.post($PATH)',
      '@router.get($PATH)',
      '@router.post($PATH)',
      // Django URLs
      'path($PATH, $_)',
      're_path($PATH, $_)',
      // CLI commands (Click/Typer)
      '@app.command()',
      '@click.command()',
    ],
    go: [
      // HTTP handlers
      'http.HandleFunc($PATH, $_)',
      'r.HandleFunc($PATH, $_)',
      'e.GET($PATH, $_)',
      'e.POST($PATH, $_)',
      // Cobra commands
      'cobra.Command{ $$$ }',
    ],
    rust: [
      // Actix/Axum routes
      '#[get($PATH)]',
      '#[post($PATH)]',
      '.route($PATH, $_)',
      // CLI (Clap)
      '#[command($$$)]',
    ],
    java: [
      // Spring MVC
      '@GetMapping($PATH)',
      '@PostMapping($PATH)',
      '@RequestMapping($PATH)',
      '@RestController',
    ],
  },

  grepPatterns: {
    include: [
      '\\.(get|post|put|delete|patch)\\s*\\(',
      '@(app|router)\\.(get|post|route)',
      '@(Get|Post|Put|Delete)Mapping',
      'HandleFunc\\s*\\(',
      '\\.command\\s*\\(',
      'export (async function|function|default)',
    ],
    fileGlobs: [
      '**/routes/**',
      '**/handlers/**',
      '**/controllers/**',
      '**/api/**',
      '**/pages/**',
      '**/commands/**',
    ],
  },

  extractPatterns: [
    'route',
    'handler',
    'controller',
    'endpoint',
    'command',
    'action',
    '/api/',
    '/v[0-9]+/',                // Versioned APIs
    'Handler$',
    'Controller$',
    'Command$',
  ],

  ignorePatterns: [
    '^_',
    'private',
    'internal',
    'util',
    'helper',
    'middleware',              // Not user-facing
    'interceptor',
    '\\.test\\.',
    '\\.spec\\.',
    '/test/',
    '/tests/',
    'node_modules',
  ],

  includeSnippets: true,
  snippetMaxLines: 30, // Include handler logic for flow understanding
};

/**
 * Boundaries Lens - For Architect Agent
 *
 * Extracts module edges, imports, dependency graph, and communication patterns.
 * Ignores file-internal code.
 */
export const BOUNDARIES_LENS: LensSpec = {
  name: 'boundaries',
  targetAgent: 'architect',
  description: 'Module edges, imports, dependency graph, communication patterns',
  outputDirectory: 'boundaries',

  lsp: {
    operations: ['documentSymbol', 'findReferences'],
    symbolFilters: ['module', 'namespace'],
    maxTraceDepth: 2,
  },

  astPatterns: {
    typescript: [
      // Imports
      'import { $$$ } from $MODULE',
      'import $NAME from $MODULE',
      'import * as $NAME from $MODULE',
      'import type { $$$ } from $MODULE',
      // Exports
      'export { $$$ } from $MODULE',
      'export * from $MODULE',
      // Dynamic imports
      'import($MODULE)',
      'require($MODULE)',
    ],
    javascript: [
      'import { $$$ } from $MODULE',
      'import $NAME from $MODULE',
      'require($MODULE)',
      'module.exports = $_',
    ],
    python: [
      'import $MODULE',
      'from $MODULE import $$$',
      'from . import $$$',
      'from .. import $$$',
    ],
    go: [
      'import "$MODULE"',
      'import ( $$$ )',
      'import $NAME "$MODULE"',
    ],
    rust: [
      'use $PATH',
      'use $PATH::{ $$$ }',
      'mod $NAME',
      'pub mod $NAME',
      'extern crate $NAME',
    ],
    java: [
      'import $PACKAGE.$CLASS',
      'import $PACKAGE.*',
      'package $NAME',
    ],
  },

  grepPatterns: {
    include: [
      '^import ',
      '^from .* import',
      '^require\\(',
      '^export .* from',
      '^use ',
      '^mod ',
      '^package ',
    ],
    fileGlobs: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.py', '*.go', '*.rs', '*.java'],
  },

  extractPatterns: [
    '^import',
    '^export',
    '^from',
    '^use ',
    '^mod ',
    '@/',                       // Path aliases
    '\\.\\.',                   // Relative imports
    'services/',
    'repositories/',
    'adapters/',
    'ports/',
    'domain/',
    'infrastructure/',
  ],

  ignorePatterns: [
    'node_modules',
    '__pycache__',
    '\\.pyc$',
    'target/',
    'dist/',
    'build/',
    '\\.test\\.',
    '\\.spec\\.',
    '/test/',
    '/tests/',
  ],

  includeSnippets: false, // Just list dependencies
  snippetMaxLines: 5,
};

/**
 * Contracts Lens - For QA Agent
 *
 * Extracts input/output schemas, validation rules, error types, and state machines.
 * Ignores business logic implementation.
 */
export const CONTRACTS_LENS: LensSpec = {
  name: 'contracts',
  targetAgent: 'qa',
  description: 'Input/output schemas, validation rules, error types, state machines',
  outputDirectory: 'contracts',

  lsp: {
    operations: ['hover', 'getDiagnostics'],
    symbolFilters: ['interface', 'type', 'enum', 'class'],
    maxTraceDepth: 2,
  },

  astPatterns: {
    typescript: [
      // Zod schemas
      'z.object({ $$$ })',
      'z.string()',
      'z.number()',
      'z.enum([$$$])',
      'z.union([$$$])',
      '$NAME.parse($_)',
      '$NAME.safeParse($_)',
      // Yup schemas
      'yup.object({ $$$ })',
      // io-ts
      't.type({ $$$ })',
      // Error types
      'class $NAME extends Error { $$$ }',
      'type $NAMEError = $_',
      // State machines (XState)
      'createMachine({ $$$ })',
      'states: { $$$ }',
    ],
    javascript: [
      'Joi.object({ $$$ })',
      'z.object({ $$$ })',
      'class $NAME extends Error { $$$ }',
    ],
    python: [
      // Pydantic models
      'class $NAME(BaseModel): $$$',
      'class $NAME(BaseSettings): $$$',
      // Field definitions
      '$NAME: $TYPE = Field($$$)',
      '@validator($$$)',
      '@field_validator($$$)',
      // Dataclasses
      '@dataclass',
      // Enums
      'class $NAME(Enum): $$$',
      'class $NAME(StrEnum): $$$',
    ],
    go: [
      // Struct tags for validation
      '`json:"$_" validate:"$_"`',
      '`validate:"$_"`',
      // Error types
      'type $NAMEError struct { $$$ }',
      'var Err$NAME = errors.New($_)',
    ],
    rust: [
      // Serde derive
      '#[derive(Serialize, Deserialize)]',
      '#[serde($$$)]',
      // Error types
      '#[derive(Error)]',
      'enum $NAMEError { $$$ }',
    ],
    java: [
      // Bean validation
      '@NotNull',
      '@NotBlank',
      '@Size($$$)',
      '@Pattern($$$)',
      '@Valid',
      // Error/Exception types
      'class $NAME extends Exception { $$$ }',
      'class $NAME extends RuntimeException { $$$ }',
    ],
  },

  grepPatterns: {
    include: [
      'z\\.(object|string|number|boolean|array|enum)',
      'Joi\\.',
      'yup\\.',
      'class.*BaseModel',
      'class.*Error',
      'class.*Exception',
      '@validator',
      '@field_validator',
      'validate:',
      '#\\[derive.*Serialize',
      '@Not(Null|Blank|Empty)',
      '@(Size|Pattern|Min|Max)',
      'createMachine',
      'states:',
    ],
    fileGlobs: [
      '**/schemas/**',
      '**/validators/**',
      '**/types/**',
      '**/errors/**',
      '**/exceptions/**',
      '**/models/**',
      '**/dto/**',
    ],
  },

  extractPatterns: [
    'Schema$',
    'Validator$',
    'Input$',
    'Output$',
    'Request$',
    'Response$',
    'Error$',
    'Exception$',
    'DTO$',
    'Model$',
    'State$',
    'Machine$',
    'validate',
    'parse',
    'transform',
  ],

  ignorePatterns: [
    '^_',
    'private',
    'internal',
    '\\.test\\.',
    '\\.spec\\.',
    '/test/',
    '/tests/',
    'mock',
    'stub',
    'fake',
    'node_modules',
  ],

  includeSnippets: true,
  snippetMaxLines: 40, // Full schema definitions are important
};

/**
 * Trust Zones Lens - For Security Agent
 *
 * Extracts auth checks, sanitization, privilege boundaries, and data flow edges.
 * Ignores non-security code paths.
 */
export const TRUST_ZONES_LENS: LensSpec = {
  name: 'trust-zones',
  targetAgent: 'security',
  description: 'Auth checks, sanitization, privilege boundaries, data flow edges',
  outputDirectory: 'trust-zones',

  lsp: {
    operations: ['findReferences', 'goToDefinition'],
    entryPointPatterns: [
      '**/auth/**',
      '**/middleware/**',
      '**/guards/**',
      '**/permissions/**',
      '**/security/**',
    ],
    maxTraceDepth: 4, // Deep tracing for security boundaries
  },

  astPatterns: {
    typescript: [
      // Auth middleware
      'isAuthenticated',
      'requireAuth',
      'verifyToken',
      'checkPermission',
      'hasRole($$$)',
      // Guards
      'canActivate($_)',
      '@UseGuards($$$)',
      // Sanitization
      'sanitize($_)',
      'escape($_)',
      'validate($_)',
      'DOMPurify.sanitize($_)',
      // JWT/Token handling
      'jwt.verify($_)',
      'jwt.sign($_)',
      // Password handling
      'bcrypt.hash($_)',
      'bcrypt.compare($_)',
      // Input validation
      'req.body',
      'req.params',
      'req.query',
    ],
    javascript: [
      'isAuthenticated',
      'requireAuth',
      'verifyToken',
      'jwt.verify($_)',
      'bcrypt.hash($_)',
      'sanitize($_)',
      'escape($_)',
    ],
    python: [
      // Auth decorators
      '@login_required',
      '@permission_required($$$)',
      '@requires_auth',
      '@jwt_required',
      // FastAPI security
      'Depends(get_current_user)',
      'Security($_)',
      'HTTPBearer()',
      // Django permissions
      '@permission_classes([$$$])',
      'has_perm($_)',
      // Sanitization
      'bleach.clean($_)',
      'escape($_)',
      'mark_safe($_)',
      // Input handling
      'request.data',
      'request.json',
    ],
    go: [
      // Auth middleware
      'AuthMiddleware',
      'RequireAuth',
      'VerifyToken',
      'CheckPermission',
      // JWT
      'jwt.Parse($_)',
      'jwt.ParseWithClaims($_)',
      // Bcrypt
      'bcrypt.GenerateFromPassword($_)',
      'bcrypt.CompareHashAndPassword($_)',
      // Input handling
      'r.Body',
      'c.Bind($_)',
    ],
    rust: [
      // Auth guards
      '#[authorize]',
      '#[has_permission($$$)]',
      // JWT
      'decode::<$_>($_)',
      'encode($_)',
      // Sanitization
      'sanitize($_)',
      'html_escape($_)',
    ],
    java: [
      // Spring Security
      '@PreAuthorize($$$)',
      '@PostAuthorize($$$)',
      '@Secured($$$)',
      '@RolesAllowed($$$)',
      'SecurityContextHolder',
      // Input validation
      '@Valid',
      '@Validated',
      // Sanitization
      'ESAPI.encoder()',
      'StringEscapeUtils.escapeHtml($_)',
    ],
  },

  grepPatterns: {
    include: [
      'auth',
      'authenticate',
      'authorize',
      'permission',
      'role',
      'token',
      'jwt',
      'session',
      'cookie',
      'password',
      'hash',
      'bcrypt',
      'crypto',
      'encrypt',
      'decrypt',
      'sanitize',
      'escape',
      'validate',
      'csrf',
      'xss',
      'sql.*injection',
      'secret',
      'credential',
      'api.?key',
      'bearer',
      'oauth',
    ],
    fileGlobs: [
      '**/auth/**',
      '**/security/**',
      '**/middleware/**',
      '**/guards/**',
      '**/permissions/**',
      '**/crypto/**',
    ],
  },

  extractPatterns: [
    'auth',
    'Auth',
    'authenticate',
    'authorize',
    'permission',
    'Permission',
    'role',
    'Role',
    'guard',
    'Guard',
    'token',
    'Token',
    'jwt',
    'JWT',
    'session',
    'Session',
    'password',
    'Password',
    'hash',
    'Hash',
    'encrypt',
    'Encrypt',
    'sanitize',
    'Sanitize',
    'validate',
    'Validate',
    'secret',
    'Secret',
    'credential',
    'Credential',
    'Middleware',
    'middleware',
  ],

  ignorePatterns: [
    '\\.test\\.',
    '\\.spec\\.',
    '/test/',
    '/tests/',
    'mock',
    'stub',
    'fake',
    'node_modules',
    // Don't ignore internal/private for security - we need full visibility
  ],

  includeSnippets: true,
  snippetMaxLines: 50, // Full context for security review
};

// =============================================================================
// Lens Registry
// =============================================================================

/**
 * All available lens specifications indexed by name
 */
export const LENS_SPECS: Record<string, LensSpec> = {
  interfaces: INTERFACES_LENS,
  flows: FLOWS_LENS,
  boundaries: BOUNDARIES_LENS,
  contracts: CONTRACTS_LENS,
  'trust-zones': TRUST_ZONES_LENS,
};

/**
 * Mapping from agent names to their default lens(es)
 */
export const AGENT_DEFAULT_LENSES: Record<string, string[]> = {
  architect: ['interfaces', 'boundaries'],
  product: ['flows'],
  qa: ['contracts'],
  security: ['trust-zones', 'contracts'],
};

/**
 * Get lens spec(s) by agent name
 */
export function getLensesForAgent(agent: string): LensSpec[] {
  const lensNames = AGENT_DEFAULT_LENSES[agent];
  if (!lensNames) {
    throw new Error(`Unknown agent: ${agent}. Valid agents: ${Object.keys(AGENT_DEFAULT_LENSES).join(', ')}`);
  }
  return lensNames.map(name => LENS_SPECS[name]);
}

/**
 * Get a single lens spec by name
 */
export function getLens(name: string): LensSpec {
  const lens = LENS_SPECS[name];
  if (!lens) {
    throw new Error(`Unknown lens: ${name}. Valid lenses: ${Object.keys(LENS_SPECS).join(', ')}`);
  }
  return lens;
}

/**
 * Get all lens names
 */
export function getLensNames(): string[] {
  return Object.keys(LENS_SPECS);
}

/**
 * Get all agent names
 */
export function getAgentNames(): string[] {
  return Object.keys(AGENT_DEFAULT_LENSES);
}
