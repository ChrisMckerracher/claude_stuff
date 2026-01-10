/**
 * Tests for Spelunk Command Parser
 */

import {
  parseSpelunkArgs,
  resolveLenses,
  withDefaults,
  focusToSlug,
  SpelunkParseError,
  AGENT_TO_LENSES,
  VALID_LENSES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_OUTPUT,
  type SpelunkOptions,
  type AgentType,
  type LensName,
} from './parser';

describe('parseSpelunkArgs', () => {
  describe('--for flag', () => {
    it('parses --for=architect', () => {
      const result = parseSpelunkArgs('--for=architect --focus="auth layer"');
      expect(result.for).toBe('architect');
      expect(result.focus).toBe('auth layer');
    });

    it('parses --for=product', () => {
      const result = parseSpelunkArgs('--for=product --focus="user onboarding"');
      expect(result.for).toBe('product');
    });

    it('parses --for=qa', () => {
      const result = parseSpelunkArgs('--for=qa --focus="payment processing"');
      expect(result.for).toBe('qa');
    });

    it('parses --for=security', () => {
      const result = parseSpelunkArgs('--for=security --focus="API endpoints"');
      expect(result.for).toBe('security');
    });

    it('throws on unknown agent type', () => {
      expect(() => {
        parseSpelunkArgs('--for=unknown --focus="test"');
      }).toThrow(SpelunkParseError);
      expect(() => {
        parseSpelunkArgs('--for=unknown --focus="test"');
      }).toThrow(/Unknown agent type/);
    });

    it('is case-insensitive', () => {
      const result = parseSpelunkArgs('--for=ARCHITECT --focus="test"');
      expect(result.for).toBe('architect');
    });
  });

  describe('--lens flag', () => {
    it('parses single lens', () => {
      const result = parseSpelunkArgs('--lens=interfaces --focus="auth"');
      expect(result.lens).toEqual(['interfaces']);
    });

    it('parses multiple comma-separated lenses', () => {
      const result = parseSpelunkArgs('--lens=boundaries,contracts --focus="data layer"');
      expect(result.lens).toEqual(['boundaries', 'contracts']);
    });

    it('handles quoted comma-separated list with spaces', () => {
      // For lenses with spaces, use quotes
      const result = parseSpelunkArgs('--lens="flows, contracts" --focus="test"');
      expect(result.lens).toEqual(['flows', 'contracts']);
    });

    it('throws on unknown lens', () => {
      expect(() => {
        parseSpelunkArgs('--lens=unknown --focus="test"');
      }).toThrow(SpelunkParseError);
      expect(() => {
        parseSpelunkArgs('--lens=unknown --focus="test"');
      }).toThrow(/Unknown lens.*Valid lenses are/);
    });

    it('throws on empty lens value', () => {
      expect(() => {
        parseSpelunkArgs('--lens= --focus="test"');
      }).toThrow(/--lens requires at least one lens name/);
    });

    it('handles trust-zones lens with hyphen', () => {
      const result = parseSpelunkArgs('--lens=trust-zones --focus="api"');
      expect(result.lens).toEqual(['trust-zones']);
    });
  });

  describe('--for and --lens mutual exclusivity', () => {
    it('throws when both --for and --lens are specified', () => {
      expect(() => {
        parseSpelunkArgs('--for=architect --lens=flows --focus="test"');
      }).toThrow(SpelunkParseError);
      expect(() => {
        parseSpelunkArgs('--for=architect --lens=flows --focus="test"');
      }).toThrow(/mutually exclusive/);
    });
  });

  describe('--focus flag', () => {
    it('parses focus with double quotes', () => {
      const result = parseSpelunkArgs('--for=architect --focus="authentication layer"');
      expect(result.focus).toBe('authentication layer');
    });

    it('parses focus with single quotes', () => {
      const result = parseSpelunkArgs("--for=architect --focus='authentication layer'");
      expect(result.focus).toBe('authentication layer');
    });

    it('parses focus without quotes (no spaces)', () => {
      const result = parseSpelunkArgs('--for=architect --focus=authentication');
      expect(result.focus).toBe('authentication');
    });

    it('throws when focus is missing (non-check mode)', () => {
      expect(() => {
        parseSpelunkArgs('--for=architect');
      }).toThrow(SpelunkParseError);
      expect(() => {
        parseSpelunkArgs('--for=architect');
      }).toThrow(/--focus is required/);
    });

    it('allows missing focus in --check mode (lists all docs)', () => {
      const result = parseSpelunkArgs('--check');
      expect(result.focus).toBe('');
      expect(result.checkOnly).toBe(true);
    });
  });

  describe('--refresh flag', () => {
    it('parses --refresh flag', () => {
      const result = parseSpelunkArgs('--refresh --for=architect --focus="auth"');
      expect(result.refresh).toBe(true);
    });

    it('defaults to undefined when not specified', () => {
      const result = parseSpelunkArgs('--for=architect --focus="auth"');
      expect(result.refresh).toBeUndefined();
    });
  });

  describe('--check flag', () => {
    it('parses --check flag with focus', () => {
      const result = parseSpelunkArgs('--check --focus="auth"');
      expect(result.checkOnly).toBe(true);
      expect(result.focus).toBe('auth');
    });

    it('parses --check flag without focus', () => {
      const result = parseSpelunkArgs('--check');
      expect(result.checkOnly).toBe(true);
      expect(result.focus).toBe('');
    });
  });

  describe('depth limit flags', () => {
    it('parses --max-files', () => {
      const result = parseSpelunkArgs('--max-files=100 --focus="test"');
      expect(result.maxFiles).toBe(100);
    });

    it('parses --max-depth', () => {
      const result = parseSpelunkArgs('--max-depth=5 --focus="test"');
      expect(result.maxDepth).toBe(5);
    });

    it('parses --max-output', () => {
      const result = parseSpelunkArgs('--max-output=1000 --focus="test"');
      expect(result.maxOutput).toBe(1000);
    });

    it('parses all depth limits together', () => {
      const result = parseSpelunkArgs(
        '--max-files=50 --max-depth=3 --max-output=500 --focus="test"'
      );
      expect(result.maxFiles).toBe(50);
      expect(result.maxDepth).toBe(3);
      expect(result.maxOutput).toBe(500);
    });

    it('throws on negative values', () => {
      expect(() => {
        parseSpelunkArgs('--max-files=-1 --focus="test"');
      }).toThrow(/must be a positive number/);
    });

    it('throws on non-numeric values', () => {
      expect(() => {
        parseSpelunkArgs('--max-files=abc --focus="test"');
      }).toThrow(/must be a positive number/);
    });
  });

  describe('complex examples from spec', () => {
    it('parses agent-specific shorthand', () => {
      const result = parseSpelunkArgs('--for=architect --focus="authentication layer"');
      expect(result).toEqual({
        for: 'architect',
        focus: 'authentication layer',
      });
    });

    it('parses direct lens specification', () => {
      const result = parseSpelunkArgs('--lens=interfaces --focus="authentication"');
      expect(result).toEqual({
        lens: ['interfaces'],
        focus: 'authentication',
      });
    });

    it('parses multiple lenses', () => {
      const result = parseSpelunkArgs('--lens=boundaries,contracts --focus="data layer"');
      expect(result).toEqual({
        lens: ['boundaries', 'contracts'],
        focus: 'data layer',
      });
    });

    it('parses refresh flag', () => {
      const result = parseSpelunkArgs('--refresh --for=qa --focus="auth"');
      expect(result.refresh).toBe(true);
      expect(result.for).toBe('qa');
    });

    it('parses check flag with focus', () => {
      const result = parseSpelunkArgs('--check --focus="auth"');
      expect(result.checkOnly).toBe(true);
      expect(result.focus).toBe('auth');
    });

    it('parses all depth limits', () => {
      const result = parseSpelunkArgs(
        '--max-files=50 --max-depth=3 --max-output=500 --for=architect --focus="test"'
      );
      expect(result.maxFiles).toBe(50);
      expect(result.maxDepth).toBe(3);
      expect(result.maxOutput).toBe(500);
    });
  });
});

describe('resolveLenses', () => {
  it('returns --lens when specified', () => {
    const options: SpelunkOptions = {
      lens: ['interfaces', 'flows'],
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['interfaces', 'flows']);
  });

  it('returns architect lenses for --for=architect', () => {
    const options: SpelunkOptions = {
      for: 'architect',
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['interfaces', 'boundaries']);
  });

  it('returns product lenses for --for=product', () => {
    const options: SpelunkOptions = {
      for: 'product',
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['flows']);
  });

  it('returns qa lenses for --for=qa', () => {
    const options: SpelunkOptions = {
      for: 'qa',
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['contracts']);
  });

  it('returns security lenses for --for=security', () => {
    const options: SpelunkOptions = {
      for: 'security',
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['trust-zones', 'contracts']);
  });

  it('returns all lenses when neither --for nor --lens specified', () => {
    const options: SpelunkOptions = {
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(VALID_LENSES);
  });

  it('--lens takes precedence over --for (though they are mutually exclusive in parsing)', () => {
    // This tests the function in isolation
    const options: SpelunkOptions = {
      for: 'architect',
      lens: ['flows'],
      focus: 'test',
    };
    expect(resolveLenses(options)).toEqual(['flows']);
  });
});

describe('withDefaults', () => {
  it('applies default values', () => {
    const options: SpelunkOptions = {
      focus: 'test',
    };
    const withDef = withDefaults(options);
    expect(withDef.maxFiles).toBe(DEFAULT_MAX_FILES);
    expect(withDef.maxDepth).toBe(DEFAULT_MAX_DEPTH);
    expect(withDef.maxOutput).toBe(DEFAULT_MAX_OUTPUT);
    expect(withDef.refresh).toBe(false);
    expect(withDef.checkOnly).toBe(false);
  });

  it('preserves specified values', () => {
    const options: SpelunkOptions = {
      focus: 'test',
      maxFiles: 100,
      maxDepth: 5,
      maxOutput: 1000,
      refresh: true,
      checkOnly: true,
    };
    const withDef = withDefaults(options);
    expect(withDef.maxFiles).toBe(100);
    expect(withDef.maxDepth).toBe(5);
    expect(withDef.maxOutput).toBe(1000);
    expect(withDef.refresh).toBe(true);
    expect(withDef.checkOnly).toBe(true);
  });
});

describe('focusToSlug', () => {
  it('converts spaces to hyphens', () => {
    expect(focusToSlug('authentication layer')).toBe('authentication-layer');
  });

  it('converts to lowercase', () => {
    expect(focusToSlug('Authentication Layer')).toBe('authentication-layer');
  });

  it('removes special characters', () => {
    expect(focusToSlug('API endpoints!')).toBe('api-endpoints');
  });

  it('collapses multiple hyphens', () => {
    expect(focusToSlug('user   onboarding  flow')).toBe('user-onboarding-flow');
  });

  it('removes leading and trailing hyphens', () => {
    expect(focusToSlug(' authentication ')).toBe('authentication');
    expect(focusToSlug('--auth--')).toBe('auth');
  });

  it('handles special chars at start/end', () => {
    expect(focusToSlug('!payment service!')).toBe('payment-service');
  });

  it('returns unnamed for empty string', () => {
    expect(focusToSlug('')).toBe('unnamed');
    expect(focusToSlug('!!!')).toBe('unnamed');
  });

  it('truncates long strings with hash suffix', () => {
    const longFocus = 'checkout process including cart validation and payment processing and order confirmation';
    const slug = focusToSlug(longFocus);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).toMatch(/-[a-f0-9]{4}$/); // Ends with hash suffix
  });

  it('does not truncate strings under 50 chars', () => {
    const focus = 'authentication-layer';
    expect(focusToSlug(focus)).toBe('authentication-layer');
    expect(focusToSlug(focus).length).toBeLessThanOrEqual(50);
  });
});

describe('AGENT_TO_LENSES mapping', () => {
  it('has correct mapping for architect', () => {
    expect(AGENT_TO_LENSES.architect).toEqual(['interfaces', 'boundaries']);
  });

  it('has correct mapping for product', () => {
    expect(AGENT_TO_LENSES.product).toEqual(['flows']);
  });

  it('has correct mapping for qa', () => {
    expect(AGENT_TO_LENSES.qa).toEqual(['contracts']);
  });

  it('has correct mapping for security', () => {
    expect(AGENT_TO_LENSES.security).toEqual(['trust-zones', 'contracts']);
  });
});

describe('VALID_LENSES', () => {
  it('contains all expected lenses', () => {
    expect(VALID_LENSES).toContain('interfaces');
    expect(VALID_LENSES).toContain('flows');
    expect(VALID_LENSES).toContain('boundaries');
    expect(VALID_LENSES).toContain('contracts');
    expect(VALID_LENSES).toContain('trust-zones');
    expect(VALID_LENSES).toHaveLength(5);
  });
});

describe('edge cases', () => {
  it('handles empty args with --check', () => {
    const result = parseSpelunkArgs('--check');
    expect(result.checkOnly).toBe(true);
    expect(result.focus).toBe('');
  });

  it('handles extra whitespace', () => {
    const result = parseSpelunkArgs('  --for=architect   --focus="auth"  ');
    expect(result.for).toBe('architect');
    expect(result.focus).toBe('auth');
  });

  it('handles flags in any order', () => {
    const result = parseSpelunkArgs('--focus="auth" --max-files=10 --for=qa --refresh');
    expect(result.for).toBe('qa');
    expect(result.focus).toBe('auth');
    expect(result.maxFiles).toBe(10);
    expect(result.refresh).toBe(true);
  });
});
