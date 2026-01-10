/**
 * Unit tests for Spelunk Persistence Layer
 *
 * Tests for the persistence functions that write spelunk findings
 * to docs/spelunk/ and manage the staleness index.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  toSlug,
  computeHash,
  ensureDirectoryStructure,
  writeSpelunkDoc,
  updateStalenessIndex,
  readStalenessIndex,
  getSpelunkDocPath,
  spelunkDocExists,
} from './persistence';
import { SPELUNK_DIRECTORIES, MAX_SLUG_LENGTH, HASH_LENGTH } from './types';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spelunk-test-'));
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
// toSlug() tests
// ============================================================================

describe('toSlug', () => {
  test('converts spaces to hyphens', () => {
    expect(toSlug('authentication layer')).toBe('authentication-layer');
  });

  test('converts to lowercase', () => {
    expect(toSlug('User Onboarding Flow')).toBe('user-onboarding-flow');
  });

  test('removes special characters', () => {
    expect(toSlug("API endpoints (v2)")).toBe('api-endpoints-v2');
  });

  test('collapses multiple hyphens', () => {
    expect(toSlug('auth---layer')).toBe('auth-layer');
  });

  test('removes leading and trailing hyphens', () => {
    expect(toSlug('  auth layer  ')).toBe('auth-layer');
  });

  test('handles single word', () => {
    expect(toSlug('authentication')).toBe('authentication');
  });

  test('handles empty string', () => {
    expect(toSlug('')).toBe('');
  });

  test('truncates long strings with hash suffix', () => {
    const longFocus = 'checkout process including cart validation and payment processing workflow';
    const slug = toSlug(longFocus);

    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    // Should end with a 4-char hash
    expect(slug).toMatch(/-[a-f0-9]{4}$/);
  });

  test('truncated slugs are unique for different inputs', () => {
    const focus1 = 'checkout process including cart validation and payment processing workflow alpha';
    const focus2 = 'checkout process including cart validation and payment processing workflow beta';

    const slug1 = toSlug(focus1);
    const slug2 = toSlug(focus2);

    expect(slug1).not.toBe(slug2);
    expect(slug1.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug2.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
  });

  test('exactly MAX_SLUG_LENGTH chars are not truncated', () => {
    // Create a string that produces exactly 50 char slug
    const focus = 'a'.repeat(50);
    const slug = toSlug(focus);
    expect(slug).toBe('a'.repeat(50));
    expect(slug.length).toBe(MAX_SLUG_LENGTH);
  });
});

// ============================================================================
// computeHash() tests
// ============================================================================

describe('computeHash', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns first 8 characters of SHA-256', async () => {
    const filePath = await createTestFile(tempDir, 'test.ts', 'export const foo = "bar";');
    const hash = await computeHash(filePath);

    expect(hash.length).toBe(HASH_LENGTH);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });

  test('produces consistent hash for same content', async () => {
    const content = 'export const foo = "bar";';
    const file1 = await createTestFile(tempDir, 'test1.ts', content);
    const file2 = await createTestFile(tempDir, 'test2.ts', content);

    const hash1 = await computeHash(file1);
    const hash2 = await computeHash(file2);

    expect(hash1).toBe(hash2);
  });

  test('produces different hash for different content', async () => {
    const file1 = await createTestFile(tempDir, 'test1.ts', 'const a = 1;');
    const file2 = await createTestFile(tempDir, 'test2.ts', 'const b = 2;');

    const hash1 = await computeHash(file1);
    const hash2 = await computeHash(file2);

    expect(hash1).not.toBe(hash2);
  });

  test('throws error for non-existent file', async () => {
    await expect(computeHash(path.join(tempDir, 'nonexistent.ts'))).rejects.toThrow();
  });

  test('handles binary content', async () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    const filePath = path.join(tempDir, 'binary.bin');
    await fs.writeFile(filePath, binaryContent);

    const hash = await computeHash(filePath);
    expect(hash.length).toBe(HASH_LENGTH);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
  });
});

// ============================================================================
// ensureDirectoryStructure() tests
// ============================================================================

describe('ensureDirectoryStructure', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('creates all required directories', async () => {
    await ensureDirectoryStructure(tempDir);

    for (const dir of SPELUNK_DIRECTORIES) {
      const dirPath = path.join(tempDir, 'docs/spelunk', dir);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    }
  });

  test('is idempotent - can be called multiple times', async () => {
    await ensureDirectoryStructure(tempDir);
    await ensureDirectoryStructure(tempDir);

    for (const dir of SPELUNK_DIRECTORIES) {
      const dirPath = path.join(tempDir, 'docs/spelunk', dir);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    }
  });

  test('does not remove existing files', async () => {
    await ensureDirectoryStructure(tempDir);

    // Create a file in one of the directories
    const testFile = path.join(tempDir, 'docs/spelunk/contracts/test.md');
    await fs.writeFile(testFile, 'test content');

    // Run again
    await ensureDirectoryStructure(tempDir);

    // File should still exist
    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('test content');
  });
});

// ============================================================================
// writeSpelunkDoc() tests
// ============================================================================

describe('writeSpelunkDoc', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Create source files for testing
    await createTestFile(tempDir, 'src/auth/handler.ts', 'export class AuthHandler {}');
    await createTestFile(tempDir, 'src/auth/types.ts', 'export type User = { id: string };');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('writes document to correct directory based on lens', async () => {
    const docPath = await writeSpelunkDoc(
      'interfaces',
      'authentication layer',
      '# Authentication\n\nContent here',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    expect(docPath).toContain('docs/spelunk/contracts/authentication-layer.md');
    const exists = await fs.stat(docPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('generates correct frontmatter', async () => {
    await writeSpelunkDoc(
      'interfaces',
      'auth layer',
      '# Content',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir, toolChain: 'lsp' }
    );

    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth-layer.md');
    const content = await fs.readFile(docPath, 'utf-8');

    expect(content).toContain('---');
    expect(content).toContain('lens: interfaces');
    expect(content).toContain('focus: "auth layer"');
    expect(content).toContain('tool_chain: lsp');
    expect(content).toContain('source_files:');
    expect(content).toContain('path: src/auth/handler.ts');
    expect(content).toMatch(/hash: [a-f0-9]{8}/);
    expect(content).toMatch(/generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('includes markdown content after frontmatter', async () => {
    const markdownContent = '# Authentication Layer\n\n## Interfaces\n\nSome content here.';

    await writeSpelunkDoc(
      'interfaces',
      'auth',
      markdownContent,
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    const content = await fs.readFile(docPath, 'utf-8');

    // Content should be after the closing ---
    const parts = content.split('---');
    expect(parts.length).toBe(3); // Before, frontmatter, after
    expect(parts[2].trim()).toContain('# Authentication Layer');
    expect(parts[2]).toContain('## Interfaces');
  });

  test('handles multiple source files', async () => {
    await writeSpelunkDoc(
      'interfaces',
      'auth',
      '# Content',
      ['src/auth/handler.ts', 'src/auth/types.ts'],
      { projectRoot: tempDir }
    );

    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    const content = await fs.readFile(docPath, 'utf-8');

    expect(content).toContain('path: src/auth/handler.ts');
    expect(content).toContain('path: src/auth/types.ts');
  });

  test('updates staleness index', async () => {
    await writeSpelunkDoc(
      'interfaces',
      'auth',
      '# Content',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const index = await readStalenessIndex(tempDir);
    expect(index).not.toBeNull();
    expect(index!.docs['contracts/auth.md']).toBeDefined();
    expect(index!.docs['contracts/auth.md'].source_files['src/auth/handler.ts']).toBeDefined();
  });

  test('uses correct directory for each lens type', async () => {
    const testCases: Array<{ lens: 'interfaces' | 'flows' | 'boundaries' | 'contracts' | 'trust-zones'; expectedDir: string }> = [
      { lens: 'interfaces', expectedDir: 'contracts' },
      { lens: 'flows', expectedDir: 'flows' },
      { lens: 'boundaries', expectedDir: 'boundaries' },
      { lens: 'contracts', expectedDir: 'contracts' },
      { lens: 'trust-zones', expectedDir: 'trust-zones' },
    ];

    for (const { lens, expectedDir } of testCases) {
      const docPath = await writeSpelunkDoc(
        lens,
        `test-${lens}`,
        '# Content',
        ['src/auth/handler.ts'],
        { projectRoot: tempDir }
      );

      expect(docPath).toContain(`docs/spelunk/${expectedDir}/test-${lens}.md`);
    }
  });

  test('skips source files that do not exist', async () => {
    // Should not throw, just warn
    const docPath = await writeSpelunkDoc(
      'interfaces',
      'auth',
      '# Content',
      ['src/auth/handler.ts', 'src/nonexistent.ts'],
      { projectRoot: tempDir }
    );

    const content = await fs.readFile(docPath, 'utf-8');
    expect(content).toContain('src/auth/handler.ts');
    expect(content).not.toContain('src/nonexistent.ts');
  });
});

// ============================================================================
// updateStalenessIndex() tests
// ============================================================================

describe('updateStalenessIndex', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('creates new index file if not exists', async () => {
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'a1b2c3d4' },
      { projectRoot: tempDir }
    );

    const indexPath = path.join(tempDir, 'docs/spelunk/_staleness.json');
    const exists = await fs.stat(indexPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('creates index with correct structure', async () => {
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'a1b2c3d4' },
      { projectRoot: tempDir }
    );

    const index = await readStalenessIndex(tempDir);
    expect(index).not.toBeNull();
    expect(index!.version).toBe(1);
    expect(index!.docs['contracts/auth.md']).toBeDefined();
    expect(index!.docs['contracts/auth.md'].source_files['src/auth/handler.ts']).toBe('a1b2c3d4');
  });

  test('preserves existing entries when adding new ones', async () => {
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'a1b2c3d4' },
      { projectRoot: tempDir }
    );

    await updateStalenessIndex(
      'flows/login.md',
      { 'src/login/flow.ts': 'e5f6g7h8' },
      { projectRoot: tempDir }
    );

    const index = await readStalenessIndex(tempDir);
    expect(index!.docs['contracts/auth.md']).toBeDefined();
    expect(index!.docs['flows/login.md']).toBeDefined();
  });

  test('updates existing entry', async () => {
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'a1b2c3d4' },
      { projectRoot: tempDir }
    );

    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'newHash1' },
      { projectRoot: tempDir }
    );

    const index = await readStalenessIndex(tempDir);
    expect(index!.docs['contracts/auth.md'].source_files['src/auth/handler.ts']).toBe('newHash1');
  });

  test('includes generated timestamp', async () => {
    const before = new Date();

    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth/handler.ts': 'a1b2c3d4' },
      { projectRoot: tempDir }
    );

    const after = new Date();
    const index = await readStalenessIndex(tempDir);
    const generated = new Date(index!.docs['contracts/auth.md'].generated);

    expect(generated.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(generated.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

// ============================================================================
// getSpelunkDocPath() tests
// ============================================================================

describe('getSpelunkDocPath', () => {
  test('returns correct relative and absolute paths', () => {
    const result = getSpelunkDocPath('interfaces', 'auth layer', '/project');

    expect(result.relative).toBe('docs/spelunk/contracts/auth-layer.md');
    expect(result.absolute).toBe('/project/docs/spelunk/contracts/auth-layer.md');
  });

  test('uses lens-to-directory mapping', () => {
    expect(getSpelunkDocPath('flows', 'login', '/project').relative)
      .toBe('docs/spelunk/flows/login.md');

    expect(getSpelunkDocPath('boundaries', 'api', '/project').relative)
      .toBe('docs/spelunk/boundaries/api.md');

    expect(getSpelunkDocPath('trust-zones', 'auth', '/project').relative)
      .toBe('docs/spelunk/trust-zones/auth.md');
  });
});

// ============================================================================
// spelunkDocExists() tests
// ============================================================================

describe('spelunkDocExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns false for non-existent document', async () => {
    const exists = await spelunkDocExists('interfaces', 'nonexistent', tempDir);
    expect(exists).toBe(false);
  });

  test('returns true for existing document', async () => {
    // Create a document
    const docPath = path.join(tempDir, 'docs/spelunk/contracts/auth.md');
    await fs.writeFile(docPath, '# Auth');

    const exists = await spelunkDocExists('interfaces', 'auth', tempDir);
    expect(exists).toBe(true);
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: Full spelunk workflow', () => {
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

  test('complete workflow: ensure structure, write doc, update index', async () => {
    // 1. Ensure directory structure
    await ensureDirectoryStructure(tempDir);

    // 2. Write a spelunk document
    const docPath = await writeSpelunkDoc(
      'interfaces',
      'authentication layer',
      `# Authentication Layer Contracts

## Summary
This module provides authentication interfaces for the application.

## Interfaces

### AuthHandler
- \`src/auth/handler.ts:L2-5\`
  \`\`\`typescript
  interface AuthHandler {
    authenticate(token: string): Promise<User>;
    refresh(refreshToken: string): Promise<TokenPair>;
  }
  \`\`\`
`,
      ['src/auth/handler.ts', 'src/auth/types.ts'],
      { projectRoot: tempDir, toolChain: 'lsp' }
    );

    // 3. Verify document was written
    const docContent = await fs.readFile(docPath, 'utf-8');
    expect(docContent).toContain('lens: interfaces');
    expect(docContent).toContain('# Authentication Layer Contracts');

    // 4. Verify staleness index was updated
    const index = await readStalenessIndex(tempDir);
    expect(index).not.toBeNull();
    expect(index!.docs['contracts/authentication-layer.md']).toBeDefined();

    const entry = index!.docs['contracts/authentication-layer.md'];
    expect(entry.source_files['src/auth/handler.ts']).toBeDefined();
    expect(entry.source_files['src/auth/types.ts']).toBeDefined();

    // 5. Verify document exists check
    const exists = await spelunkDocExists('interfaces', 'authentication layer', tempDir);
    expect(exists).toBe(true);
  });

  test('staleness detection: hash changes when file changes', async () => {
    // Initial write
    await writeSpelunkDoc(
      'interfaces',
      'auth',
      '# Auth',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    const index1 = await readStalenessIndex(tempDir);
    const originalHash = index1!.docs['contracts/auth.md'].source_files['src/auth/handler.ts'];

    // Modify the source file
    await fs.writeFile(
      path.join(tempDir, 'src/auth/handler.ts'),
      'export interface AuthHandler { newMethod(): void; }'
    );

    // Compute new hash
    const newHash = await computeHash(path.join(tempDir, 'src/auth/handler.ts'));

    // Hashes should be different
    expect(newHash).not.toBe(originalHash);
  });
});
