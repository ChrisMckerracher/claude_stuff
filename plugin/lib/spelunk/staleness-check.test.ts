/**
 * Unit tests for Spelunk Staleness Check
 *
 * Tests for the staleness check functions that determine if
 * spelunk documents are fresh, stale, missing, or orphaned.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  checkStaleness,
  checkMultipleLenses,
  checkLensDirectory,
} from './staleness-check';
import {
  ensureDirectoryStructure,
  writeSpelunkDoc,
  updateStalenessIndex,
} from './persistence';
import { LensType } from './types';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spelunk-staleness-test-'));
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
// checkStaleness() tests
// ============================================================================

describe('checkStaleness', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    // Create source files for testing
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
    await createTestFile(
      tempDir,
      'src/auth/types.ts',
      'export type User = { id: string };'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns MISSING when no document exists', async () => {
    const result = await checkStaleness('contracts', 'nonexistent', tempDir);

    expect(result.status).toBe('MISSING');
    expect(result.docPath).toBeNull();
    expect(result.missingDoc).toBe(true);
    expect(result.reason).toContain('No spelunk document exists');
  });

  test('returns FRESH when document exists and hashes match', async () => {
    // Create a document with source files
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await checkStaleness('contracts', 'auth', tempDir);

    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('docs/spelunk/contracts/auth.md');
    expect(result.staleSources).toBeUndefined();
    expect(result.reason).toContain('unchanged');
  });

  test('returns STALE when source file has changed', async () => {
    // Create a document
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
      'export class AuthHandler { newMethod() {} }'
    );

    const result = await checkStaleness('contracts', 'auth', tempDir);

    expect(result.status).toBe('STALE');
    expect(result.docPath).toContain('docs/spelunk/contracts/auth.md');
    expect(result.staleSources).toContain('src/auth/handler.ts');
    expect(result.reason).toContain('have changed');
  });

  test('returns STALE when source file is deleted', async () => {
    // Create a document with a source file
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Delete the source file
    await fs.unlink(path.join(tempDir, 'src/auth/handler.ts'));

    const result = await checkStaleness('contracts', 'auth', tempDir);

    expect(result.status).toBe('STALE');
    expect(result.staleSources).toContain('src/auth/handler.ts');
  });

  test('returns ORPHANED when document exists but not in index', async () => {
    // Manually create a doc without going through writeSpelunkDoc
    const docPath = path.join(
      tempDir,
      'docs/spelunk/contracts/orphaned-doc.md'
    );
    await fs.writeFile(docPath, '# Orphaned Doc');

    const result = await checkStaleness('contracts', 'orphaned-doc', tempDir);

    expect(result.status).toBe('ORPHANED');
    expect(result.docPath).toContain('orphaned-doc.md');
    expect(result.reason).toContain('no entry in _staleness.json');
  });

  test('handles multiple source files correctly', async () => {
    // Create a document with multiple source files
    await writeSpelunkDoc(
      'contracts',
      'auth-multi',
      '# Auth Contracts',
      ['src/auth/handler.ts', 'src/auth/types.ts'],
      { projectRoot: tempDir }
    );

    // Modify only one file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { changed() {} }'
    );

    const result = await checkStaleness('contracts', 'auth-multi', tempDir);

    expect(result.status).toBe('STALE');
    expect(result.staleSources).toHaveLength(1);
    expect(result.staleSources).toContain('src/auth/handler.ts');
    expect(result.staleSources).not.toContain('src/auth/types.ts');
  });

  test('detects all changed files when multiple change', async () => {
    // Create a document with multiple source files
    await writeSpelunkDoc(
      'contracts',
      'auth-all-changed',
      '# Auth',
      ['src/auth/handler.ts', 'src/auth/types.ts'],
      { projectRoot: tempDir }
    );

    // Modify both files
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { changed() {} }'
    );
    await fs.writeFile(
      path.join(tempDir, 'src/auth/types.ts'),
      'export type User = { id: number };'
    );

    const result = await checkStaleness('contracts', 'auth-all-changed', tempDir);

    expect(result.status).toBe('STALE');
    expect(result.staleSources).toHaveLength(2);
    expect(result.staleSources).toContain('src/auth/handler.ts');
    expect(result.staleSources).toContain('src/auth/types.ts');
  });

  test('works with interfaces lens (maps to contracts directory)', async () => {
    await writeSpelunkDoc(
      'interfaces',
      'api-interfaces',
      '# API Interfaces',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await checkStaleness('interfaces', 'api-interfaces', tempDir);

    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('docs/spelunk/contracts/api-interfaces.md');
  });

  test('works with flows lens', async () => {
    await writeSpelunkDoc(
      'flows',
      'login-flow',
      '# Login Flow',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await checkStaleness('flows', 'login-flow', tempDir);

    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('docs/spelunk/flows/login-flow.md');
  });

  test('works with boundaries lens', async () => {
    await writeSpelunkDoc(
      'boundaries',
      'auth-boundary',
      '# Auth Boundary',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await checkStaleness('boundaries', 'auth-boundary', tempDir);

    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('docs/spelunk/boundaries/auth-boundary.md');
  });

  test('works with trust-zones lens', async () => {
    await writeSpelunkDoc(
      'trust-zones',
      'public-zone',
      '# Public Zone',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const result = await checkStaleness('trust-zones', 'public-zone', tempDir);

    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('docs/spelunk/trust-zones/public-zone.md');
  });
});

// ============================================================================
// checkMultipleLenses() tests
// ============================================================================

describe('checkMultipleLenses', () => {
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

  test('checks multiple lenses for same focus', async () => {
    // Create docs in both contracts and boundaries
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );
    await writeSpelunkDoc(
      'boundaries',
      'auth',
      '# Auth Boundaries',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const results = await checkMultipleLenses(
      ['contracts', 'boundaries'],
      'auth',
      tempDir
    );

    expect(results.size).toBe(2);
    expect(results.get('contracts')?.status).toBe('FRESH');
    expect(results.get('boundaries')?.status).toBe('FRESH');
  });

  test('returns MISSING for non-existent lenses', async () => {
    const results = await checkMultipleLenses(
      ['contracts', 'flows'],
      'nonexistent',
      tempDir
    );

    expect(results.get('contracts')?.status).toBe('MISSING');
    expect(results.get('flows')?.status).toBe('MISSING');
  });

  test('returns mixed results correctly', async () => {
    // Create only contracts doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const results = await checkMultipleLenses(
      ['contracts', 'flows'],
      'auth',
      tempDir
    );

    expect(results.get('contracts')?.status).toBe('FRESH');
    expect(results.get('flows')?.status).toBe('MISSING');
  });

  test('handles empty lens array', async () => {
    const results = await checkMultipleLenses([], 'auth', tempDir);

    expect(results.size).toBe(0);
  });

  test('detects stale docs across multiple lenses', async () => {
    // Create docs in both lenses
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );
    await writeSpelunkDoc(
      'boundaries',
      'auth',
      '# Auth Boundaries',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Modify the source file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { changed() {} }'
    );

    const results = await checkMultipleLenses(
      ['contracts', 'boundaries'],
      'auth',
      tempDir
    );

    expect(results.get('contracts')?.status).toBe('STALE');
    expect(results.get('boundaries')?.status).toBe('STALE');
  });
});

// ============================================================================
// checkLensDirectory() tests
// ============================================================================

describe('checkLensDirectory', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler {}'
    );
    await createTestFile(
      tempDir,
      'src/users/service.ts',
      'export class UserService {}'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns empty array for non-existent directory', async () => {
    // Remove the directory
    await fs.rm(path.join(tempDir, 'docs/spelunk/contracts'), {
      recursive: true,
      force: true,
    });

    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toEqual([]);
  });

  test('returns empty array for empty directory', async () => {
    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toEqual([]);
  });

  test('checks all documents in directory', async () => {
    // Create multiple docs
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );
    await writeSpelunkDoc(
      'contracts',
      'users',
      '# Users',
      ['src/users/service.ts'],
      { projectRoot: tempDir }
    );

    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'FRESH')).toBe(true);
  });

  test('identifies stale documents', async () => {
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );
    await writeSpelunkDoc(
      'contracts',
      'users',
      '# Users',
      ['src/users/service.ts'],
      { projectRoot: tempDir }
    );

    // Modify one source file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { changed() {} }'
    );

    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toHaveLength(2);

    const authResult = results.find((r) =>
      r.docPath?.includes('auth.md')
    );
    const usersResult = results.find((r) =>
      r.docPath?.includes('users.md')
    );

    expect(authResult?.status).toBe('STALE');
    expect(usersResult?.status).toBe('FRESH');
  });

  test('identifies orphaned documents', async () => {
    // Create a proper doc
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Create an orphaned doc manually
    await fs.writeFile(
      path.join(tempDir, 'docs/spelunk/contracts/orphaned.md'),
      '# Orphaned'
    );

    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toHaveLength(2);

    const authResult = results.find((r) =>
      r.docPath?.includes('auth.md')
    );
    const orphanedResult = results.find((r) =>
      r.docPath?.includes('orphaned.md')
    );

    expect(authResult?.status).toBe('FRESH');
    expect(orphanedResult?.status).toBe('ORPHANED');
  });

  test('ignores non-markdown files', async () => {
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Create a non-markdown file
    await fs.writeFile(
      path.join(tempDir, 'docs/spelunk/contracts/readme.txt'),
      'Not a markdown file'
    );

    const results = await checkLensDirectory('contracts', tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].docPath).toContain('auth.md');
  });

  test('works with different lens types', async () => {
    await writeSpelunkDoc(
      'flows',
      'login',
      '# Login Flow',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const results = await checkLensDirectory('flows', tempDir);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('FRESH');
    expect(results[0].docPath).toContain('flows/login.md');
  });

  test('provides useful reason messages', async () => {
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts', 'src/users/service.ts'],
      { projectRoot: tempDir }
    );

    const freshResults = await checkLensDirectory('contracts', tempDir);
    expect(freshResults[0].reason).toContain('2 source file(s) are unchanged');

    // Make it stale
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'changed content'
    );

    const staleResults = await checkLensDirectory('contracts', tempDir);
    expect(staleResults[0].reason).toContain('have changed');
    expect(staleResults[0].reason).toContain('src/auth/handler.ts');
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: Staleness workflow', () => {
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

  test('complete staleness check workflow', async () => {
    // 1. Initial check - should be MISSING
    let result = await checkStaleness('contracts', 'auth', tempDir);
    expect(result.status).toBe('MISSING');

    // 2. Create the document
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // 3. Check again - should be FRESH
    result = await checkStaleness('contracts', 'auth', tempDir);
    expect(result.status).toBe('FRESH');

    // 4. Modify the source file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export class AuthHandler { newMethod() {} }'
    );

    // 5. Check again - should be STALE
    result = await checkStaleness('contracts', 'auth', tempDir);
    expect(result.status).toBe('STALE');
    expect(result.staleSources).toContain('src/auth/handler.ts');

    // 6. Re-spelunk (write new doc)
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts (Updated)',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // 7. Check again - should be FRESH
    result = await checkStaleness('contracts', 'auth', tempDir);
    expect(result.status).toBe('FRESH');
  });

  test('handles deleted source files gracefully', async () => {
    // Create document
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // Delete the source file
    await fs.unlink(path.join(tempDir, 'src/auth/handler.ts'));

    // Check - should be STALE (deleted file counts as changed)
    const result = await checkStaleness('contracts', 'auth', tempDir);
    expect(result.status).toBe('STALE');
    expect(result.staleSources).toContain('src/auth/handler.ts');
  });
});
