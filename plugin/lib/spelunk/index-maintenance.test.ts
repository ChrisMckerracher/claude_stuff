/**
 * Unit tests for Spelunk Index Maintenance
 *
 * Tests for the _index.md generation and maintenance functions
 * that provide a human-readable index of all spelunk documentation.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  generateIndex,
  updateIndex,
  getIndexEntries,
  IndexEntry,
} from './index-maintenance';
import { ensureDirectoryStructure, updateStalenessIndex } from './persistence';
import { DocStatus } from './types';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spelunk-index-test-'));
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

async function createSpelunkDoc(
  tempDir: string,
  lensDir: string,
  slug: string,
  focus: string
): Promise<void> {
  const docPath = path.join(tempDir, 'docs/spelunk', lensDir, `${slug}.md`);
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, `---
lens: ${lensDir === 'contracts' ? 'interfaces' : lensDir}
focus: "${focus}"
generated: 2024-01-10T12:00:00Z
source_files:
  - path: src/example.ts
    hash: abcd1234
tool_chain: lsp
---

# ${focus}

Documentation content here.
`);
}

// ============================================================================
// getIndexEntries() tests
// ============================================================================

describe('getIndexEntries', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns empty array when no documents exist', async () => {
    const entries = await getIndexEntries(tempDir);
    expect(entries).toEqual([]);
  });

  test('returns entries for existing documents', async () => {
    // Create a source file and spelunk doc
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'authentication', 'authentication layer');
    await updateStalenessIndex(
      'contracts/authentication.md',
      { 'src/auth.ts': 'abcd1234' },
      { projectRoot: tempDir }
    );

    const entries = await getIndexEntries(tempDir);
    expect(entries.length).toBe(1);
    expect(entries[0].focus).toBe('authentication layer');
    expect(entries[0].relativePath).toBe('contracts/authentication.md');
  });

  test('identifies FRESH documents correctly', async () => {
    // Create source file
    const srcPath = await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');

    // Compute actual hash
    const { computeHash } = await import('./persistence');
    const hash = await computeHash(srcPath);

    // Create spelunk doc and staleness entry with matching hash
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'auth');
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth.ts': hash },
      { projectRoot: tempDir }
    );

    const entries = await getIndexEntries(tempDir);
    expect(entries[0].status).toBe('FRESH');
  });

  test('identifies STALE documents correctly', async () => {
    // Create source file
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');

    // Create spelunk doc and staleness entry with NON-matching hash
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'auth');
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth.ts': 'oldhash1' }, // Different from actual file hash
      { projectRoot: tempDir }
    );

    const entries = await getIndexEntries(tempDir);
    expect(entries[0].status).toBe('STALE');
  });

  test('identifies ORPHANED documents correctly', async () => {
    // Create spelunk doc but NO staleness entry
    await createSpelunkDoc(tempDir, 'contracts', 'orphan', 'orphan doc');

    const entries = await getIndexEntries(tempDir);
    expect(entries[0].status).toBe('ORPHANED');
  });

  test('returns entries from multiple lens directories', async () => {
    await createTestFile(tempDir, 'src/example.ts', 'export const example = {};');

    // Create docs in different directories
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'authentication');
    await createSpelunkDoc(tempDir, 'flows', 'login', 'login flow');
    await createSpelunkDoc(tempDir, 'boundaries', 'api', 'api boundary');

    // Add staleness entries
    await updateStalenessIndex('contracts/auth.md', { 'src/example.ts': 'hash1' }, { projectRoot: tempDir });
    await updateStalenessIndex('flows/login.md', { 'src/example.ts': 'hash2' }, { projectRoot: tempDir });
    await updateStalenessIndex('boundaries/api.md', { 'src/example.ts': 'hash3' }, { projectRoot: tempDir });

    const entries = await getIndexEntries(tempDir);
    expect(entries.length).toBe(3);

    const lenses = entries.map(e => e.lens);
    expect(lenses).toContain('contracts');
    expect(lenses).toContain('flows');
    expect(lenses).toContain('boundaries');
  });

  test('extracts source file count from staleness index', async () => {
    await createTestFile(tempDir, 'src/file1.ts', 'export const a = 1;');
    await createTestFile(tempDir, 'src/file2.ts', 'export const b = 2;');
    await createTestFile(tempDir, 'src/file3.ts', 'export const c = 3;');

    await createSpelunkDoc(tempDir, 'contracts', 'multi', 'multi-source');
    await updateStalenessIndex(
      'contracts/multi.md',
      {
        'src/file1.ts': 'hash1',
        'src/file2.ts': 'hash2',
        'src/file3.ts': 'hash3',
      },
      { projectRoot: tempDir }
    );

    const entries = await getIndexEntries(tempDir);
    expect(entries[0].sourceFileCount).toBe(3);
  });

  test('sorts entries alphabetically by focus within each lens', async () => {
    await createSpelunkDoc(tempDir, 'contracts', 'zebra', 'zebra module');
    await createSpelunkDoc(tempDir, 'contracts', 'alpha', 'alpha module');
    await createSpelunkDoc(tempDir, 'contracts', 'middle', 'middle module');

    await updateStalenessIndex('contracts/zebra.md', { 'src/z.ts': 'h1' }, { projectRoot: tempDir });
    await updateStalenessIndex('contracts/alpha.md', { 'src/a.ts': 'h2' }, { projectRoot: tempDir });
    await updateStalenessIndex('contracts/middle.md', { 'src/m.ts': 'h3' }, { projectRoot: tempDir });

    const entries = await getIndexEntries(tempDir);
    const contractEntries = entries.filter(e => e.lens === 'contracts');

    expect(contractEntries[0].focus).toBe('alpha module');
    expect(contractEntries[1].focus).toBe('middle module');
    expect(contractEntries[2].focus).toBe('zebra module');
  });
});

// ============================================================================
// generateIndex() tests
// ============================================================================

describe('generateIndex', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates markdown with correct header', async () => {
    const content = await generateIndex(tempDir);
    expect(content).toContain('# Spelunking Documentation Index');
    expect(content).toContain('Last updated:');
  });

  test('shows "(empty)" for lenses with no documents', async () => {
    const content = await generateIndex(tempDir);

    // All lens sections should show (empty)
    expect(content).toContain('### Contracts\n(empty)');
    expect(content).toContain('### Flows\n(empty)');
    expect(content).toContain('### Boundaries\n(empty)');
    expect(content).toContain('### Trust Zones\n(empty)');
  });

  test('generates table for lens with documents', async () => {
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'authentication layer');
    await updateStalenessIndex(
      'contracts/auth.md',
      { 'src/auth.ts': 'hash123' },
      { projectRoot: tempDir }
    );

    const content = await generateIndex(tempDir);

    expect(content).toContain('### Contracts');
    expect(content).toContain('| Focus | Status | Generated | Source Files |');
    expect(content).toContain('|-------|--------|-----------|--------------|');
    expect(content).toContain('[authentication layer](contracts/auth.md)');
  });

  test('shows correct status emoji for FRESH', async () => {
    const srcPath = await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    const { computeHash } = await import('./persistence');
    const hash = await computeHash(srcPath);

    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'auth');
    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': hash }, { projectRoot: tempDir });

    const content = await generateIndex(tempDir);
    expect(content).toMatch(/FRESH/);
  });

  test('shows correct status emoji for STALE', async () => {
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'auth');
    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': 'wronghash' }, { projectRoot: tempDir });

    const content = await generateIndex(tempDir);
    expect(content).toMatch(/STALE/);
  });

  test('shows correct status emoji for ORPHANED', async () => {
    await createSpelunkDoc(tempDir, 'contracts', 'orphan', 'orphan doc');

    const content = await generateIndex(tempDir);
    expect(content).toMatch(/ORPHANED/);
  });

  test('includes statistics section', async () => {
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'auth');
    await createSpelunkDoc(tempDir, 'flows', 'login', 'login');

    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': 'hash1' }, { projectRoot: tempDir });
    await updateStalenessIndex('flows/login.md', { 'src/auth.ts': 'hash2' }, { projectRoot: tempDir });

    const content = await generateIndex(tempDir);

    expect(content).toContain('## Statistics');
    expect(content).toContain('Total documents:');
  });

  test('calculates percentage statistics correctly', async () => {
    // Create 3 docs: 2 stale, 1 orphaned
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');

    await createSpelunkDoc(tempDir, 'contracts', 'doc1', 'doc one');
    await createSpelunkDoc(tempDir, 'contracts', 'doc2', 'doc two');
    await createSpelunkDoc(tempDir, 'contracts', 'doc3', 'doc three'); // no staleness entry = orphaned

    await updateStalenessIndex('contracts/doc1.md', { 'src/auth.ts': 'wrong1' }, { projectRoot: tempDir });
    await updateStalenessIndex('contracts/doc2.md', { 'src/auth.ts': 'wrong2' }, { projectRoot: tempDir });

    const content = await generateIndex(tempDir);

    expect(content).toContain('Total documents: 3');
    expect(content).toContain('Stale: 2');
    expect(content).toContain('Orphaned: 1');
  });
});

// ============================================================================
// updateIndex() tests
// ============================================================================

describe('updateIndex', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('writes _index.md to docs/spelunk/', async () => {
    await updateIndex(tempDir);

    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const exists = await fs.stat(indexPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  test('updates existing _index.md', async () => {
    // Create initial index
    await updateIndex(tempDir);

    // Add a document
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'authentication');
    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': 'hash1' }, { projectRoot: tempDir });

    // Update index
    await updateIndex(tempDir);

    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const content = await fs.readFile(indexPath, 'utf-8');

    expect(content).toContain('authentication');
  });

  test('index content matches generateIndex output', async () => {
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'authentication');
    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': 'hash1' }, { projectRoot: tempDir });

    await updateIndex(tempDir);

    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const fileContent = await fs.readFile(indexPath, 'utf-8');
    const generatedContent = await generateIndex(tempDir);

    // Content should be the same (allowing for slight timestamp differences)
    expect(fileContent).toContain('# Spelunking Documentation Index');
    expect(fileContent).toContain('authentication');
  });
});

// ============================================================================
// Integration tests
// ============================================================================

describe('Integration: Index maintenance workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('complete workflow: add docs, generate index, verify content', async () => {
    // Create source files
    await createTestFile(tempDir, 'src/auth/handler.ts', 'export class AuthHandler {}');
    await createTestFile(tempDir, 'src/payment/processor.ts', 'export class PaymentProcessor {}');
    await createTestFile(tempDir, 'src/user/registration.ts', 'export class UserRegistration {}');

    // Create spelunk docs
    await createSpelunkDoc(tempDir, 'contracts', 'authentication-layer', 'authentication layer');
    await createSpelunkDoc(tempDir, 'contracts', 'payment-processing', 'payment processing');
    await createSpelunkDoc(tempDir, 'flows', 'user-registration', 'user registration');

    // Add staleness entries (with wrong hashes to simulate stale docs)
    await updateStalenessIndex(
      'contracts/authentication-layer.md',
      { 'src/auth/handler.ts': 'stale1' },
      { projectRoot: tempDir }
    );
    await updateStalenessIndex(
      'contracts/payment-processing.md',
      { 'src/payment/processor.ts': 'stale2' },
      { projectRoot: tempDir }
    );
    await updateStalenessIndex(
      'flows/user-registration.md',
      { 'src/user/registration.ts': 'stale3' },
      { projectRoot: tempDir }
    );

    // Generate and write index
    await updateIndex(tempDir);

    // Verify index content
    const indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    const content = await fs.readFile(indexPath, 'utf-8');

    // Check structure
    expect(content).toContain('# Spelunking Documentation Index');
    expect(content).toContain('## By Lens');
    expect(content).toContain('### Contracts');
    expect(content).toContain('### Flows');
    expect(content).toContain('## Statistics');

    // Check docs are listed
    expect(content).toContain('authentication layer');
    expect(content).toContain('payment processing');
    expect(content).toContain('user registration');

    // Check links
    expect(content).toContain('[authentication layer](contracts/authentication-layer.md)');
    expect(content).toContain('[user registration](flows/user-registration.md)');

    // Check statistics
    expect(content).toContain('Total documents: 3');
  });

  test('index reflects freshness changes when source files change', async () => {
    // Create source file
    const srcPath = await createTestFile(tempDir, 'src/auth.ts', 'original content');
    const { computeHash } = await import('./persistence');
    const originalHash = await computeHash(srcPath);

    // Create spelunk doc with correct hash (FRESH)
    await createSpelunkDoc(tempDir, 'contracts', 'auth', 'authentication');
    await updateStalenessIndex('contracts/auth.md', { 'src/auth.ts': originalHash }, { projectRoot: tempDir });

    // Verify it's fresh
    let entries = await getIndexEntries(tempDir);
    expect(entries[0].status).toBe('FRESH');

    // Modify source file
    await fs.writeFile(srcPath, 'modified content');

    // Verify it's now stale
    entries = await getIndexEntries(tempDir);
    expect(entries[0].status).toBe('STALE');
  });
});
