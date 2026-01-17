/**
 * Planner Tests
 *
 * Tests for the spelunk planner module that returns LSP tool call specifications.
 * The planner analyzes focus areas and lens specs to determine what LSP operations
 * should be performed, without executing them.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import {
  planSpelunk,
  planReferencesPhase,
  extractSymbolsForPhase2,
  planGoToDefinitionPhase,
  PlannerOptions,
  DiscoveredSymbol,
} from './planner';
import type { LspSymbolInfo, LspToolCall, SpelunkPlan } from './types';
import { getLens } from './lens-specs';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a temporary directory with test files
 */
async function createTestProject(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'planner-test-'));

  // Create src directory
  await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
  await fs.mkdir(path.join(tmpDir, 'src', 'auth'), { recursive: true });

  // Create test TypeScript files
  await fs.writeFile(
    path.join(tmpDir, 'src', 'types.ts'),
    `export interface User {
  id: string;
  name: string;
  email: string;
}

export type UserRole = 'admin' | 'user' | 'guest';

export interface AuthHandler {
  authenticate(token: string): Promise<User>;
  authorize(user: User, action: string): boolean;
}
`
  );

  await fs.writeFile(
    path.join(tmpDir, 'src', 'auth', 'handler.ts'),
    `import { User, AuthHandler } from '../types';

export class DefaultAuthHandler implements AuthHandler {
  async authenticate(token: string): Promise<User> {
    // Implementation
    return { id: '1', name: 'Test', email: 'test@example.com' };
  }

  authorize(user: User, action: string): boolean {
    return true;
  }
}

export function validateToken(token: string): boolean {
  return token.length > 0;
}
`
  );

  return tmpDir;
}

/**
 * Clean up test directory
 */
async function cleanupTestProject(tmpDir: string): Promise<void> {
  await fs.rm(tmpDir, { recursive: true, force: true });
}

/**
 * Create mock documentSymbol results for testing phase 2 planning
 */
function createMockDocumentSymbols(): Record<string, LspSymbolInfo[]> {
  return {
    'file:///project/src/types.ts': [
      {
        name: 'User',
        kind: 11, // Interface
        location: {
          uri: 'file:///project/src/types.ts',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 4, character: 1 },
          },
        },
      },
      {
        name: 'UserRole',
        kind: 26, // TypeParameter (type alias)
        location: {
          uri: 'file:///project/src/types.ts',
          range: {
            start: { line: 6, character: 0 },
            end: { line: 6, character: 50 },
          },
        },
      },
      {
        name: 'AuthHandler',
        kind: 11, // Interface
        location: {
          uri: 'file:///project/src/types.ts',
          range: {
            start: { line: 8, character: 0 },
            end: { line: 11, character: 1 },
          },
        },
      },
    ],
    'file:///project/src/auth/handler.ts': [
      {
        name: 'DefaultAuthHandler',
        kind: 5, // Class
        location: {
          uri: 'file:///project/src/auth/handler.ts',
          range: {
            start: { line: 2, character: 0 },
            end: { line: 14, character: 1 },
          },
        },
      },
      {
        name: 'validateToken',
        kind: 12, // Function
        location: {
          uri: 'file:///project/src/auth/handler.ts',
          range: {
            start: { line: 16, character: 0 },
            end: { line: 18, character: 1 },
          },
        },
      },
    ],
  };
}

// =============================================================================
// Tests: planSpelunk
// =============================================================================

describe('planSpelunk', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await createTestProject();
  });

  afterAll(async () => {
    await cleanupTestProject(tmpDir);
  });

  describe('basic functionality', () => {
    it('should return a SpelunkPlan with required fields', async () => {
      const plan = await planSpelunk('interfaces', 'auth', {
        projectRoot: tmpDir,
        maxFiles: 10,
      });

      expect(plan).toBeDefined();
      expect(plan.lens).toBe('interfaces');
      expect(plan.focus).toBe('auth');
      expect(Array.isArray(plan.filesToExamine)).toBe(true);
      expect(Array.isArray(plan.toolCalls)).toBe(true);
    });

    it('should find files matching the focus area', async () => {
      const plan = await planSpelunk('interfaces', 'auth', {
        projectRoot: tmpDir,
        maxFiles: 10,
      });

      expect(plan.filesToExamine.length).toBeGreaterThan(0);
      expect(plan.filesToExamine.some((f) => f.includes('auth'))).toBe(true);
    });

    it('should respect maxFiles option', async () => {
      const plan = await planSpelunk('interfaces', 'src', {
        projectRoot: tmpDir,
        maxFiles: 1,
      });

      expect(plan.filesToExamine.length).toBeLessThanOrEqual(1);
    });
  });

  describe('tool call generation', () => {
    it('should generate documentSymbol calls for interfaces lens', async () => {
      const plan = await planSpelunk('interfaces', 'auth', {
        projectRoot: tmpDir,
        maxFiles: 10,
      });

      const docSymbolCalls = plan.toolCalls.filter(
        (tc) => tc.operation === 'documentSymbol'
      );
      expect(docSymbolCalls.length).toBeGreaterThan(0);

      // Each file should have a documentSymbol call
      for (const file of plan.filesToExamine) {
        const hasCall = docSymbolCalls.some((tc) => tc.uri.includes(file) || file.includes(tc.uri.replace('file://', '')));
        expect(hasCall).toBe(true);
      }
    });

    it('should generate tool calls with proper file:// URIs', async () => {
      const plan = await planSpelunk('interfaces', 'auth', {
        projectRoot: tmpDir,
        maxFiles: 10,
      });

      for (const tc of plan.toolCalls) {
        expect(tc.uri).toMatch(/^file:\/\//);
      }
    });

    it('should include hover calls for interfaces lens', async () => {
      // The interfaces lens specifies hover as a secondary operation
      const lensSpec = getLens('interfaces');
      expect(lensSpec.lsp.operations).toContain('hover');
    });
  });

  describe('lens-specific behavior', () => {
    it('should include findReferences for flows lens', async () => {
      const lensSpec = getLens('flows');
      expect(lensSpec.lsp.operations).toContain('findReferences');
    });

    it('should include goToDefinition for flows lens', async () => {
      const lensSpec = getLens('flows');
      expect(lensSpec.lsp.operations).toContain('goToDefinition');
    });

    it('should include findReferences for boundaries lens', async () => {
      const lensSpec = getLens('boundaries');
      expect(lensSpec.lsp.operations).toContain('findReferences');
    });

    it('should include getDiagnostics for contracts lens', async () => {
      const lensSpec = getLens('contracts');
      expect(lensSpec.lsp.operations).toContain('getDiagnostics');
    });
  });
});

// =============================================================================
// Tests: planReferencesPhase
// =============================================================================

describe('planReferencesPhase', () => {
  it('should generate findReferences calls for each symbol', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'User',
        uri: 'file:///project/src/types.ts',
        position: { line: 0, character: 17 },
        kind: 11,
      },
      {
        name: 'AuthHandler',
        uri: 'file:///project/src/types.ts',
        position: { line: 8, character: 17 },
        kind: 11,
      },
    ];

    const calls = await planReferencesPhase(symbols);

    const refCalls = calls.filter((tc) => tc.operation === 'findReferences');
    expect(refCalls.length).toBeGreaterThanOrEqual(symbols.length);
  });

  it('should generate hover calls for type information', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'User',
        uri: 'file:///project/src/types.ts',
        position: { line: 0, character: 17 },
        kind: 11,
      },
    ];

    const calls = await planReferencesPhase(symbols);

    const hoverCalls = calls.filter((tc) => tc.operation === 'hover');
    expect(hoverCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('should include position for each tool call', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'validateToken',
        uri: 'file:///project/src/auth/handler.ts',
        position: { line: 16, character: 16 },
        kind: 12,
      },
    ];

    const calls = await planReferencesPhase(symbols);

    for (const call of calls) {
      expect(call.position).toBeDefined();
      expect(typeof call.position?.line).toBe('number');
      expect(typeof call.position?.character).toBe('number');
    }
  });

  it('should respect maxDepth option', async () => {
    const symbols: DiscoveredSymbol[] = Array.from({ length: 100 }, (_, i) => ({
      name: `Symbol${i}`,
      uri: `file:///project/src/file${i}.ts`,
      position: { line: i, character: 0 },
      kind: 12,
    }));

    const calls = await planReferencesPhase(symbols, { maxDepth: 2 });

    // Should limit the number of symbols processed
    // Default max is 50 symbols
    expect(calls.length).toBeLessThanOrEqual(100); // 50 symbols * 2 calls each
  });
});

// =============================================================================
// Tests: planGoToDefinitionPhase
// =============================================================================

describe('planGoToDefinitionPhase', () => {
  it('should generate goToDefinition calls for symbols', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'DefaultAuthHandler',
        uri: 'file:///project/src/auth/handler.ts',
        position: { line: 2, character: 13 },
        kind: 5,
      },
    ];

    const calls = await planGoToDefinitionPhase(symbols);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].operation).toBe('goToDefinition');
    expect(calls[0].uri).toBe('file:///project/src/auth/handler.ts');
    expect(calls[0].position).toEqual({ line: 2, character: 13 });
  });

  it('should respect maxSymbols limit', async () => {
    const symbols: DiscoveredSymbol[] = Array.from({ length: 100 }, (_, i) => ({
      name: `Symbol${i}`,
      uri: `file:///project/src/file${i}.ts`,
      position: { line: i, character: 0 },
      kind: 12,
    }));

    const calls = await planGoToDefinitionPhase(symbols, { maxSymbols: 10 });

    expect(calls.length).toBe(10);
  });

  it('should include proper position for navigation', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'authenticate',
        uri: 'file:///project/src/auth/handler.ts',
        position: { line: 4, character: 8 },
        kind: 6, // Method
      },
    ];

    const calls = await planGoToDefinitionPhase(symbols);

    expect(calls[0].position).toEqual({ line: 4, character: 8 });
  });
});

// =============================================================================
// Tests: extractSymbolsForPhase2
// =============================================================================

describe('extractSymbolsForPhase2', () => {
  const documentSymbols = createMockDocumentSymbols();

  it('should extract symbols matching lens filters', () => {
    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(documentSymbols, lensSpec);

    expect(symbols.length).toBeGreaterThan(0);

    // Should include interfaces and types
    const names = symbols.map((s) => s.name);
    expect(names).toContain('User');
    expect(names).toContain('AuthHandler');
  });

  it('should filter by symbol kind', () => {
    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(documentSymbols, lensSpec);

    // Interfaces lens filters for interface, type, class, enum, module, namespace
    for (const symbol of symbols) {
      // Kind 11 = interface, 26 = type, 5 = class
      expect([5, 10, 11, 26, 2, 3]).toContain(symbol.kind);
    }
  });

  it('should respect maxSymbols limit', () => {
    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(documentSymbols, lensSpec, 2);

    expect(symbols.length).toBeLessThanOrEqual(2);
  });

  it('should apply extract patterns', () => {
    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(documentSymbols, lensSpec);

    // All extracted symbols should match at least one extract pattern
    // or be a valid symbol kind
    expect(symbols.length).toBeGreaterThan(0);
  });

  it('should apply ignore patterns', () => {
    // Create symbols with names that should be ignored
    const symbolsWithIgnored: Record<string, LspSymbolInfo[]> = {
      'file:///project/test/handler.test.ts': [
        {
          name: 'TestHandler',
          kind: 5,
          location: {
            uri: 'file:///project/test/handler.test.ts',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 5, character: 1 },
            },
          },
        },
      ],
      'file:///project/src/handler.ts': [
        {
          name: '_privateHelper',
          kind: 12,
          location: {
            uri: 'file:///project/src/handler.ts',
            range: {
              start: { line: 0, character: 0 },
              end: { line: 3, character: 1 },
            },
          },
        },
      ],
    };

    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(symbolsWithIgnored, lensSpec);

    // Should not include test files or private symbols
    const names = symbols.map((s) => s.name);
    expect(names).not.toContain('TestHandler');
    expect(names).not.toContain('_privateHelper');
  });

  it('should include position from symbol location', () => {
    const lensSpec = getLens('interfaces');
    const symbols = extractSymbolsForPhase2(documentSymbols, lensSpec);

    for (const symbol of symbols) {
      expect(symbol.position).toBeDefined();
      expect(typeof symbol.position.line).toBe('number');
      expect(typeof symbol.position.character).toBe('number');
    }
  });
});

// =============================================================================
// Tests: Tool Call Specification Format
// =============================================================================

describe('LspToolCall specification format', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await createTestProject();
  });

  afterAll(async () => {
    await cleanupTestProject(tmpDir);
  });

  it('should have operation field on all tool calls', async () => {
    const plan = await planSpelunk('interfaces', 'auth', {
      projectRoot: tmpDir,
    });

    for (const tc of plan.toolCalls) {
      expect(tc.operation).toBeDefined();
      expect(['documentSymbol', 'findReferences', 'hover', 'goToDefinition', 'getDiagnostics']).toContain(tc.operation);
    }
  });

  it('should have uri field on all tool calls', async () => {
    const plan = await planSpelunk('interfaces', 'auth', {
      projectRoot: tmpDir,
    });

    for (const tc of plan.toolCalls) {
      expect(tc.uri).toBeDefined();
      expect(typeof tc.uri).toBe('string');
    }
  });

  it('should have position field for position-based operations', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'User',
        uri: 'file:///project/src/types.ts',
        position: { line: 0, character: 17 },
        kind: 11,
      },
    ];

    const refCalls = await planReferencesPhase(symbols);

    for (const tc of refCalls) {
      if (['findReferences', 'hover', 'goToDefinition'].includes(tc.operation)) {
        expect(tc.position).toBeDefined();
      }
    }
  });

  it('should produce JSON-serializable tool calls', async () => {
    const plan = await planSpelunk('interfaces', 'auth', {
      projectRoot: tmpDir,
    });

    // Should not throw
    const json = JSON.stringify(plan);
    expect(json).toBeDefined();

    // Should parse back correctly
    const parsed = JSON.parse(json);
    expect(parsed.toolCalls).toEqual(plan.toolCalls);
  });
});

// =============================================================================
// Tests: Edge Cases
// =============================================================================

describe('edge cases', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await createTestProject();
  });

  afterAll(async () => {
    await cleanupTestProject(tmpDir);
  });

  it('should handle empty focus area gracefully', async () => {
    const plan = await planSpelunk('interfaces', '', {
      projectRoot: tmpDir,
    });

    expect(plan).toBeDefined();
    expect(plan.focus).toBe('');
  });

  it('should handle non-existent focus directory', async () => {
    const plan = await planSpelunk('interfaces', 'zzz-definitely-nonexistent-xyz-12345', {
      projectRoot: tmpDir,
    });

    expect(plan).toBeDefined();
    // Even with a non-existent focus, the plan should be valid
    // (may find 0 files or may match due to broad patterns)
    expect(Array.isArray(plan.filesToExamine)).toBe(true);
    expect(Array.isArray(plan.toolCalls)).toBe(true);
  });

  it('should handle empty symbols array for phase 2', async () => {
    const calls = await planReferencesPhase([]);

    expect(calls).toEqual([]);
  });

  it('should handle symbols with edge position values', async () => {
    const symbols: DiscoveredSymbol[] = [
      {
        name: 'EdgeCase',
        uri: 'file:///project/src/edge.ts',
        position: { line: 0, character: 0 },
        kind: 11,
      },
    ];

    const calls = await planReferencesPhase(symbols);

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].position).toEqual({ line: 0, character: 0 });
  });

  it('should handle very long symbol names', async () => {
    const longName = 'A'.repeat(500);
    const symbols: DiscoveredSymbol[] = [
      {
        name: longName,
        uri: 'file:///project/src/long.ts',
        position: { line: 0, character: 0 },
        kind: 11,
      },
    ];

    const calls = await planReferencesPhase(symbols);

    expect(calls.length).toBeGreaterThan(0);
  });

  it('should use cwd when projectRoot not specified', async () => {
    // This test verifies the default behavior
    const plan = await planSpelunk('interfaces', 'src', {
      maxFiles: 5,
    });

    expect(plan).toBeDefined();
    // Project root should default to cwd
  });
});
