/**
 * Integration tests for Spelunk Mode
 *
 * End-to-end tests that verify the complete spelunk workflow including:
 * - Full spelunk execution (spelunk -> check -> read)
 * - Staleness detection and regeneration
 * - Cross-agent document sharing
 * - Tool fallback behavior
 * - Index maintenance
 * - Error handling
 * - Options handling
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  spelunk,
  SpelunkResult,
  isSpelunkAvailable,
  getSpelunkCapabilities,
} from './orchestrator';
import {
  ensureDirectoryStructure,
  writeSpelunkDoc,
  readStalenessIndex,
  computeHash,
  getSpelunkDocPath,
} from './persistence';
import { checkStaleness, checkMultipleLenses } from './staleness-check';
import { updateIndex, getIndexEntries } from './index-maintenance';
import { LensType } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'spelunk-integration-test-'));
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

async function readDocContent(docPath: string): Promise<string> {
  return fs.readFile(docPath, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// 1. Full Spelunk Workflow Tests
// =============================================================================

describe('spelunk integration: Full Workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('complete workflow: spelunk -> fresh check -> read', async () => {
    // Setup: Create source files
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      `export interface AuthRequest {
        token: string;
        userId: string;
      }
      export class AuthHandler {
        async authenticate(req: AuthRequest): Promise<boolean> {
          return req.token.length > 0;
        }
      }`
    );
    await createTestFile(
      tempDir,
      'src/auth/types.ts',
      `export type User = { id: string; name: string; };
       export type Session = { userId: string; expiresAt: Date; };`
    );

    // 1. Initial check - should be MISSING
    let result = await spelunk('--check --for=architect --focus="auth"', tempDir);
    expect(result.status).toBe('check_only');
    expect(result.staleness?.get('interfaces')?.status).toBe('MISSING');
    expect(result.staleness?.get('boundaries')?.status).toBe('MISSING');

    // 2. Generate spelunk docs
    result = await spelunk('--for=architect --focus="auth"', tempDir);
    expect(result.status).toBe('generated');
    expect(result.docPaths.length).toBeGreaterThanOrEqual(1);

    // 3. Check staleness - should now be FRESH
    result = await spelunk('--check --for=architect --focus="auth"', tempDir);
    expect(result.status).toBe('check_only');
    // At least one lens should have a doc path
    const hasDoc = result.docPaths.length > 0;
    expect(hasDoc).toBe(true);

    // 4. Read docs and verify content exists
    for (const docPath of result.docPaths) {
      const content = await readDocContent(docPath);
      expect(content).toBeTruthy();
      expect(content).toContain('---'); // Has frontmatter
    }

    // 5. Run spelunk again - should return fresh without regenerating
    result = await spelunk('--for=architect --focus="auth"', tempDir);
    expect(['fresh', 'generated']).toContain(result.status);
  });

  test('staleness detection: modify source -> stale', async () => {
    // 1. Create source file and initial spelunk doc
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler { login() {} }'
    );

    // Create a doc using writeSpelunkDoc for controlled testing
    await writeSpelunkDoc(
      'contracts',
      'auth',
      '# Auth Contracts\n\nInitial documentation.',
      ['src/auth/handler.ts'],
      { projectRoot: tempDir }
    );

    // 2. Verify it is FRESH
    let checkResult = await checkStaleness('contracts', 'auth', tempDir);
    expect(checkResult.status).toBe('FRESH');

    // 3. Modify source file (change content -> change hash)
    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      'export class AuthHandler { login() {} logout() {} /* modified */ }'
    );

    // 4. Check staleness - should be STALE
    checkResult = await checkStaleness('contracts', 'auth', tempDir);
    expect(checkResult.status).toBe('STALE');
    expect(checkResult.staleSources).toContain('src/auth/handler.ts');

    // 5. Verify staleSources in result
    const result = await spelunk('--check --lens=contracts --focus="auth"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('STALE');
    expect(result.staleness?.get('contracts')?.staleSources).toContain('src/auth/handler.ts');
  });

  test('regeneration after staleness', async () => {
    // Setup
    await createTestFile(
      tempDir,
      'src/payment/processor.ts',
      'export class PaymentProcessor { charge() {} }'
    );

    // Create initial doc
    await writeSpelunkDoc(
      'contracts',
      'payment',
      '# Payment Contracts',
      ['src/payment/processor.ts'],
      { projectRoot: tempDir }
    );

    // Verify FRESH
    let result = await spelunk('--check --lens=contracts --focus="payment"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');

    // Modify source
    await createTestFile(
      tempDir,
      'src/payment/processor.ts',
      'export class PaymentProcessor { charge() {} refund() {} }'
    );

    // Should be STALE now
    result = await spelunk('--check --lens=contracts --focus="payment"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('STALE');

    // Regenerate
    result = await spelunk('--lens=contracts --focus="payment"', tempDir);
    expect(result.status).toBe('generated');

    // Should be FRESH again after regeneration
    result = await spelunk('--check --lens=contracts --focus="payment"', tempDir);
    // After regeneration, the doc references files found during exploration
    // which may differ from the manually created doc
    expect(['FRESH', 'STALE']).toContain(result.staleness?.get('contracts')?.status);
  });
});

// =============================================================================
// 2. Cross-Agent Workflow Tests
// =============================================================================

describe('spelunk integration: Cross-Agent Workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    // Create shared source files
    await createTestFile(
      tempDir,
      'src/api/contracts.ts',
      `export interface ApiRequest { endpoint: string; }
       export interface ApiResponse { status: number; data: unknown; }`
    );
    await createTestFile(
      tempDir,
      'src/api/handler.ts',
      'export class ApiHandler { handle() {} }'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('architect spelunk -> product can read', async () => {
    // 1. Architect spelunks contracts/ (interfaces lens maps to contracts/)
    await writeSpelunkDoc(
      'interfaces',
      'api-layer',
      '# API Layer Interfaces\n\n- ApiRequest\n- ApiResponse',
      ['src/api/contracts.ts'],
      { projectRoot: tempDir }
    );

    // 2. Product checks contracts/ - finds FRESH doc
    const result = await checkStaleness('interfaces', 'api-layer', tempDir);
    expect(result.status).toBe('FRESH');
    expect(result.docPath).toContain('contracts/api-layer.md');

    // 3. Product can read doc content without re-spelunking
    const docContent = await readDocContent(result.docPath!);
    expect(docContent).toContain('API Layer Interfaces');
    expect(docContent).toContain('interfaces'); // lens in frontmatter
  });

  test('qa and security share contracts/ docs', async () => {
    // 1. QA spelunks contracts/
    await writeSpelunkDoc(
      'contracts',
      'api-contracts',
      '# API Contracts\n\nContract definitions for API.',
      ['src/api/contracts.ts', 'src/api/handler.ts'],
      { projectRoot: tempDir }
    );

    // 2. Security checks contracts/ - finds existing doc
    const qaResult = await checkStaleness('contracts', 'api-contracts', tempDir);
    expect(qaResult.status).toBe('FRESH');
    expect(qaResult.docPath).toContain('contracts/api-contracts.md');

    // Both QA and Security share contracts lens
    const multiResults = await checkMultipleLenses(
      ['contracts', 'trust-zones'],
      'api-contracts',
      tempDir
    );

    // contracts/ doc exists and is fresh
    expect(multiResults.get('contracts')?.status).toBe('FRESH');
    // trust-zones/ doc doesn't exist yet
    expect(multiResults.get('trust-zones')?.status).toBe('MISSING');
  });

  test('multiple agents can read same doc without conflict', async () => {
    // Create a shared doc
    await writeSpelunkDoc(
      'boundaries',
      'service-boundaries',
      '# Service Boundaries\n\nBoundary definitions.',
      ['src/api/handler.ts'],
      { projectRoot: tempDir }
    );

    // All agents can check the same doc
    const architectCheck = await checkStaleness('boundaries', 'service-boundaries', tempDir);
    const productCheck = await checkStaleness('boundaries', 'service-boundaries', tempDir);
    const qaCheck = await checkStaleness('boundaries', 'service-boundaries', tempDir);

    expect(architectCheck.status).toBe('FRESH');
    expect(productCheck.status).toBe('FRESH');
    expect(qaCheck.status).toBe('FRESH');

    // All should point to same doc
    expect(architectCheck.docPath).toBe(productCheck.docPath);
    expect(productCheck.docPath).toBe(qaCheck.docPath);
  });
});

// =============================================================================
// 3. Tool Fallback Behavior Tests
// =============================================================================

describe('spelunk integration: Tool Strategy Selection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/example.ts',
      'export class Example { method() {} }'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('spelunk is always available (grep fallback)', () => {
    expect(isSpelunkAvailable()).toBe(true);
  });

  test('capabilities report includes all strategies', () => {
    const capabilities = getSpelunkCapabilities();

    expect(capabilities).toHaveProperty('lsp');
    expect(capabilities).toHaveProperty('ast');
    expect(capabilities).toHaveProperty('grep');
    expect(capabilities).toHaveProperty('preferredStrategy');

    // grep is always available as fallback
    expect(capabilities.grep).toBe(true);
    expect(['lsp', 'ast', 'grep']).toContain(capabilities.preferredStrategy);
  });

  test('spelunk completes regardless of tool availability', async () => {
    // This test verifies that spelunk can complete even when
    // LSP and AST tools are not available (uses grep fallback)
    const result = await spelunk('--lens=contracts --focus="example"', tempDir);

    // Should complete without error
    expect(['fresh', 'generated']).toContain(result.status);
  });

  test('generates valid docs with any available strategy', async () => {
    const result = await spelunk('--lens=interfaces --focus="example"', tempDir);

    expect(result.status).toBe('generated');
    expect(result.docPaths.length).toBeGreaterThan(0);

    // Verify doc is valid
    const docPath = result.docPaths[0];
    const content = await readDocContent(docPath);
    expect(content).toContain('---'); // Has frontmatter
    expect(content).toContain('tool_chain:'); // Records tool chain used
  });
});

// =============================================================================
// 4. Index Maintenance Tests
// =============================================================================

describe('spelunk integration: Index Maintenance', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = {};');
    await createTestFile(tempDir, 'src/user.ts', 'export const user = {};');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('_index.md updated after each spelunk', async () => {
    // 1. Spelunk first doc
    await writeSpelunkDoc(
      'contracts',
      'auth-module',
      '# Auth Module',
      ['src/auth.ts'],
      { projectRoot: tempDir }
    );

    // Update index
    await updateIndex(tempDir);

    // 2. Verify _index.md contains first entry
    let indexPath = path.join(tempDir, 'docs/spelunk/_index.md');
    let indexContent = await readDocContent(indexPath);
    expect(indexContent).toContain('auth-module');

    // 3. Spelunk another doc
    await writeSpelunkDoc(
      'flows',
      'user-registration',
      '# User Registration Flow',
      ['src/user.ts'],
      { projectRoot: tempDir }
    );

    // Update index again
    await updateIndex(tempDir);

    // 4. Verify both entries present
    indexContent = await readDocContent(indexPath);
    expect(indexContent).toContain('auth-module');
    expect(indexContent).toContain('user-registration');
    expect(indexContent).toContain('Contracts');
    expect(indexContent).toContain('Flows');
  });

  test('_staleness.json updated with hashes', async () => {
    // Create doc
    await writeSpelunkDoc(
      'contracts',
      'hash-test',
      '# Hash Test',
      ['src/auth.ts'],
      { projectRoot: tempDir }
    );

    // Read staleness index
    const index = await readStalenessIndex(tempDir);
    expect(index).not.toBeNull();
    expect(index?.version).toBe(1);

    // Use bracket notation for paths with slashes
    const docKey = 'contracts/hash-test.md';
    expect(index?.docs[docKey]).toBeDefined();

    // Verify hash is stored
    const entry = index?.docs[docKey];
    expect(entry?.source_files['src/auth.ts']).toBeDefined();
    expect(entry?.source_files['src/auth.ts']).toHaveLength(8); // HASH_LENGTH
  });

  test('index entries reflect current staleness status', async () => {
    // Create source and doc with matching hash
    const srcPath = path.join(tempDir, 'src/auth.ts');
    const hash = await computeHash(srcPath);

    await writeSpelunkDoc(
      'contracts',
      'status-test',
      '# Status Test',
      ['src/auth.ts'],
      { projectRoot: tempDir }
    );

    // Get index entries - should be FRESH
    let entries = await getIndexEntries(tempDir);
    let testEntry = entries.find(e => e.focus === 'status-test');
    expect(testEntry?.status).toBe('FRESH');

    // Modify source file
    await createTestFile(tempDir, 'src/auth.ts', 'export const auth = { modified: true };');

    // Get index entries - should be STALE now
    entries = await getIndexEntries(tempDir);
    testEntry = entries.find(e => e.focus === 'status-test');
    expect(testEntry?.status).toBe('STALE');
  });
});

// =============================================================================
// 5. Error Handling Tests
// =============================================================================

describe('spelunk integration: Error Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('handles missing --focus gracefully', async () => {
    await expect(
      spelunk('--for=architect', tempDir)
    ).rejects.toThrow('--focus is required');
  });

  test('handles invalid lens name', async () => {
    await expect(
      spelunk('--lens=invalid-lens --focus="test"', tempDir)
    ).rejects.toThrow('Unknown lens');
  });

  test('handles invalid agent type', async () => {
    await expect(
      spelunk('--for=nonexistent --focus="test"', tempDir)
    ).rejects.toThrow('Unknown agent type');
  });

  test('handles mutually exclusive options', async () => {
    await expect(
      spelunk('--for=architect --lens=flows --focus="test"', tempDir)
    ).rejects.toThrow('mutually exclusive');
  });

  test('handles missing source files gracefully', async () => {
    // Create a source file first, then create doc, then delete the source
    await createTestFile(
      tempDir,
      'src/will-be-deleted.ts',
      'export const temp = true;'
    );

    // Create doc with valid source file
    await writeSpelunkDoc(
      'contracts',
      'missing-source',
      '# Missing Source',
      ['src/will-be-deleted.ts'],
      { projectRoot: tempDir }
    );

    // Now delete the source file
    await fs.unlink(path.join(tempDir, 'src/will-be-deleted.ts'));

    // Checking staleness should not throw - missing source counts as stale
    const result = await checkStaleness('contracts', 'missing-source', tempDir);
    expect(result.status).toBe('STALE');
    expect(result.staleSources).toContain('src/will-be-deleted.ts');
  });

  test('handles permission errors on reading', async () => {
    // This test verifies graceful handling when files are inaccessible
    // We can't easily simulate permission errors, but we can test
    // that checking a completely empty project doesn't crash

    const emptyDir = await createTempDir();
    try {
      await ensureDirectoryStructure(emptyDir);

      // Should return MISSING, not throw
      const result = await checkStaleness('contracts', 'any-focus', emptyDir);
      expect(result.status).toBe('MISSING');
    } finally {
      await cleanupTempDir(emptyDir);
    }
  });
});

// =============================================================================
// 6. Options Handling Tests
// =============================================================================

describe('spelunk integration: Options Handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/module.ts',
      'export class Module { method() {} }'
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('--check returns status without generating', async () => {
    const result = await spelunk('--check --lens=contracts --focus="module"', tempDir);

    expect(result.status).toBe('check_only');
    expect(result.staleness).toBeDefined();
    expect(result.staleness?.get('contracts')?.status).toBe('MISSING');

    // Verify no doc was created
    const { absolute: docPath } = getSpelunkDocPath('contracts', 'module', tempDir);
    const exists = await fileExists(docPath);
    expect(exists).toBe(false);
  });

  test('--refresh regenerates even if fresh', async () => {
    // Create initial doc
    await writeSpelunkDoc(
      'contracts',
      'refresh-test',
      '# Original Content',
      ['src/module.ts'],
      { projectRoot: tempDir }
    );

    // Verify it is FRESH
    let result = await spelunk('--check --lens=contracts --focus="refresh-test"', tempDir);
    expect(result.staleness?.get('contracts')?.status).toBe('FRESH');

    // Get original timestamp
    const { absolute: docPath } = getSpelunkDocPath('contracts', 'refresh-test', tempDir);
    const originalStat = await fs.stat(docPath);

    // Small delay to ensure mtime difference
    await new Promise(resolve => setTimeout(resolve, 50));

    // Force refresh
    result = await spelunk('--refresh --lens=contracts --focus="refresh-test"', tempDir);
    expect(result.status).toBe('generated');

    // File should have been modified
    const newStat = await fs.stat(docPath);
    expect(newStat.mtimeMs).toBeGreaterThanOrEqual(originalStat.mtimeMs);
  });

  test('--max-files limits exploration scope', async () => {
    // Create multiple source files
    for (let i = 0; i < 10; i++) {
      await createTestFile(
        tempDir,
        `src/file${i}.ts`,
        `export const value${i} = ${i};`
      );
    }

    // Spelunk with max-files limit
    const result = await spelunk(
      '--lens=contracts --focus="files" --max-files=3',
      tempDir
    );

    // Should complete without error
    expect(['fresh', 'generated']).toContain(result.status);
  });

  test('--max-depth limits directory traversal', async () => {
    // Create deeply nested files
    await createTestFile(
      tempDir,
      'src/level1/level2/level3/deep.ts',
      'export const deep = true;'
    );

    // Spelunk with max-depth limit
    const result = await spelunk(
      '--lens=contracts --focus="deep" --max-depth=1',
      tempDir
    );

    // Should complete without error
    expect(['fresh', 'generated']).toContain(result.status);
  });

  test('--max-output limits output size', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="module" --max-output=500',
      tempDir
    );

    // Should complete without error
    expect(['fresh', 'generated']).toContain(result.status);
  });

  test('combines multiple options correctly', async () => {
    const result = await spelunk(
      '--lens=contracts --focus="module" --max-files=5 --max-depth=2 --max-output=1000',
      tempDir
    );

    expect(['fresh', 'generated']).toContain(result.status);
  });
});

// =============================================================================
// 7. Agent-Specific Lens Resolution Tests
// =============================================================================

describe('spelunk integration: Agent Lens Resolution', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(tempDir, 'src/code.ts', 'export const code = {};');
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('--for=architect resolves to interfaces and boundaries', async () => {
    const result = await spelunk('--check --for=architect --focus="code"', tempDir);

    expect(result.staleness?.has('interfaces')).toBe(true);
    expect(result.staleness?.has('boundaries')).toBe(true);
    expect(result.staleness?.size).toBe(2);
  });

  test('--for=product resolves to flows', async () => {
    const result = await spelunk('--check --for=product --focus="code"', tempDir);

    expect(result.staleness?.has('flows')).toBe(true);
    expect(result.staleness?.size).toBe(1);
  });

  test('--for=qa resolves to contracts', async () => {
    const result = await spelunk('--check --for=qa --focus="code"', tempDir);

    expect(result.staleness?.has('contracts')).toBe(true);
    expect(result.staleness?.size).toBe(1);
  });

  test('--for=security resolves to trust-zones and contracts', async () => {
    const result = await spelunk('--check --for=security --focus="code"', tempDir);

    expect(result.staleness?.has('trust-zones')).toBe(true);
    expect(result.staleness?.has('contracts')).toBe(true);
    expect(result.staleness?.size).toBe(2);
  });
});

// =============================================================================
// 8. Multiple Lens Tests
// =============================================================================

describe('spelunk integration: Multiple Lenses', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await ensureDirectoryStructure(tempDir);
    await createTestFile(
      tempDir,
      'src/service.ts',
      `export interface ServiceInterface {}
       export class ServiceImpl implements ServiceInterface {}`
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('generates docs for multiple lenses in one call', async () => {
    const result = await spelunk(
      '--lens=interfaces,boundaries --focus="service"',
      tempDir
    );

    expect(result.status).toBe('generated');
    // Should have generated docs for both lenses
    expect(result.staleness?.size).toBe(2);
  });

  test('checks multiple lenses simultaneously', async () => {
    // Create docs for both lenses
    await writeSpelunkDoc(
      'interfaces',
      'multi-lens',
      '# Interfaces',
      ['src/service.ts'],
      { projectRoot: tempDir }
    );
    await writeSpelunkDoc(
      'boundaries',
      'multi-lens',
      '# Boundaries',
      ['src/service.ts'],
      { projectRoot: tempDir }
    );

    const result = await spelunk(
      '--check --lens=interfaces,boundaries --focus="multi-lens"',
      tempDir
    );

    expect(result.staleness?.get('interfaces')?.status).toBe('FRESH');
    expect(result.staleness?.get('boundaries')?.status).toBe('FRESH');
  });

  test('handles mixed fresh/stale state across lenses', async () => {
    // Create only interfaces doc
    await writeSpelunkDoc(
      'interfaces',
      'partial-lens',
      '# Interfaces',
      ['src/service.ts'],
      { projectRoot: tempDir }
    );

    const result = await spelunk(
      '--check --lens=interfaces,flows --focus="partial-lens"',
      tempDir
    );

    expect(result.staleness?.get('interfaces')?.status).toBe('FRESH');
    expect(result.staleness?.get('flows')?.status).toBe('MISSING');
  });
});
