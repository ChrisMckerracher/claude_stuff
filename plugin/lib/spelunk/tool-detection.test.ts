/**
 * Tests for Tool Detection Module
 */

import {
  ToolAvailability,
  ExplorationStrategy,
  detectToolsSync,
  getStrategyForLanguage,
  getStrategyForFile,
  getToolSummary,
  shouldWarnAboutDegradedMode,
  getPreferredAstTool,
  LSP_SERVERS,
  EXTENSION_TO_LANGUAGE,
} from './tool-detection';

// Mock availability objects for testing
const fullAvailability: ToolAvailability = {
  lsp: {
    enabled: true,
    languages: {
      typescript: true,
      javascript: true,
      python: true,
      go: true,
      rust: true,
    },
  },
  ast: {
    astGrep: true,
    semgrep: true,
  },
};

const lspOnlyAvailability: ToolAvailability = {
  lsp: {
    enabled: true,
    languages: {
      typescript: true,
      javascript: true,
      python: true,
      go: true,
      rust: true,
    },
  },
  ast: {
    astGrep: false,
    semgrep: false,
  },
};

const astOnlyAvailability: ToolAvailability = {
  lsp: {
    enabled: false,
    languages: {},
  },
  ast: {
    astGrep: true,
    semgrep: false,
  },
};

const noToolsAvailability: ToolAvailability = {
  lsp: {
    enabled: false,
    languages: {},
  },
  ast: {
    astGrep: false,
    semgrep: false,
  },
};

describe('getStrategyForLanguage', () => {
  test('returns lsp when LSP is available for language', () => {
    expect(getStrategyForLanguage('typescript', fullAvailability)).toBe('lsp');
    expect(getStrategyForLanguage('python', fullAvailability)).toBe('lsp');
    expect(getStrategyForLanguage('go', fullAvailability)).toBe('lsp');
  });

  test('returns ast when LSP unavailable but AST tools present', () => {
    expect(getStrategyForLanguage('typescript', astOnlyAvailability)).toBe('ast');
    expect(getStrategyForLanguage('python', astOnlyAvailability)).toBe('ast');
  });

  test('returns grep when no tools available', () => {
    expect(getStrategyForLanguage('typescript', noToolsAvailability)).toBe('grep');
    expect(getStrategyForLanguage('python', noToolsAvailability)).toBe('grep');
  });

  test('handles unknown languages', () => {
    expect(getStrategyForLanguage('unknown', fullAvailability)).toBe('ast');
    expect(getStrategyForLanguage('unknown', noToolsAvailability)).toBe('grep');
  });

  test('normalizes language case', () => {
    expect(getStrategyForLanguage('TypeScript', fullAvailability)).toBe('lsp');
    expect(getStrategyForLanguage('PYTHON', fullAvailability)).toBe('lsp');
  });
});

describe('getStrategyForFile', () => {
  test('detects TypeScript files', () => {
    expect(getStrategyForFile('src/app.ts', fullAvailability)).toBe('lsp');
    expect(getStrategyForFile('src/component.tsx', fullAvailability)).toBe('lsp');
  });

  test('detects Python files', () => {
    expect(getStrategyForFile('main.py', fullAvailability)).toBe('lsp');
    expect(getStrategyForFile('types.pyi', fullAvailability)).toBe('lsp');
  });

  test('detects Go files', () => {
    expect(getStrategyForFile('main.go', fullAvailability)).toBe('lsp');
  });

  test('detects Rust files', () => {
    expect(getStrategyForFile('lib.rs', fullAvailability)).toBe('lsp');
  });

  test('falls back for unknown extensions', () => {
    expect(getStrategyForFile('config.yaml', fullAvailability)).toBe('ast');
    expect(getStrategyForFile('config.yaml', noToolsAvailability)).toBe('grep');
  });
});

describe('shouldWarnAboutDegradedMode', () => {
  test('warns when no tools available', () => {
    expect(shouldWarnAboutDegradedMode(noToolsAvailability)).toBe(true);
  });

  test('does not warn when LSP available', () => {
    expect(shouldWarnAboutDegradedMode(lspOnlyAvailability)).toBe(false);
  });

  test('does not warn when AST tools available', () => {
    expect(shouldWarnAboutDegradedMode(astOnlyAvailability)).toBe(false);
  });
});

describe('getPreferredAstTool', () => {
  test('prefers ast-grep over semgrep', () => {
    expect(getPreferredAstTool(fullAvailability)).toBe('ast-grep');
  });

  test('returns semgrep if ast-grep unavailable', () => {
    const semgrepOnly: ToolAvailability = {
      lsp: { enabled: false, languages: {} },
      ast: { astGrep: false, semgrep: true },
    };
    expect(getPreferredAstTool(semgrepOnly)).toBe('semgrep');
  });

  test('returns null if no AST tools', () => {
    expect(getPreferredAstTool(noToolsAvailability)).toBe(null);
  });
});

describe('getToolSummary', () => {
  test('generates summary with all tools available', () => {
    const summary = getToolSummary(fullAvailability);
    expect(summary).toContain('LSP: Enabled');
    expect(summary).toContain('ast-grep: Installed');
    expect(summary).toContain('semgrep: Installed');
    expect(summary).toContain('LSP-first exploration');
  });

  test('generates summary with no tools', () => {
    const summary = getToolSummary(noToolsAvailability);
    expect(summary).toContain('LSP: Disabled');
    expect(summary).toContain('ast-grep: Not found');
    expect(summary).toContain('semgrep: Not found');
    expect(summary).toContain('consider installing');
  });
});

describe('LSP_SERVERS', () => {
  test('has expected language mappings', () => {
    expect(LSP_SERVERS.typescript).toBe('vtsls');
    expect(LSP_SERVERS.python).toBe('pyright');
    expect(LSP_SERVERS.go).toBe('gopls');
    expect(LSP_SERVERS.rust).toBe('rust-analyzer');
  });
});

describe('EXTENSION_TO_LANGUAGE', () => {
  test('maps TypeScript extensions correctly', () => {
    expect(EXTENSION_TO_LANGUAGE['.ts']).toBe('typescript');
    expect(EXTENSION_TO_LANGUAGE['.tsx']).toBe('typescript');
  });

  test('maps JavaScript extensions correctly', () => {
    expect(EXTENSION_TO_LANGUAGE['.js']).toBe('javascript');
    expect(EXTENSION_TO_LANGUAGE['.jsx']).toBe('javascript');
    expect(EXTENSION_TO_LANGUAGE['.mjs']).toBe('javascript');
  });

  test('maps Python extensions correctly', () => {
    expect(EXTENSION_TO_LANGUAGE['.py']).toBe('python');
    expect(EXTENSION_TO_LANGUAGE['.pyi']).toBe('python');
  });
});

describe('detectToolsSync', () => {
  test('returns a valid ToolAvailability object', () => {
    const availability = detectToolsSync();

    // Check structure
    expect(availability).toHaveProperty('lsp');
    expect(availability).toHaveProperty('ast');
    expect(availability.lsp).toHaveProperty('enabled');
    expect(availability.lsp).toHaveProperty('languages');
    expect(availability.ast).toHaveProperty('astGrep');
    expect(availability.ast).toHaveProperty('semgrep');

    // Check types
    expect(typeof availability.lsp.enabled).toBe('boolean');
    expect(typeof availability.ast.astGrep).toBe('boolean');
    expect(typeof availability.ast.semgrep).toBe('boolean');
  });
});
