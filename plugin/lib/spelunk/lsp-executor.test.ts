/**
 * Unit tests for LSP-Based Lens Execution
 *
 * NOTE: The old regex-based simulation functions have been removed.
 * executeLens now returns empty results and expects callers to use
 * the two-phase workflow (planSpelunk + processLspResults) for actual
 * LSP execution, or fall back to AST/grep strategies.
 *
 * These tests verify:
 * 1. The function returns correct structure with empty entries
 * 2. Files are correctly discovered based on focus
 * 3. Proper warnings are returned when LSP is not available
 * 4. Utility functions work correctly
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

    test('returns correct lens and focus', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('interfaces');
      expect(result.focus).toBe('auth');
    });

    test('returns lsp strategy', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.strategy).toBe('lsp');
    });

    test('returns empty entries (simulation removed)', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // After removing simulation functions, executeLens returns empty entries
      // Callers should use two-phase workflow for actual LSP execution
      expect(result.entries).toEqual([]);
    });

    test('truncated is false when entries are empty', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.truncated).toBe(false);
    });
  });

  describe('file discovery', () => {
    test('discovers files matching focus pattern', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // Files should be discovered even though entries are empty
      expect(result.filesExamined.length).toBeGreaterThan(0);
      expect(result.filesExamined.some((f) => f.includes('auth'))).toBe(true);
    });

    test('respects maxFiles option', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 1,
      });

      expect(result.filesExamined.length).toBeLessThanOrEqual(1);
    });
  });

  describe('all lens types work', () => {
    test('interfaces lens returns correct structure', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('interfaces');
      expect(result.strategy).toBe('lsp');
    });

    test('flows lens returns correct structure', async () => {
      const result = await executeLens('flows', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('flows');
      expect(result.strategy).toBe('lsp');
    });

    test('boundaries lens returns correct structure', async () => {
      const result = await executeLens('boundaries', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('boundaries');
      expect(result.strategy).toBe('lsp');
    });

    test('contracts lens returns correct structure', async () => {
      const result = await executeLens('contracts', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('contracts');
      expect(result.strategy).toBe('lsp');
    });

    test('trust-zones lens returns correct structure', async () => {
      const result = await executeLens('trust-zones', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      expect(result.lens).toBe('trust-zones');
      expect(result.strategy).toBe('lsp');
    });
  });

  describe('warnings', () => {
    test('includes warning about using two-phase workflow when LSP not enabled', async () => {
      const result = await executeLens('interfaces', 'auth', {
        projectRoot: tempDir,
        maxFiles: 10,
      });

      // LSP is typically not enabled in test environment
      if (!isLspAvailable()) {
        expect(result.warnings).toBeDefined();
        expect(result.warnings?.some((w) => w.includes('two-phase workflow'))).toBe(true);
      }
    });

    test('warns when no files found', async () => {
      const emptyDir = await createTempDir();
      await fs.mkdir(path.join(emptyDir, 'src'), { recursive: true });

      try {
        const result = await executeLens('interfaces', 'nonexistent-focus', {
          projectRoot: emptyDir,
          maxFiles: 10,
        });

        expect(result.warnings).toBeDefined();
        expect(result.warnings?.some((w) => w.includes('No files found'))).toBe(true);
      } finally {
        await cleanupTempDir(emptyDir);
      }
    });
  });

  describe('edge cases', () => {
    test('handles empty project directory', async () => {
      const emptyDir = await createTempDir();

      try {
        const result = await executeLens('interfaces', 'anything', {
          projectRoot: emptyDir,
          maxFiles: 10,
        });

        expect(result.entries.length).toBe(0);
        expect(result.filesExamined.length).toBe(0);
        expect(result.strategy).toBe('lsp');
      } finally {
        await cleanupTempDir(emptyDir);
      }
    });

    test('handles invalid lens name', async () => {
      await expect(
        executeLens('invalid-lens' as any, 'auth', { projectRoot: tempDir })
      ).rejects.toThrow();
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

  test('all results have lsp strategy', async () => {
    const results = await executeLenses(
      ['interfaces', 'flows', 'boundaries', 'contracts', 'trust-zones'],
      'auth',
      { projectRoot: tempDir, maxFiles: 20 }
    );

    expect(results.length).toBe(5);

    for (const result of results) {
      expect(result.strategy).toBe('lsp');
      expect(Array.isArray(result.entries)).toBe(true);
      expect(Array.isArray(result.filesExamined)).toBe(true);
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

describe('Integration: Structure compatibility', () => {
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

  test('result structure is compatible with report generator', async () => {
    const result = await executeLens('interfaces', 'auth', {
      projectRoot: tempDir,
      maxFiles: 20,
    });

    // Verify structure is compatible with report generator
    expect(result.lens).toBeDefined();
    expect(result.focus).toBeDefined();
    expect(result.filesExamined).toBeDefined();
    expect(result.entries).toBeDefined();
    expect(result.strategy).toBe('lsp');
    expect(result.truncated).toBe(false);
  });

  test('result can be used to determine fallback is needed', async () => {
    const result = await executeLens('interfaces', 'auth', {
      projectRoot: tempDir,
      maxFiles: 20,
    });

    // Empty entries indicate caller should use two-phase workflow or fallback
    if (result.entries.length === 0 && !isLspAvailable()) {
      // This is the expected behavior - caller should use alternative
      expect(result.warnings).toBeDefined();
    }
  });
});
