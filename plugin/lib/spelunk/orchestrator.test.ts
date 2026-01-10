/**
 * Unit tests for Spelunk Orchestrator
 *
 * Tests for the main spelunk() function that coordinates
 * parsing, staleness checking, execution, and report generation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  spelunk,
  isSpelunkAvailable,
  getSpelunkCapabilities,
  SpelunkResult,
} from './orchestrator';
import { ensureDirectoryStructure, writeSpelunkDoc } from './persistence';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spelunk-orchestrator-test-'));
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

async function createTestFile(
  dir: string,
  relativePath: string,
  content: string
): Promise<string> {
  const fullPath = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

// ============================================================================
// spelunk() tests - Argument Parsing
// ============================================================================

describe('spelunk() - Argument parsing', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('parses --for flag correctly', async () => {
    const result = await spelunk('--for=architect --focus="auth"', tempDir);

    // Should process without error
    expect(result.status).toBeDefined();
    expect(['fresh', 'generated', 'check_only']).toContain(result.status);
  });

  test('parses --lens flag correctly', async () => {
    const result = await spelunk('--lens=interfaces --focus="auth"', tempDir);

    expect(result.status).toBeDefined();
  });

  test('parses multiple lenses', async () => {
    const result = await spelunk(
      '--lens=interfaces,contracts --focus="auth"',
      tempDir
    );

    expect(result.status).toBeDefined();
  });

  test('throws on missing --focus', async () => {
    await expect(spelunk('--for=architect', tempDir)).rejects.toThrow(
      '--focus is required'
    );
  });

  test('throws on invalid agent type', async () => {
    await expect(
      spelunk('--for=invalid --focus="auth"', tempDir)
    ).rejects.toThrow('Unknown agent type');
  });

  test('throws on invalid lens name', async () => {
    await expect(
      spelunk('--lens=invalid --focus="auth"', tempDir)
    ).rejects.toThrow('Unknown lens');
  });

  test('throws when both --for and --lens provided', async () => {
    await expect(
      spelunk('--for=architect --lens=flows --focus="auth"', tempDir)
    ).rejects.toThrow('mutually exclusive');
  });
});

// ============================================================================
// spelunk() tests - Check Mode
// ============================================================================

describe('spelunk() - Check mode', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns check_only status with --check flag', async () => {
    const result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('check_only');
    expect(result.staleness).toBeDefined();
    expect(result.staleness?.size).toBe(1);
  });

  test('reports MISSING status for non-existent docs', async () => {
    const result = await spelunk('--check --lens=contracts --focus="nonexistent"', tempDir);

    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('contracts')?.status).toBe('MISSING');
    expect(result.docPaths).toHaveLength(0);
  });

  test('reports FRESH status for unchanged docs', async () => {
    // Create a doc first
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');
    expect(result.docPaths.length).toBeGreaterThan(0);
  });

  test('reports STALE status for changed docs', async () => {
    // Create a doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Modify the source file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { changed() {} }'
    );

    const result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('contracts')?.status).toBe('STALE');
  });

  test('checks multiple lenses simultaneously', async () => {
    // Create docs for both lenses
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await spelunk(
      '--check --lens=contracts,flows --focus="auth"',
      tempDir
    );

    expect(result.status).toBe('check_only');
    expect(result.staleness?.size).toBe(2);
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');
    expect(result.staleness?.get('flows')?.status).toBe('MISSING');
  });

  test('--check does not generate new documents', async () => {
    const result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('check_only');

    // Verify no doc was created
    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    await expect(fs.access(docPath)).rejects.toThrow();
  });
});

// ============================================================================
// spelunk() tests - Fresh Documents
// ============================================================================

describe('spelunk() - Fresh document handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns fresh status when docs are up to date', async () => {
    // Create a doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await spelunk('--lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('fresh');
    expect(result.docPaths.length).toBeGreaterThan(0);
  });

  test('does not regenerate fresh documents', async () => {
    // Create a doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Original Content',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    const originalContent = await fs.readFile(docPath, 'utf-8');

    // Run spelunk
    await spelunk('--lens=contracts --focus="auth"', tempDir);

    // Content should be unchanged
    const currentContent = await fs.readFile(docPath, 'utf-8');
    expect(currentContent).toBe(originalContent);
  });

  test('--refresh forces regeneration of fresh docs', async () => {
    // Create a doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Original Content',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    const originalStat = await fs.stat(docPath);

    // Small delay to ensure mtime difference
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Run spelunk with --refresh
    const result = await spelunk('--refresh --lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('generated');

    // File should have been modified
    const newStat = await fs.stat(docPath);
    expect(newStat.mtimeMs).toBeGreaterThanOrEqual(originalStat.mtimeMs);
  });
});

// ============================================================================
// spelunk() tests - Generation
// ============================================================================

describe('spelunk() - Document generation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export interface AuthRequest { token: string; }'
    );
    await createTestFile(
      tempDir,
      'src/auth/types.ts',
      'export type User = { id: string; name: string; };'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates documents for missing docs', async () => {
    const result = await spelunk('--lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('generated');
    expect(result.docPaths.length).toBeGreaterThan(0);

    // Verify doc was created
    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    const exists = await fs.access(docPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('generates documents for stale docs', async () => {
    // Create a doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Old Content',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Modify source
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export interface AuthRequest { token: string; userId: string; }'
    );

    const result = await spelunk('--lens=contracts --focus="auth"', tempDir);

    expect(result.status).toBe('generated');
    expect(result.staleness?.get('contracts')?.status).toBe('STALE');
  });

  test('returns staleness info after generation', async () => {
    const result = await spelunk('--lens=contracts --focus="auth"', tempDir);

    expect(result.staleness).toBeDefined();
    expect(result.staleness?.has('contracts')).toBe(true);
  });

  test('generates multiple docs for multiple lenses', async () => {
    const result = await spelunk(
      '--lens=interfaces,boundaries --focus="auth"',
      tempDir
    );

    expect(result.status).toBe('generated');
    expect(result.docPaths.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// spelunk() tests - Agent Shortcuts
// ============================================================================

describe('spelunk() - Agent shortcuts', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('--for=architect resolves to interfaces and boundaries lenses', async () => {
    const result = await spelunk('--check --for=architect --focus="auth"', tempDir);

    expect(result.staleness?.has('interfaces')).toBe(true);
    expect(result.staleness?.has('boundaries')).toBe(true);
    expect(result.staleness?.size).toBe(2);
  });

  test('--for=product resolves to flows lens', async () => {
    const result = await spelunk('--check --for=product --focus="auth"', tempDir);

    expect(result.staleness?.has('flows')).toBe(true);
    expect(result.staleness?.size).toBe(1);
  });

  test('--for=qa resolves to contracts lens', async () => {
    const result = await spelunk('--check --for=qa --focus="auth"', tempDir);

    expect(result.staleness?.has('contracts')).toBe(true);
    expect(result.staleness?.size).toBe(1);
  });

  test('--for=security resolves to trust-zones and contracts lenses', async () => {
    const result = await spelunk('--check --for=security --focus="auth"', tempDir);

    expect(result.staleness?.has('trust-zones')).toBe(true);
    expect(result.staleness?.has('contracts')).toBe(true);
    expect(result.staleness?.size).toBe(2);
  });
});

// ============================================================================
// spelunk() tests - Options
// ============================================================================

describe('spelunk() - Options handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('accepts --max-files option', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="auth" --max-files=10',
      tempDir
    );

    expect(result.status).toBeDefined();
  });

  test('accepts --max-depth option', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="auth" --max-depth=2',
      tempDir
    );

    expect(result.status).toBeDefined();
  });

  test('accepts --max-output option', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="auth" --max-output=100',
      tempDir
    );

    expect(result.status).toBeDefined();
  });

  test('combines multiple options', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="auth" --max-files=10 --max-depth=2 --max-output=100',
      tempDir
    );

    expect(result.status).toBeDefined();
  });
});

// ============================================================================
// Utility function tests
// ============================================================================

describe('isSpelunkAvailable()', () => {
  test('returns true (grep fallback always available)', () => {
    expect(isSpelunkAvailable()).toBe(true);
  });
});

describe('getSpelunkCapabilities()', () => {
  test('returns capability object', () => {
    const capabilities = getSpelunkCapabilities();

    expect(capabilities).toHaveProperty('lsp');
    expect(capabilities).toHaveProperty('ast');
    expect(capabilities).toHaveProperty('grep');
    expect(capabilities).toHaveProperty('preferredStrategy');

    expect(typeof capabilities.lsp).toBe('boolean');
    expect(typeof capabilities.ast).toBe('boolean');
    expect(capabilities.grep).toBe(true); // Always available
    expect(['lsp', 'ast', 'grep']).toContain(capabilities.preferredStrategy);
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: Complete spelunk workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export interface AuthRequest { token: string; }'
    );
    await createTestFile(
      tempDir,
      'src/auth/types.ts',
      'export type User = { id: string; };'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('complete workflow: check -> generate -> verify fresh', async () => {
    // 1. Check - should be MISSING
    let result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);
    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('contracts')?.status).toBe('MISSING');

    // 2. Generate
    result = await spelunk('--lens=contracts --focus="auth"', tempDir);
    expect(result.status).toBe('generated');
    expect(result.docPaths.length).toBeGreaterThan(0);

    // 3. Check again - should be FRESH
    result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);
    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');

    // 4. Run again without changes - should return fresh without regenerating
    result = await spelunk('--lens=contracts --focus="auth"', tempDir);
    expect(result.status).toBe('fresh');
  });

  test('workflow with source file changes', async () => {
    // 1. Create a doc with known source files using writeSpelunkDoc
    // (since file discovery in temp dirs is unreliable without real LSP)
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // 2. Verify it's FRESH initially
    let result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');

    // 3. Modify source file with clearly different content
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export interface AuthRequest { token: string; userId: string; email: string; /* completely new content */ }'
    );

    // 4. Check - should be STALE (content hash changed)
    result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('STALE');

    // 5. Regenerate
    result = await spelunk('--lens=contracts --focus="auth"', tempDir);
    expect(result.status).toBe('generated');
  });
});
