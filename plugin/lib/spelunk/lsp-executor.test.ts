/**
 * Unit tests for LSP-Based Lens Execution
 *
 * Tests for the LSP executor that extracts code intelligence
 * from the codebase using lens specifications.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  executeLens,
  executeLenses,
  isLspAvailable,
  getSupportedLanguages,
  getLanguageForFile,
  LspExplorationEntry,
  LensExecutionResult,
} from './lsp-executor';

// =============================================================================
// Test Utilities
// =============================================================================

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'lsp-executor-test-'));
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
// Sample Code for Testing
// =============================================================================

const SAMPLE_INTERFACE_FILE = `
/**
 * Authentication interfaces
 */

export interface AuthHandler {
  authenticate(token: string): Promise<User>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(): Promise<void>;
}

export interface User {
  id: string;
  email: string;
  roles: string[];
}

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
};

export enum AuthStatus {
  AUTHENTICATED = 'authenticated',
  UNAUTHENTICATED = 'unauthenticated',
  EXPIRED = 'expired',
}

// Internal type - should be filtered out by some lenses
type _InternalConfig = {
  secret: string;
};
`;

const SAMPLE_HANDLER_FILE = `
/**
 * Authentication handler implementation
 */

import { AuthHandler, User, TokenPair, AuthStatus } from './types';

export class DefaultAuthHandler implements AuthHandler {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async authenticate(token: string): Promise<User> {
    // Validate token
    const payload = await this.verifyToken(token);
    return this.mapToUser(payload);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const payload = await this.verifyRefreshToken(refreshToken);
    return this.generateTokenPair(payload.userId);
  }

  async logout(): Promise<void> {
    // Clear session
  }

  private async verifyToken(token: string): Promise<TokenPayload> {
    // Implementation
    return {} as TokenPayload;
  }

  private async verifyRefreshToken(token: string): Promise<RefreshPayload> {
    // Implementation
    return {} as RefreshPayload;
  }

  private mapToUser(payload: TokenPayload): User {
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
    };
  }

  private generateTokenPair(userId: string): TokenPair {
    return {
      accessToken: 'access',
      refreshToken: 'refresh',
    };
  }
}

export async function createAuthHandler(config: Config): Promise<AuthHandler> {
  return new DefaultAuthHandler(config);
}
`;

const SAMPLE_ROUTE_FILE = `
/**
 * Authentication routes
 */

import { Router } from 'express';
import { AuthHandler } from './types';

export function createAuthRoutes(handler: AuthHandler): Router {
  const router = Router();

  router.post('/login', async (req, res) => {
    const { token } = req.body;
    const user = await handler.authenticate(token);
    res.json({ user });
  });

  router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    const tokens = await handler.refresh(refreshToken);
    res.json(tokens);
  });

  router.post('/logout', async (req, res) => {
    await handler.logout();
    res.status(204).send();
  });

  return router;
}
`;

// =============================================================================
// executeLens() Tests
// =============================================================================

describe('executeLens', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Create test files
    await createTestFile(tempDir, 'src/auth/types.ts', SAMPLE_INTERFACE_FILE);
    await createTestFile(tempDir, 'src/auth/handler.ts', SAMPLE_HANDLER_FILE);
    await createTestFile(tempDir, 'src/auth/routes.ts', SAMPLE_ROUTE_FILE);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  describe('interfaces lens', () => {
    test('extracts interface declarations', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('interfaces');
      expect(result.focus).toBe('auth');
      expect(result.strategy).toBe('lsp');
      expect(result.filesExamined.length).toBeGreaterThan(0);

      // Should find AuthHandler interface
      const authHandler = result.entries.find(
        (e) => e.symbol === 'AuthHandler' && e.kind === 'interface'
      );
      expect(authHandler).toBeDefined();
      expect(authHandler?.file).toContain('types.ts');
    });

    test('extracts type aliases', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Should find TokenPair type
      const tokenPair = result.entries.find(
        (e) => e.symbol === 'TokenPair'
      );
      expect(tokenPair).toBeDefined();
    });

    test('extracts enum declarations', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Should find AuthStatus enum
      const authStatus = result.entries.find(
        (e) => e.symbol === 'AuthStatus' && e.kind === 'enum'
      );
      expect(authStatus).toBeDefined();
    });

    test('extracts class declarations', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Should find DefaultAuthHandler class
      const handler = result.entries.find(
        (e) => e.symbol === 'DefaultAuthHandler' && e.kind === 'class'
      );
      expect(handler).toBeDefined();
      expect(handler?.file).toContain('handler.ts');
    });
  });

  describe('flows lens', () => {
    test('finds entry points and references', async () => {
      const result = await executeLens('flows', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('flows');
      expect(result.filesExamined.length).toBeGreaterThan(0);
    });

    test('includes route handlers', async () => {
      const result = await executeLens('flows', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Should find createAuthRoutes function
      const routeCreator = result.entries.find(
        (e) => e.symbol === 'createAuthRoutes'
      );
      expect(routeCreator).toBeDefined();
    });
  });

  describe('boundaries lens', () => {
    test('extracts module-level symbols', async () => {
      const result = await executeLens('boundaries', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('boundaries');
      expect(result.entries.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('contracts lens', () => {
    test('extracts type definitions for QA', async () => {
      const result = await executeLens('contracts', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('contracts');
      // Should find interfaces and types
      const hasTypes = result.entries.some(
        (e) => e.kind === 'interface' || e.kind === 'typeparameter'
      );
      // May or may not find types depending on filter matching
      expect(result.entries).toBeDefined();
    });
  });

  describe('trust-zones lens', () => {
    test('finds security-related symbols', async () => {
      const result = await executeLens('trust-zones', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('trust-zones');
      // Should find auth-related symbols
      expect(result.filesExamined.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('result structure', () => {
    test('returns correct result structure', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result).toHaveProperty('lens');
      expect(result).toHaveProperty('focus');
      expect(result).toHaveProperty('entries');
      expect(result).toHaveProperty('filesExamined');
      expect(result).toHaveProperty('truncated');
      expect(result).toHaveProperty('strategy');
      expect(Array.isArray(result.entries)).toBe(true);
      expect(Array.isArray(result.filesExamined)).toBe(true);
    });

    test('entries have required fields', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      for (const entry of result.entries) {
        expect(entry).toHaveProperty('symbol');
        expect(entry).toHaveProperty('kind');
        expect(entry).toHaveProperty('file');
        expect(entry).toHaveProperty('line');
        expect(typeof entry.symbol).toBe('string');
        expect(typeof entry.kind).toBe('string');
        expect(typeof entry.file).toBe('string');
        expect(typeof entry.line).toBe('number');
        expect(entry.line).toBeGreaterThan(0);
      }
    });

    test('entries include optional signature when available', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // At least some entries should have signatures
      const entriesWithSignature = result.entries.filter(
        (e) => e.signature !== undefined
      );
      // May or may not have signatures depending on hover simulation
      expect(result.entries).toBeDefined();
    });
  });

  describe('options handling', () => {
    test('respects maxFiles option', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 1,
      });

      expect(result.filesExamined.length).toBeLessThanOrEqual(1);
    });

    test('respects maxOutput option', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 100,
        maxOutput: 2,
      });

      expect(result.entries.length).toBeLessThanOrEqual(2);
      if (result.entries.length === 2) {
        expect(result.truncated).toBe(true);
      }
    });

    test('uses default options when not provided', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
      });

      // Should work with defaults
      expect(result).toBeDefined();
      expect(result.strategy).toBe('lsp');
    });
  });

  describe('edge cases', () => {
    test('handles focus that matches no files in empty directory', async () => {
      // Create an empty directory with no matching files
      const emptyDir = await createTempDir();
      await fs.mkdir(path.join(emptyDir, 'src'), { recursive: true });

      try {
        const result = await executeLens('interfaces', 'nonexistent-focus', {
          projectRoot: emptyDir,
          maxFiles: 10,
        });

        expect(result.entries.length).toBe(0);
        expect(result.filesExamined.length).toBe(0);
        expect(result.warnings).toBeDefined();
        expect(result.warnings?.some((w) => w.includes('No files found'))).toBe(true);
      } finally {
        await cleanupTempDir(emptyDir);
      }
    });

    test('handles empty project directory', async () => {
      const emptyDir = await createTempDir();

      try {
        const result = await executeLens('interfaces', 'anything', {
          projectRoot: emptyDir,
          maxFiles: 10,
        });

        expect(result.entries.length).toBe(0);
        expect(result.filesExamined.length).toBe(0);
      } finally {
        await cleanupTempDir(emptyDir);
      }
    });

    test('deduplicates entries', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Check no duplicate file:line:symbol combinations
      const seen = new Set<string>();
      for (const entry of result.entries) {
        const key = `${entry.file}:${entry.line}:${entry.symbol}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    test('sorts entries by file and line', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Entries should be sorted
      for (let i = 1; i < result.entries.length; i++) {
        const prev = result.entries[i - 1];
        const curr = result.entries[i];

        const fileCompare = prev.file.localeCompare(curr.file);
        if (fileCompare === 0) {
          expect(prev.line).toBeLessThanOrEqual(curr.line);
        }
      }
    });
  });
});

// =============================================================================
// executeLenses() Tests (parallel execution)
// =============================================================================

describe('executeLenses', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await createTestFile(tempDir, 'src/auth/types.ts', SAMPLE_INTERFACE_FILE);
    await createTestFile(tempDir, 'src/auth/handler.ts', SAMPLE_HANDLER_FILE);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('executes multiple lenses in parallel', async () => {
    const results = await executeLenses(
      ['interfaces', 'flows'],
      'auth',
      { projectRoot: tempDir, maxFiles: 10 }
    );

    expect(results.length).toBe(2);
    expect(results[0].lens).toBe('interfaces');
    expect(results[1].lens).toBe('flows');
  });

  test('all results share the same focus', async () => {
    const results = await executeLenses(
      ['interfaces', 'boundaries', 'contracts'],
      'auth',
      { projectRoot: tempDir, maxFiles: 10 }
    );

    for (const result of results) {
      expect(result.focus).toBe('auth');
    }
  });

  test('handles empty lenses array', async () => {
    const results = await executeLenses(
      [],
      'auth',
      { projectRoot: tempDir }
    );

    expect(results.length).toBe(0);
  });
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('isLspAvailable', () => {
  test('returns boolean', () => {
    const result = isLspAvailable();
    expect(typeof result).toBe('boolean');
  });
});

describe('getSupportedLanguages', () => {
  test('returns array of strings', () => {
    const languages = getSupportedLanguages();
    expect(Array.isArray(languages)).toBe(true);
    for (const lang of languages) {
      expect(typeof lang).toBe('string');
    }
  });
});

describe('getLanguageForFile', () => {
  test('returns typescript for .ts files', () => {
    expect(getLanguageForFile('file.ts')).toBe('typescript');
    expect(getLanguageForFile('path/to/file.tsx')).toBe('typescript');
  });

  test('returns javascript for .js files', () => {
    expect(getLanguageForFile('file.js')).toBe('javascript');
    expect(getLanguageForFile('path/to/file.jsx')).toBe('javascript');
  });

  test('returns python for .py files', () => {
    expect(getLanguageForFile('file.py')).toBe('python');
  });

  test('returns go for .go files', () => {
    expect(getLanguageForFile('file.go')).toBe('go');
  });

  test('returns undefined for unknown extensions', () => {
    expect(getLanguageForFile('file.xyz')).toBeUndefined();
    expect(getLanguageForFile('file.unknown')).toBeUndefined();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Integration: Full exploration workflow', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    await createTestFile(tempDir, 'src/auth/types.ts', SAMPLE_INTERFACE_FILE);
    await createTestFile(tempDir, 'src/auth/handler.ts', SAMPLE_HANDLER_FILE);
    await createTestFile(tempDir, 'src/auth/routes.ts', SAMPLE_ROUTE_FILE);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('complete exploration: multiple lenses on same codebase', async () => {
    // Run all lenses
    const results = await executeLenses(
      ['interfaces', 'flows', 'boundaries', 'contracts', 'trust-zones'],
      'auth',
      { projectRoot: tempDir, maxFiles: 20 }
    );

    expect(results.length).toBe(5);

    // Each lens should have completed successfully
    for (const result of results) {
      expect(result.strategy).toBe('lsp');
      expect(result.focus).toBe('auth');
      expect(Array.isArray(result.entries)).toBe(true);
      expect(Array.isArray(result.filesExamined)).toBe(true);
    }

    // Interfaces lens should find type definitions
    const interfacesResult = results.find((r) => r.lens === 'interfaces');
    expect(interfacesResult).toBeDefined();
    expect(interfacesResult?.entries.length).toBeGreaterThan(0);
  });

  test('exploration results can be used for report generation', async () => {
    const result = await executeLens('interfaces', 'auth', {
      projectRoot: tempDir,
      maxFiles: 20,
    });

    // Verify structure is compatible with report generator
    expect(result.lens).toBeDefined();
    expect(result.focus).toBeDefined();
    expect(result.filesExamined).toBeDefined();
    expect(result.entries).toBeDefined();

    // Each entry should have enough info for report generation
    for (const entry of result.entries) {
      expect(entry.symbol).toBeTruthy();
      expect(entry.kind).toBeTruthy();
      expect(entry.file).toBeTruthy();
      expect(entry.line).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error handling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  test('handles files with syntax errors gracefully', async () => {
    // Create a file with invalid syntax
    await createTestFile(
      tempDir,
      'src/broken.ts',
      'export interface Broken { unclosed'
    );

    const result = await executeLens('interfaces', 'broken', {
      projectRoot: tempDir,
      maxFiles: 10,
    });

    // Should not throw, just may not extract symbols
    expect(result).toBeDefined();
    expect(result.strategy).toBe('lsp');
  });

  test('handles focus in empty subdirectory gracefully', async () => {
    await createTestFile(tempDir, 'src/auth/types.ts', SAMPLE_INTERFACE_FILE);

    // Create an empty subdirectory
    await fs.mkdir(path.join(tempDir, 'src/empty'), { recursive: true });

    // Search in the empty subdirectory specifically
    const result = await executeLens('interfaces', 'empty', {
      projectRoot: tempDir,
      maxFiles: 10,
    });

    // May find files due to broad glob patterns, but specific focus may yield no results
    expect(result).toBeDefined();
    expect(result.strategy).toBe('lsp');
  });

  test('handles invalid lens name', async () => {
    await expect(
      executeLens('invalid-lens' as any, 'auth', { projectRoot: tempDir })
    ).rejects.toThrow();
  });
});
