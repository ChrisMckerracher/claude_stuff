/**
 * Processor Tests
 *
 * Tests for the spelunk processor module that processes LSP results.
 * The processor takes raw LSP results from agent-executed tool calls
 * and filters/transforms them based on lens specifications.
 */

import {
  processLspResults,
  symbolKindToString,
  extractHoverContent,
  ProcessorOptions,
} from './processor';
import type {
  SpelunkPlan,
  SpelunkResults,
  LspSymbolInfo,
  LspLocation,
  LspHoverResult,
} from './types';

// =============================================================================
// Test Fixtures
// =============================================================================

/**
 * Create a mock SpelunkPlan
 */
function createMockPlan(
  lens: 'interfaces' | 'flows' | 'boundaries' | 'contracts' | 'trust-zones' = 'interfaces',
  focus: string = 'auth'
): SpelunkPlan {
  return {
    lens,
    focus,
    filesToExamine: ['/project/src/types.ts', '/project/src/auth/handler.ts'],
    toolCalls: [
      { operation: 'documentSymbol', uri: 'file:///project/src/types.ts' },
      { operation: 'documentSymbol', uri: 'file:///project/src/auth/handler.ts' },
    ],
  };
}

/**
 * Create mock LSP symbol results
 */
function createMockSymbolResults(): Record<string, LspSymbolInfo[]> {
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

/**
 * Create mock SpelunkResults
 */
function createMockResults(): SpelunkResults {
  return {
    documentSymbols: createMockSymbolResults(),
    references: {},
    hovers: {},
  };
}

// =============================================================================
// Tests: symbolKindToString
// =============================================================================

describe('symbolKindToString', () => {
  it('should convert known LSP symbol kinds to strings', () => {
    expect(symbolKindToString(1)).toBe('file');
    expect(symbolKindToString(2)).toBe('module');
    expect(symbolKindToString(3)).toBe('namespace');
    expect(symbolKindToString(4)).toBe('package');
    expect(symbolKindToString(5)).toBe('class');
    expect(symbolKindToString(6)).toBe('method');
    expect(symbolKindToString(7)).toBe('property');
    expect(symbolKindToString(8)).toBe('field');
    expect(symbolKindToString(9)).toBe('constructor');
    expect(symbolKindToString(10)).toBe('enum');
    expect(symbolKindToString(11)).toBe('interface');
    expect(symbolKindToString(12)).toBe('function');
    expect(symbolKindToString(13)).toBe('variable');
    expect(symbolKindToString(14)).toBe('constant');
  });

  it('should return "unknown" for unrecognized kinds', () => {
    expect(symbolKindToString(99)).toBe('unknown');
    expect(symbolKindToString(-1)).toBe('unknown');
    expect(symbolKindToString(0)).toBe('unknown');
  });

  it('should handle all LSP SymbolKind values up to 26', () => {
    // All values 1-26 should have mappings
    for (let i = 1; i <= 26; i++) {
      expect(symbolKindToString(i)).not.toBe('unknown');
    }
  });
});

// =============================================================================
// Tests: extractHoverContent
// =============================================================================

describe('extractHoverContent', () => {
  it('should return undefined for undefined input', () => {
    expect(extractHoverContent(undefined)).toBeUndefined();
  });

  it('should extract content from string contents', () => {
    const hover: LspHoverResult = {
      contents: 'interface User { id: string; }',
    };
    expect(extractHoverContent(hover)).toBe('interface User { id: string; }');
  });

  it('should extract content from MarkedString object', () => {
    const hover: LspHoverResult = {
      contents: {
        value: 'interface User { id: string; }',
        language: 'typescript',
      },
    };
    expect(extractHoverContent(hover)).toBe('interface User { id: string; }');
  });

  it('should join array of strings', () => {
    const hover: LspHoverResult = {
      contents: ['Line 1', 'Line 2', 'Line 3'],
    };
    expect(extractHoverContent(hover)).toBe('Line 1\nLine 2\nLine 3');
  });

  it('should handle mixed array of strings and MarkedStrings', () => {
    const hover: LspHoverResult = {
      contents: [
        'Plain text',
        { value: 'interface User {}' },
        'More text',
      ],
    };
    expect(extractHoverContent(hover)).toBe('Plain text\ninterface User {}\nMore text');
  });

  it('should handle empty string content', () => {
    const hover: LspHoverResult = {
      contents: '',
    };
    expect(extractHoverContent(hover)).toBe('');
  });

  it('should handle empty array content', () => {
    const hover: LspHoverResult = {
      contents: [],
    };
    expect(extractHoverContent(hover)).toBe('');
  });
});

// =============================================================================
// Tests: processLspResults - Basic Functionality
// =============================================================================

describe('processLspResults', () => {
  describe('basic functionality', () => {
    it('should return a SpelunkOutput with required fields', async () => {
      const plan = createMockPlan();
      const results = createMockResults();

      const output = await processLspResults(plan, results);

      expect(output).toBeDefined();
      expect(output.lens).toBe('interfaces');
      expect(output.focus).toBe('auth');
      expect(Array.isArray(output.entries)).toBe(true);
      expect(Array.isArray(output.filesExamined)).toBe(true);
    });

    it('should process documentSymbol results into entries', async () => {
      const plan = createMockPlan();
      const results = createMockResults();

      const output = await processLspResults(plan, results);

      expect(output.entries.length).toBeGreaterThan(0);
    });

    it('should convert URIs to file paths in entries', async () => {
      const plan = createMockPlan();
      const results = createMockResults();

      const output = await processLspResults(plan, results);

      for (const entry of output.entries) {
        expect(entry.filePath).not.toMatch(/^file:\/\//);
        expect(entry.filePath.startsWith('/')).toBe(true);
      }
    });

    it('should convert 0-indexed line numbers to 1-indexed', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/test.ts': [
            {
              name: 'TestInterface',
              kind: 11,
              location: {
                uri: 'file:///project/src/test.ts',
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 5, character: 0 },
                },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      // Line 0 in LSP should become line 1 in output
      expect(output.entries[0].line).toBe(1);
      expect(output.entries[0].endLine).toBe(6);
    });
  });

  describe('symbol kind filtering', () => {
    it('should filter symbols by lens symbolFilters for interfaces lens', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/mixed.ts': [
            {
              name: 'UserInterface',
              kind: 11, // Interface - should be included
              location: {
                uri: 'file:///project/src/mixed.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 3, character: 0 } },
              },
            },
            {
              name: 'myVariable',
              kind: 13, // Variable - should NOT be included for interfaces lens
              location: {
                uri: 'file:///project/src/mixed.ts',
                range: { start: { line: 5, character: 0 }, end: { line: 5, character: 20 } },
              },
            },
            {
              name: 'UserClass',
              kind: 5, // Class - should be included
              location: {
                uri: 'file:///project/src/mixed.ts',
                range: { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const names = output.entries.map((e) => e.name);
      expect(names).toContain('UserInterface');
      expect(names).toContain('UserClass');
      expect(names).not.toContain('myVariable');
    });

    it('should include proper kind string in entries', async () => {
      const plan = createMockPlan();
      const results = createMockResults();

      const output = await processLspResults(plan, results);

      const entry = output.entries.find((e) => e.name === 'User');
      expect(entry?.kind).toBe('interface');

      const classEntry = output.entries.find((e) => e.name === 'DefaultAuthHandler');
      expect(classEntry?.kind).toBe('class');
    });
  });

  describe('extract pattern filtering', () => {
    it('should filter symbols matching extractPatterns', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'AuthHandler', // Matches "Handler$" pattern
              kind: 11,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
              },
            },
            {
              name: 'UserService', // Matches "Service$" pattern
              kind: 5,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 10, character: 0 }, end: { line: 20, character: 0 } },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries.length).toBeGreaterThan(0);
      const names = output.entries.map((e) => e.name);
      expect(names).toContain('AuthHandler');
      expect(names).toContain('UserService');
    });

    it('should include PascalCase symbols (matches ^[A-Z] pattern)', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'UserModel', // PascalCase
              kind: 5,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries.length).toBe(1);
      expect(output.entries[0].name).toBe('UserModel');
    });
  });

  describe('ignore pattern filtering', () => {
    it('should filter out symbols matching ignorePatterns', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'PublicUser',
              kind: 11,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
              },
            },
            {
              name: '_privateHelper', // Matches "^_" ignore pattern
              kind: 12,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 10, character: 0 }, end: { line: 15, character: 0 } },
              },
            },
          ],
          'file:///project/src/test/handler.test.ts': [
            {
              name: 'TestHandler', // File matches ".test." ignore pattern
              kind: 5,
              location: {
                uri: 'file:///project/src/test/handler.test.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 10, character: 0 } },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const names = output.entries.map((e) => e.name);
      expect(names).toContain('PublicUser');
      expect(names).not.toContain('_privateHelper');
      expect(names).not.toContain('TestHandler');
    });

    it('should filter out node_modules paths', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/node_modules/some-lib/types.ts': [
            {
              name: 'ExternalType',
              kind: 11,
              location: {
                uri: 'file:///project/node_modules/some-lib/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries.length).toBe(0);
    });
  });

  describe('hover integration', () => {
    it('should include signature from hover results', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'User',
              kind: 11,
              location: {
                uri: 'file:///project/src/types.ts',
                range: {
                  start: { line: 5, character: 10 },
                  end: { line: 10, character: 1 },
                },
              },
            },
          ],
        },
        references: {},
        hovers: {
          'file:///project/src/types.ts:5:10': {
            contents: 'interface User { id: string; name: string; }',
          },
        },
      };

      const output = await processLspResults(plan, results);

      expect(output.entries[0].signature).toBe('interface User { id: string; name: string; }');
      expect(output.entries[0].description).toBe('interface User { id: string; name: string; }');
    });

    it('should handle missing hover results gracefully', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'NoHoverType',
              kind: 11,
              location: {
                uri: 'file:///project/src/types.ts',
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 5, character: 1 },
                },
              },
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries[0].signature).toBeUndefined();
    });
  });

  describe('references for flows/boundaries lenses', () => {
    it('should include references for flows lens', async () => {
      const plan = createMockPlan('flows');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/handler.ts': [
            {
              name: 'handleRequest',
              kind: 12, // function
              location: {
                uri: 'file:///project/src/handler.ts',
                range: {
                  start: { line: 10, character: 0 },
                  end: { line: 20, character: 1 },
                },
              },
            },
          ],
        },
        references: {
          'file:///project/src/handler.ts:handleRequest': [
            {
              uri: 'file:///project/src/app.ts',
              range: { start: { line: 5, character: 2 }, end: { line: 5, character: 15 } },
            },
            {
              uri: 'file:///project/src/router.ts',
              range: { start: { line: 10, character: 4 }, end: { line: 10, character: 17 } },
            },
          ],
        },
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const entry = output.entries.find((e) => e.name === 'handleRequest');
      expect(entry?.references).toBeDefined();
      expect(entry?.references?.length).toBe(2);
      expect(entry?.references?.[0]).toContain('/project/src/app.ts:6');
      expect(entry?.references?.[1]).toContain('/project/src/router.ts:11');
    });

    it('should include references for boundaries lens', async () => {
      const plan = createMockPlan('boundaries');
      // Use a symbol name that matches boundaries extractPatterns (e.g., contains 'services/')
      // and is in a path that matches (e.g., 'services/' directory)
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/services/module.ts': [
            {
              name: 'importServices', // Matches '^import' pattern (case insensitive)
              kind: 2, // module
              location: {
                uri: 'file:///project/src/services/module.ts',
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 50, character: 1 },
                },
              },
            },
          ],
        },
        references: {
          'file:///project/src/services/module.ts:importServices': [
            {
              uri: 'file:///project/src/app.ts',
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
            },
          ],
        },
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const entry = output.entries.find((e) => e.name === 'importServices');
      expect(entry?.references).toBeDefined();
      expect(entry?.references?.length).toBe(1);
    });

    it('should limit references to 20', async () => {
      const plan = createMockPlan('flows');
      const manyRefs: LspLocation[] = Array.from({ length: 30 }, (_, i) => ({
        uri: `file:///project/src/file${i}.ts`,
        range: { start: { line: i, character: 0 }, end: { line: i, character: 10 } },
      }));

      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/handler.ts': [
            {
              name: 'RequestHandler', // Matches 'Handler$' pattern for flows lens
              kind: 12,
              location: {
                uri: 'file:///project/src/handler.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
              },
            },
          ],
        },
        references: {
          'file:///project/src/handler.ts:RequestHandler': manyRefs,
        },
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const entry = output.entries.find((e) => e.name === 'RequestHandler');
      expect(entry?.references?.length).toBeLessThanOrEqual(20);
    });

    it('should NOT include references for interfaces lens', async () => {
      const plan = createMockPlan('interfaces');
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'UserInterface',
              kind: 11,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } },
              },
            },
          ],
        },
        references: {
          'file:///project/src/types.ts:UserInterface': [
            {
              uri: 'file:///project/src/app.ts',
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
            },
          ],
        },
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      const entry = output.entries.find((e) => e.name === 'UserInterface');
      expect(entry?.references).toBeUndefined();
    });
  });

  describe('maxOutput option', () => {
    it('should respect maxOutput limit', async () => {
      const plan = createMockPlan();
      const symbols: LspSymbolInfo[] = Array.from({ length: 100 }, (_, i) => ({
        name: `Symbol${i}`,
        kind: 11,
        location: {
          uri: 'file:///project/src/types.ts',
          range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
        },
      }));

      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': symbols,
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results, { maxOutput: 10 });

      expect(output.entries.length).toBeLessThanOrEqual(10);
    });

    it('should add warning when output is truncated', async () => {
      const plan = createMockPlan();
      const symbols: LspSymbolInfo[] = Array.from({ length: 100 }, (_, i) => ({
        name: `Symbol${i}`,
        kind: 11,
        location: {
          uri: 'file:///project/src/types.ts',
          range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
        },
      }));

      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': symbols,
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results, { maxOutput: 10 });

      expect(output.warnings).toBeDefined();
      expect(output.warnings?.some((w) => w.includes('truncated'))).toBe(true);
    });

    it('should default to 500 maxOutput', async () => {
      const plan = createMockPlan();
      const symbols: LspSymbolInfo[] = Array.from({ length: 600 }, (_, i) => ({
        name: `Symbol${i}`,
        kind: 11,
        location: {
          uri: 'file:///project/src/types.ts',
          range: { start: { line: i, character: 0 }, end: { line: i + 1, character: 0 } },
        },
      }));

      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': symbols,
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries.length).toBeLessThanOrEqual(500);
    });
  });

  describe('edge cases', () => {
    it('should handle empty documentSymbols', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {},
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries).toEqual([]);
      expect(output.warnings).toBeUndefined();
    });

    it('should handle empty symbol arrays', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/empty.ts': [],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      expect(output.entries).toEqual([]);
    });

    it('should include filesExamined from plan', async () => {
      const plan = createMockPlan();
      plan.filesToExamine = ['/a.ts', '/b.ts', '/c.ts'];

      const results = createMockResults();

      const output = await processLspResults(plan, results);

      expect(output.filesExamined).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    });

    it('should handle symbols with nested children', async () => {
      const plan = createMockPlan();
      const results: SpelunkResults = {
        documentSymbols: {
          'file:///project/src/types.ts': [
            {
              name: 'ParentClass',
              kind: 5,
              location: {
                uri: 'file:///project/src/types.ts',
                range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
              },
              children: [
                {
                  name: 'childMethod',
                  kind: 6,
                  location: {
                    uri: 'file:///project/src/types.ts',
                    range: { start: { line: 5, character: 2 }, end: { line: 10, character: 2 } },
                  },
                },
              ],
            },
          ],
        },
        references: {},
        hovers: {},
      };

      const output = await processLspResults(plan, results);

      // Should at least process the parent symbol
      expect(output.entries.find((e) => e.name === 'ParentClass')).toBeDefined();
    });
  });
});

// =============================================================================
// Tests: Lens-specific behavior
// =============================================================================

describe('lens-specific processing', () => {
  it('should process contracts lens with appropriate filters', async () => {
    const plan = createMockPlan('contracts');
    const results: SpelunkResults = {
      documentSymbols: {
        'file:///project/src/schemas.ts': [
          {
            name: 'UserSchema',
            kind: 13, // Variable (for zod schemas)
            location: {
              uri: 'file:///project/src/schemas.ts',
              range: { start: { line: 0, character: 0 }, end: { line: 5, character: 0 } },
            },
          },
          {
            name: 'ValidationError',
            kind: 5, // Class
            location: {
              uri: 'file:///project/src/schemas.ts',
              range: { start: { line: 10, character: 0 }, end: { line: 15, character: 0 } },
            },
          },
        ],
      },
      references: {},
      hovers: {},
    };

    const output = await processLspResults(plan, results);

    // Contracts lens should include both schemas and error types
    expect(output.lens).toBe('contracts');
    // ValidationError should be included (matches Error$ pattern)
    const names = output.entries.map((e) => e.name);
    expect(names).toContain('ValidationError');
  });

  it('should process trust-zones lens', async () => {
    const plan = createMockPlan('trust-zones');
    const results: SpelunkResults = {
      documentSymbols: {
        'file:///project/src/auth/middleware.ts': [
          {
            name: 'AuthMiddleware',
            kind: 5,
            location: {
              uri: 'file:///project/src/auth/middleware.ts',
              range: { start: { line: 0, character: 0 }, end: { line: 20, character: 0 } },
            },
          },
          {
            name: 'validateToken',
            kind: 12,
            location: {
              uri: 'file:///project/src/auth/middleware.ts',
              range: { start: { line: 25, character: 0 }, end: { line: 30, character: 0 } },
            },
          },
        ],
      },
      references: {},
      hovers: {},
    };

    const output = await processLspResults(plan, results);

    expect(output.lens).toBe('trust-zones');
    // Should include auth-related symbols
    const names = output.entries.map((e) => e.name);
    expect(names).toContain('AuthMiddleware');
    expect(names).toContain('validateToken');
  });
});
