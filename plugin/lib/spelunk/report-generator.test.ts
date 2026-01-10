/**
 * Unit tests for Spelunk Report Generator
 *
 * Tests for the report generation functions that format exploration results
 * into readable Markdown with YAML frontmatter.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  generateReport,
  formatInterfacesReport,
  formatFlowsReport,
  formatBoundariesReport,
  formatContractsReport,
  formatTrustZonesReport,
  ReportOptions,
  GeneratedReport,
  ExplorationEntry,
  ExecutionResult,
} from './report-generator';
import { LensType } from './types';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'report-gen-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function createTestFile(dir: string, relativePath: string, content: string): Promise<string> {
  const fullPath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

// ============================================================================
// ExplorationEntry and ExecutionResult fixtures
// ============================================================================

function createMockEntry(overrides: Partial<ExplorationEntry> = {}): ExplorationEntry {
  return {
    name: 'TestInterface',
    kind: 'interface',
    filePath: 'src/test/types.ts',
    line: 10,
    endLine: 15,
    snippet: 'export interface TestInterface {\n  foo(): void;\n}',
    ...overrides,
  };
}

function createMockResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    lens: 'interfaces',
    focus: 'test module',
    toolChain: 'lsp',
    entries: [createMockEntry()],
    sourceFiles: ['src/test/types.ts'],
    ...overrides,
  };
}

// ============================================================================
// formatInterfacesReport() tests
// ============================================================================

describe('formatInterfacesReport', () => {
  test('formats empty entries', () => {
    const result = formatInterfacesReport([]);
    expect(result).toContain('No interfaces found');
  });

  test('formats single interface entry', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'AuthService',
        kind: 'interface',
        filePath: 'src/auth/service.ts',
        line: 15,
        endLine: 20,
        snippet: 'export interface AuthService {\n  login(creds: Creds): Promise<Token>;\n}',
      },
    ];

    const result = formatInterfacesReport(entries);

    expect(result).toContain('## Interfaces');
    expect(result).toContain('### AuthService');
    expect(result).toContain('src/auth/service.ts:15');
    expect(result).toContain('```typescript');
    expect(result).toContain('export interface AuthService');
  });

  test('groups entries by kind', () => {
    const entries: ExplorationEntry[] = [
      { name: 'IFoo', kind: 'interface', filePath: 'a.ts', line: 1 },
      { name: 'TBar', kind: 'type', filePath: 'b.ts', line: 1 },
      { name: 'IBaz', kind: 'interface', filePath: 'c.ts', line: 1 },
    ];

    const result = formatInterfacesReport(entries);

    expect(result).toContain('## Interfaces');
    expect(result).toContain('## Types');
  });

  test('includes overview with counts', () => {
    const entries: ExplorationEntry[] = [
      { name: 'IFoo', kind: 'interface', filePath: 'a.ts', line: 1 },
      { name: 'IBar', kind: 'interface', filePath: 'b.ts', line: 1 },
      { name: 'TBaz', kind: 'type', filePath: 'c.ts', line: 1 },
    ];

    const result = formatInterfacesReport(entries);

    expect(result).toContain('## Overview');
    expect(result).toContain('2 interface');
    expect(result).toContain('1 type');
  });
});

// ============================================================================
// formatFlowsReport() tests
// ============================================================================

describe('formatFlowsReport', () => {
  test('formats empty entries', () => {
    const result = formatFlowsReport([]);
    expect(result).toContain('No flows found');
  });

  test('formats entry points and handlers', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'handleLogin',
        kind: 'handler',
        filePath: 'src/routes/auth.ts',
        line: 25,
        description: 'POST /api/login',
      },
      {
        name: 'handleLogout',
        kind: 'handler',
        filePath: 'src/routes/auth.ts',
        line: 45,
        description: 'POST /api/logout',
      },
    ];

    const result = formatFlowsReport(entries);

    expect(result).toContain('## Entry Points');
    expect(result).toContain('handleLogin');
    expect(result).toContain('POST /api/login');
  });

  test('includes call chain when available', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'processOrder',
        kind: 'function',
        filePath: 'src/orders/process.ts',
        line: 10,
        callChain: ['validateOrder', 'chargePayment', 'sendConfirmation'],
      },
    ];

    const result = formatFlowsReport(entries);

    expect(result).toContain('validateOrder');
    expect(result).toContain('chargePayment');
    expect(result).toContain('sendConfirmation');
  });
});

// ============================================================================
// formatBoundariesReport() tests
// ============================================================================

describe('formatBoundariesReport', () => {
  test('formats empty entries', () => {
    const result = formatBoundariesReport([]);
    expect(result).toContain('No boundaries found');
  });

  test('formats module exports', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'auth',
        kind: 'module',
        filePath: 'src/auth/index.ts',
        line: 1,
        exports: ['AuthService', 'AuthToken', 'validateToken'],
      },
    ];

    const result = formatBoundariesReport(entries);

    expect(result).toContain('## Modules');
    expect(result).toContain('auth');
    expect(result).toContain('AuthService');
    expect(result).toContain('AuthToken');
  });

  test('formats dependencies', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'PaymentService',
        kind: 'class',
        filePath: 'src/payment/service.ts',
        line: 5,
        dependencies: ['AuthService', 'DatabaseClient', 'Logger'],
      },
    ];

    const result = formatBoundariesReport(entries);

    expect(result).toContain('Dependencies');
    expect(result).toContain('AuthService');
    expect(result).toContain('DatabaseClient');
  });
});

// ============================================================================
// formatContractsReport() tests
// ============================================================================

describe('formatContractsReport', () => {
  test('formats empty entries', () => {
    const result = formatContractsReport([]);
    expect(result).toContain('No contracts found');
  });

  test('formats input/output schemas', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'LoginRequest',
        kind: 'type',
        filePath: 'src/auth/types.ts',
        line: 5,
        snippet: 'export type LoginRequest = {\n  email: string;\n  password: string;\n};',
      },
      {
        name: 'LoginResponse',
        kind: 'type',
        filePath: 'src/auth/types.ts',
        line: 10,
        snippet: 'export type LoginResponse = {\n  token: string;\n  expiresAt: number;\n};',
      },
    ];

    const result = formatContractsReport(entries);

    expect(result).toContain('## Types');
    expect(result).toContain('LoginRequest');
    expect(result).toContain('LoginResponse');
  });

  test('formats validation rules when present', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'validateEmail',
        kind: 'function',
        filePath: 'src/validation/email.ts',
        line: 1,
        description: 'Validates email format using RFC 5322',
      },
    ];

    const result = formatContractsReport(entries);

    expect(result).toContain('validateEmail');
    expect(result).toContain('RFC 5322');
  });
});

// ============================================================================
// formatTrustZonesReport() tests
// ============================================================================

describe('formatTrustZonesReport', () => {
  test('formats empty entries', () => {
    const result = formatTrustZonesReport([]);
    expect(result).toContain('No trust zones found');
  });

  test('formats auth checks', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'requireAuth',
        kind: 'function',
        filePath: 'src/middleware/auth.ts',
        line: 10,
        description: 'Validates JWT token in Authorization header',
      },
    ];

    const result = formatTrustZonesReport(entries);

    expect(result).toContain('## Authentication');
    expect(result).toContain('requireAuth');
    expect(result).toContain('JWT');
  });

  test('formats privilege boundaries', () => {
    const entries: ExplorationEntry[] = [
      {
        name: 'requireAdmin',
        kind: 'function',
        filePath: 'src/middleware/roles.ts',
        line: 15,
        trustLevel: 'admin',
      },
      {
        name: 'requireUser',
        kind: 'function',
        filePath: 'src/middleware/roles.ts',
        line: 25,
        trustLevel: 'user',
      },
    ];

    const result = formatTrustZonesReport(entries);

    expect(result).toContain('## Authorization');
    expect(result).toContain('admin');
    expect(result).toContain('user');
  });
});

// ============================================================================
// generateReport() tests
// ============================================================================

describe('generateReport', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Create source files for hash computation
    await createTestFile(tempDir, 'src/auth/types.ts', 'export interface Auth {}');
    await createTestFile(tempDir, 'src/auth/service.ts', 'export class AuthService {}');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('writes report to correct directory based on lens', async () => {
    const result = createMockResult({
      lens: 'interfaces',
      focus: 'authentication',
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });

    expect(report.path).toContain('docs/spelunk/contracts/authentication.md');
    expect(report.relativePath).toBe('docs/spelunk/contracts/authentication.md');
    expect(report.lens).toBe('interfaces');
    expect(report.focus).toBe('authentication');
  });

  test('writes flows to flows directory', async () => {
    const result = createMockResult({
      lens: 'flows',
      focus: 'user login',
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });

    expect(report.path).toContain('docs/spelunk/flows/user-login.md');
  });

  test('writes boundaries to boundaries directory', async () => {
    const result = createMockResult({
      lens: 'boundaries',
      focus: 'api layer',
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });

    expect(report.path).toContain('docs/spelunk/boundaries/api-layer.md');
  });

  test('writes trust-zones to trust-zones directory', async () => {
    const result = createMockResult({
      lens: 'trust-zones',
      focus: 'api endpoints',
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });

    expect(report.path).toContain('docs/spelunk/trust-zones/api-endpoints.md');
  });

  test('generates valid YAML frontmatter', async () => {
    const result = createMockResult({
      lens: 'interfaces',
      focus: 'auth module',
      toolChain: 'lsp',
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });
    const content = await fs.readFile(report.path, 'utf-8');

    expect(content).toMatch(/^---\n/);
    expect(content).toContain('lens: interfaces');
    expect(content).toContain('focus: "auth module"');
    expect(content).toContain('tool_chain: lsp');
    expect(content).toMatch(/generated: \d{4}-\d{2}-\d{2}T/);
  });

  test('includes source file hashes in frontmatter', async () => {
    const result = createMockResult({
      sourceFiles: ['src/auth/types.ts', 'src/auth/service.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });
    const content = await fs.readFile(report.path, 'utf-8');

    expect(content).toContain('source_files:');
    expect(content).toContain('path: src/auth/types.ts');
    expect(content).toContain('path: src/auth/service.ts');
    expect(content).toMatch(/hash: [a-f0-9]{8}/);
  });

  test('includes code snippets when enabled', async () => {
    const result = createMockResult({
      entries: [
        {
          name: 'AuthService',
          kind: 'interface',
          filePath: 'src/auth/service.ts',
          line: 5,
          snippet: 'export interface AuthService {\n  login(): void;\n}',
        },
      ],
    });

    const report = await generateReport(result, {
      projectRoot: tempDir,
      includeSnippets: true,
    });
    const content = await fs.readFile(report.path, 'utf-8');

    expect(content).toContain('```typescript');
    expect(content).toContain('export interface AuthService');
  });

  test('respects maxSnippetLines option', async () => {
    const longSnippet = Array(20).fill('  line: string;').join('\n');
    const result = createMockResult({
      entries: [
        {
          name: 'BigInterface',
          kind: 'interface',
          filePath: 'src/test.ts',
          line: 1,
          snippet: `export interface BigInterface {\n${longSnippet}\n}`,
        },
      ],
    });

    const report = await generateReport(result, {
      projectRoot: tempDir,
      includeSnippets: true,
      maxSnippetLines: 5,
    });
    const content = await fs.readFile(report.path, 'utf-8');

    // Should truncate the snippet
    const lines = content.split('\n');
    const snippetStart = lines.findIndex(l => l.includes('export interface BigInterface'));
    // Verify truncation happened (won't have all 20 lines)
    expect(content).not.toContain(longSnippet);
  });

  test('updates staleness index', async () => {
    const result = createMockResult({
      focus: 'test area',
      sourceFiles: ['src/auth/types.ts'],
    });

    await generateReport(result, { projectRoot: tempDir });

    const stalenessPath = path.join(tempDir, 'docs/spelunk/_staleness.json');
    const stalenessContent = await fs.readFile(stalenessPath, 'utf-8');
    const staleness = JSON.parse(stalenessContent);

    expect(staleness.docs['contracts/test-area.md']).toBeDefined();
    expect(staleness.docs['contracts/test-area.md'].source_files['src/auth/types.ts']).toBeDefined();
  });

  test('returns correct entriesCount', async () => {
    const result = createMockResult({
      entries: [
        { name: 'A', kind: 'interface', filePath: 'a.ts', line: 1 },
        { name: 'B', kind: 'interface', filePath: 'b.ts', line: 1 },
        { name: 'C', kind: 'type', filePath: 'c.ts', line: 1 },
      ],
      sourceFiles: ['src/auth/types.ts'],
    });

    const report = await generateReport(result, { projectRoot: tempDir });

    expect(report.entriesCount).toBe(3);
  });

  test('updates index when updateIndex option is true', async () => {
    const result = createMockResult({
      focus: 'auth layer',
      sourceFiles: ['src/auth/types.ts'],
    });

    await generateReport(result, {
      projectRoot: tempDir,
      updateIndex: true,
    });

    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const indexContent = await fs.readFile(indexPath, 'utf-8');

    expect(indexContent).toContain('auth-layer.md');
    expect(indexContent).toContain('auth layer');
  });

  test('handles missing source files gracefully', async () => {
    const result = createMockResult({
      sourceFiles: ['src/auth/types.ts', 'src/nonexistent.ts'],
    });

    // Should not throw
    const report = await generateReport(result, { projectRoot: tempDir });

    const content = await fs.readFile(report.path, 'utf-8');
    expect(content).toContain('src/auth/types.ts');
    expect(content).not.toContain('src/nonexistent.ts');
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: Full report generation workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await createTestFile(tempDir, 'src/auth/handler.ts', `
export interface AuthHandler {
  authenticate(token: string): Promise<User>;
  refresh(refreshToken: string): Promise<TokenPair>;
}
    `);
    await createTestFile(tempDir, 'src/auth/types.ts', `
export type User = { id: string; email: string };
export type TokenPair = { access: string; refresh: string };
    `);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('complete workflow: generate report with all features', async () => {
    const result: ExecutionResult = {
      lens: 'interfaces',
      focus: 'authentication layer',
      toolChain: 'lsp',
      entries: [
        {
          name: 'AuthHandler',
          kind: 'interface',
          filePath: 'src/auth/handler.ts',
          line: 2,
          endLine: 5,
          snippet: `export interface AuthHandler {
  authenticate(token: string): Promise<User>;
  refresh(refreshToken: string): Promise<TokenPair>;
}`,
        },
        {
          name: 'User',
          kind: 'type',
          filePath: 'src/auth/types.ts',
          line: 2,
          snippet: 'export type User = { id: string; email: string };',
        },
        {
          name: 'TokenPair',
          kind: 'type',
          filePath: 'src/auth/types.ts',
          line: 3,
          snippet: 'export type TokenPair = { access: string; refresh: string };',
        },
      ],
      sourceFiles: ['src/auth/handler.ts', 'src/auth/types.ts'],
    };

    const report = await generateReport(result, {
      projectRoot: tempDir,
      includeSnippets: true,
      updateIndex: true,
    });

    // Verify report metadata
    expect(report.lens).toBe('interfaces');
    expect(report.focus).toBe('authentication layer');
    expect(report.entriesCount).toBe(3);
    expect(report.relativePath).toBe('docs/spelunk/contracts/authentication-layer.md');

    // Verify file content
    const content = await fs.readFile(report.path, 'utf-8');

    // Check frontmatter
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('lens: interfaces');
    expect(content).toContain('focus: "authentication layer"');
    expect(content).toContain('tool_chain: lsp');

    // Check content structure
    expect(content).toContain('## Overview');
    expect(content).toContain('1 interface');
    expect(content).toContain('2 type');

    // Check entries
    expect(content).toContain('### AuthHandler');
    expect(content).toContain('### User');
    expect(content).toContain('### TokenPair');

    // Check snippets
    expect(content).toContain('```typescript');
    expect(content).toContain('authenticate(token: string)');

    // Verify staleness index
    const stalenessPath = path.join(tempDir, 'docs/spelunk/_staleness.json');
    const staleness = JSON.parse(await fs.readFile(stalenessPath, 'utf-8'));
    expect(staleness.docs['contracts/authentication-layer.md']).toBeDefined();

    // Verify index was updated
    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    expect(indexContent).toContain('authentication-layer.md');
  });
});
