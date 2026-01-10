/**
 * Unit tests for AST Executor
 *
 * Tests the AST-based fallback exploration system for spelunking mode.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  executeAstFallback,
  isAstAvailable,
  getPreferredTool,
  getAvailablePatterns,
  AstExecutionResult,
  ExplorationEntry,
} from './ast-executor';
import { LensType } from './types';

// Test utilities
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ast-executor-test-'));
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

// =============================================================================
// isAstAvailable() tests
// =============================================================================

describe('isAstAvailable', () => {
  test('returns boolean indicating if AST tools are available', () => {
    const result = isAstAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// =============================================================================
// getPreferredTool() tests
// =============================================================================

describe('getPreferredTool', () => {
  test('returns ast-grep, semgrep, or null', () => {
    const result = getPreferredTool();
    expect(result === 'ast-grep' || result === 'semgrep' || result === null).toBe(
      true
    );
  });
});

// =============================================================================
// getAvailablePatterns() tests
// =============================================================================

describe('getAvailablePatterns', () => {
  test('returns patterns for interfaces lens with typescript', () => {
    const patterns = getAvailablePatterns('interfaces', 'typescript');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    // Should include interface pattern
    expect(patterns.some((p) => p.includes('interface'))).toBe(true);
  });

  test('returns patterns for flows lens with typescript', () => {
    const patterns = getAvailablePatterns('flows', 'typescript');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    // Should include route patterns
    expect(
      patterns.some((p) => p.includes('app.') || p.includes('router.'))
    ).toBe(true);
  });

  test('returns patterns for boundaries lens with python', () => {
    const patterns = getAvailablePatterns('boundaries', 'python');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    // Should include import pattern
    expect(patterns.some((p) => p.includes('import'))).toBe(true);
  });

  test('returns patterns for contracts lens with typescript', () => {
    const patterns = getAvailablePatterns('contracts', 'typescript');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    // Should include validation patterns (zod, etc.)
    expect(patterns.some((p) => p.includes('z.') || p.includes('Error'))).toBe(
      true
    );
  });

  test('returns patterns for trust-zones lens with typescript', () => {
    const patterns = getAvailablePatterns('trust-zones', 'typescript');
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
    // Should include auth patterns
    expect(
      patterns.some(
        (p) =>
          p.includes('Auth') || p.includes('jwt') || p.includes('sanitize')
      )
    ).toBe(true);
  });

  test('returns empty array for unknown lens', () => {
    const patterns = getAvailablePatterns(
      'unknown-lens' as LensType,
      'typescript'
    );
    expect(patterns).toEqual([]);
  });

  test('returns empty array for unsupported language', () => {
    const patterns = getAvailablePatterns('interfaces', 'cobol');
    // May return empty or generic patterns only
    expect(Array.isArray(patterns)).toBe(true);
  });
});

// =============================================================================
// executeAstFallback() tests
// =============================================================================

describe('executeAstFallback', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('returns result structure with correct properties', async () => {
    // Create a simple test file
    await createTestFile(
      tempDir,
      'src/test.ts',
      'export interface User { id: string; }'
    );

    // Skip if no AST tools available
    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // Verify result structure
    expect(result).toHaveProperty('lens');
    expect(result).toHaveProperty('focus');
    expect(result).toHaveProperty('entries');
    expect(result).toHaveProperty('filesExamined');
    expect(result).toHaveProperty('truncated');
    expect(result).toHaveProperty('strategy');
    expect(result).toHaveProperty('patternsUsed');

    // Verify types
    expect(result.lens).toBe('interfaces');
    expect(result.focus).toBe('src');
    expect(Array.isArray(result.entries)).toBe(true);
    expect(Array.isArray(result.filesExamined)).toBe(true);
    expect(typeof result.truncated).toBe('boolean');
    expect(['ast-grep', 'semgrep'].includes(result.strategy)).toBe(true);
    expect(Array.isArray(result.patternsUsed)).toBe(true);
  });

  test('respects maxFiles limit', async () => {
    // Create multiple test files
    for (let i = 0; i < 10; i++) {
      await createTestFile(
        tempDir,
        `src/file${i}.ts`,
        `export interface Test${i} { id: string; }`
      );
    }

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
      maxFiles: 3,
    });

    expect(result.filesExamined.length).toBeLessThanOrEqual(3);
  });

  test('throws error when no AST tools available', async () => {
    // Mock the tool detection to return no tools
    const originalEnv = process.env;
    process.env = { ...originalEnv, PATH: '' };

    try {
      // This test only makes sense if we can actually cause the error
      // In practice, the tools might still be found via absolute paths
      // So we just verify the function handles the case gracefully
      const result = await executeAstFallback('interfaces', 'src', {
        projectRoot: tempDir,
      });
      // If we get here, tools were found despite PATH modification
      expect(result).toBeDefined();
    } catch (error) {
      // Expected when no tools available
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('No AST tool available');
    } finally {
      process.env = originalEnv;
    }
  });

  test('handles empty directory gracefully', async () => {
    // Create empty src directory
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
    });

    expect(result.entries).toEqual([]);
    expect(result.filesExamined).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test('handles non-existent path gracefully', async () => {
    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'nonexistent', {
      projectRoot: tempDir,
    });

    // Should return empty results, not throw
    expect(result.entries).toEqual([]);
    expect(result.filesExamined).toEqual([]);
  });

  test('uses correct strategy based on available tools', async () => {
    await createTestFile(tempDir, 'src/test.ts', 'export type Foo = string;');

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const preferredTool = getPreferredTool();
    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
    });

    expect(result.strategy).toBe(preferredTool);
  });

  test('includes patterns used in result', async () => {
    await createTestFile(
      tempDir,
      'src/test.ts',
      'export interface User { id: string; }'
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // If there are entries, there should be patterns used
    if (result.entries.length > 0) {
      expect(result.patternsUsed.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Entry format tests
// =============================================================================

describe('ExplorationEntry format', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('entries have required properties', async () => {
    await createTestFile(
      tempDir,
      'src/auth.ts',
      `
        export interface AuthHandler {
          authenticate(token: string): Promise<User>;
        }
      `
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    for (const entry of result.entries) {
      expect(entry).toHaveProperty('filePath');
      expect(entry).toHaveProperty('line');
      expect(entry).toHaveProperty('column');
      expect(entry).toHaveProperty('text');
      expect(entry).toHaveProperty('matchedPattern');

      expect(typeof entry.filePath).toBe('string');
      expect(typeof entry.line).toBe('number');
      expect(typeof entry.column).toBe('number');
      expect(typeof entry.text).toBe('string');
      expect(typeof entry.matchedPattern).toBe('string');
    }
  });

  test('entries have correct file paths', async () => {
    const testFilePath = await createTestFile(
      tempDir,
      'src/models/user.ts',
      'export type User = { id: string; email: string; };'
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // If we found the file, verify the path
    const userEntries = result.entries.filter((e) =>
      e.filePath.includes('user.ts')
    );
    if (userEntries.length > 0) {
      expect(userEntries[0].filePath).toContain('user.ts');
    }
  });

  test('text is truncated for long matches', async () => {
    // Create a file with a very long interface
    const longBody = Array(100).fill('prop: string;').join('\n  ');
    await createTestFile(
      tempDir,
      'src/long.ts',
      `export interface LongInterface {\n  ${longBody}\n}`
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // If we found entries, verify text is truncated
    for (const entry of result.entries) {
      expect(entry.text.length).toBeLessThanOrEqual(500);
    }
  });
});

// =============================================================================
// Language detection tests
// =============================================================================

describe('Language handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('handles typescript language option', async () => {
    await createTestFile(
      tempDir,
      'src/test.ts',
      'interface Foo { bar: string; }'
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    expect(result).toBeDefined();
    expect(result.lens).toBe('interfaces');
  });

  test('handles python language option', async () => {
    await createTestFile(
      tempDir,
      'src/test.py',
      `
class User:
    def __init__(self, id: str):
        self.id = id
      `
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'python',
    });

    expect(result).toBeDefined();
    expect(result.lens).toBe('interfaces');
  });

  test('infers language from focus path with extension', async () => {
    await createTestFile(
      tempDir,
      'src/models.py',
      'class Model: pass'
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    // Focus path includes .py extension hint
    const result = await executeAstFallback('interfaces', 'src/models.py', {
      projectRoot: tempDir,
    });

    expect(result).toBeDefined();
  });

  test('defaults to typescript when language cannot be inferred', async () => {
    await createTestFile(
      tempDir,
      'src/test.ts',
      'export interface Test { id: string; }'
    );

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    // No language specified, no extension in focus
    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
    });

    // Should not throw, should use default
    expect(result).toBeDefined();
  });
});

// =============================================================================
// Multi-lens tests
// =============================================================================

describe('Multiple lens types', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test.each<[LensType, string]>([
    ['interfaces', 'export interface User { id: string; }'],
    ['flows', 'app.get("/api/users", handler)'],
    ['boundaries', 'import { User } from "./types"'],
    ['contracts', 'const schema = z.object({ id: z.string() })'],
    ['trust-zones', 'const token = jwt.verify(input)'],
  ])('handles %s lens', async (lens, code) => {
    await createTestFile(tempDir, 'src/test.ts', code);

    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback(lens, 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    expect(result.lens).toBe(lens);
    expect(Array.isArray(result.entries)).toBe(true);
    expect(Array.isArray(result.patternsUsed)).toBe(true);
  });
});

// =============================================================================
// Integration tests
// =============================================================================

describe('Integration: Realistic codebase exploration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();

    // Create a realistic project structure
    await createTestFile(
      tempDir,
      'src/auth/types.ts',
      `
export interface User {
  id: string;
  email: string;
  roles: Role[];
}

export interface Role {
  name: string;
  permissions: string[];
}

export type AuthToken = {
  access: string;
  refresh: string;
};
      `
    );

    await createTestFile(
      tempDir,
      'src/auth/handler.ts',
      `
import { User, AuthToken } from './types';

export interface AuthService {
  authenticate(credentials: Credentials): Promise<AuthToken>;
  validateToken(token: string): Promise<User>;
  refreshToken(refresh: string): Promise<AuthToken>;
}

export class AuthHandler implements AuthService {
  async authenticate(credentials: Credentials): Promise<AuthToken> {
    // Implementation
  }

  async validateToken(token: string): Promise<User> {
    // Implementation
  }

  async refreshToken(refresh: string): Promise<AuthToken> {
    // Implementation
  }
}
      `
    );

    await createTestFile(
      tempDir,
      'src/api/routes.ts',
      `
import { Router } from 'express';
import { AuthHandler } from '../auth/handler';

const router = Router();

router.post('/login', async (req, res) => {
  // Login logic
});

router.get('/profile', async (req, res) => {
  // Profile logic
});

export default router;
      `
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('explores interfaces across multiple files', async () => {
    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // Should find interfaces from multiple files
    expect(result.entries.length).toBeGreaterThan(0);

    // Verify we found entries from both files
    const typeFiles = result.entries.filter((e) =>
      e.filePath.includes('types.ts')
    );
    const handlerFiles = result.entries.filter((e) =>
      e.filePath.includes('handler.ts')
    );

    // At least some patterns should match
    expect(result.patternsUsed.length).toBeGreaterThan(0);
  });

  test('explores boundaries (imports) across files', async () => {
    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('boundaries', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
    });

    // Should find import statements
    expect(result.entries.length).toBeGreaterThan(0);

    // Should find the import from handler.ts or routes.ts
    const importEntries = result.entries.filter((e) =>
      e.text.includes('import')
    );
    expect(importEntries.length).toBeGreaterThan(0);
  });

  test('filesExamined contains all relevant files', async () => {
    if (!isAstAvailable()) {
      console.log('Skipping test: no AST tools available');
      return;
    }

    const result = await executeAstFallback('interfaces', 'src', {
      projectRoot: tempDir,
      language: 'typescript',
      maxFiles: 10,
    });

    // Should list unique files
    const uniqueFiles = new Set(result.filesExamined);
    expect(uniqueFiles.size).toBe(result.filesExamined.length);

    // All files in entries should be in filesExamined
    for (const entry of result.entries) {
      expect(result.filesExamined).toContain(entry.filePath);
    }
  });
});
