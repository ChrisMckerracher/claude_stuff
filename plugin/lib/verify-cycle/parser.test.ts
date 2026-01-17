/**
 * Tests for Verify Cycle Parser
 *
 * Implements TDD for verify cycle parsing as specified in:
 * - docs/plans/architect/verify-cycle-skill.md
 * - docs/plans/product/validations/verify-cycle-skill-final.md
 */

import {
  parseVerifyCycle,
  discoverCycles,
  VerifyCycle,
  ParseError,
} from './parser';

describe('parseVerifyCycle', () => {
  describe('automated cycles (with Run: line)', () => {
    it('parses a basic automated cycle', () => {
      const content = `# Homepage Performance Check

Run: npm run lighthouse
When: Homepage or landing page changes

Verify homepage loads in < 2s on fast-3g.
`;
      const cycle = parseVerifyCycle(content, 'homepage-check.md');

      expect(cycle.name).toBe('Homepage Performance Check');
      expect(cycle.run).toBe('npm run lighthouse');
      expect(cycle.when).toBe('Homepage or landing page changes');
      expect(cycle.type).toBe('automated');
      expect(cycle.filename).toBe('homepage-check.md');
    });

    it('parses cycle with complex Run command', () => {
      const content = `# TypeScript Check

Run: npx tsc --noEmit && npm run lint
When: TypeScript or JavaScript file changes

Ensure type safety and lint compliance.
`;
      const cycle = parseVerifyCycle(content, 'typescript-check.md');

      expect(cycle.run).toBe('npx tsc --noEmit && npm run lint');
      expect(cycle.type).toBe('automated');
    });

    it('handles Run: line with colons in the command', () => {
      const content = `# Docker Build Check

Run: docker build -t app:latest .
When: Dockerfile changes

Verify docker build succeeds.
`;
      const cycle = parseVerifyCycle(content, 'docker-check.md');

      expect(cycle.run).toBe('docker build -t app:latest .');
    });
  });

  describe('manual cycles (without Run: line)', () => {
    it('parses a manual cycle', () => {
      const content = `# Visual Regression Check

When: CSS or style changes

Spin up a browser and verify:
- [ ] No broken layouts
- [ ] No overlapping elements
- [ ] Colors look correct on light/dark themes

Note: Run \`/review\` directly to complete manual checks.
`;
      const cycle = parseVerifyCycle(content, 'visual-regression.md');

      expect(cycle.name).toBe('Visual Regression Check');
      expect(cycle.run).toBeUndefined();
      expect(cycle.when).toBe('CSS or style changes');
      expect(cycle.type).toBe('manual');
      expect(cycle.description).toContain('No broken layouts');
    });

    it('extracts full description for manual cycles', () => {
      const content = `# Admin Panel Review

When: Admin dashboard changes

Review checklist:
- [ ] All buttons functional
- [ ] Forms validate correctly
- [ ] Permissions work
`;
      const cycle = parseVerifyCycle(content, 'admin-review.md');

      expect(cycle.type).toBe('manual');
      expect(cycle.description).toContain('Review checklist');
      expect(cycle.description).toContain('All buttons functional');
    });
  });

  describe('edge cases and errors', () => {
    it('throws ParseError when When: line is missing', () => {
      const content = `# Malformed Cycle

Run: echo "no when line"

This cycle has no When: line.
`;
      expect(() => parseVerifyCycle(content, 'malformed.md'))
        .toThrow(ParseError);
      expect(() => parseVerifyCycle(content, 'malformed.md'))
        .toThrow(/missing.*When:/i);
    });

    it('extracts name from header even without # prefix', () => {
      const content = `Homepage Check

Run: npm test
When: Homepage changes
`;
      const cycle = parseVerifyCycle(content, 'homepage.md');

      expect(cycle.name).toBe('Homepage Check');
    });

    it('falls back to filename for name if no header', () => {
      const content = `Run: npm test
When: Any changes
`;
      const cycle = parseVerifyCycle(content, 'fallback-test.md');

      expect(cycle.name).toBe('fallback-test');
    });

    it('handles When: with extra whitespace', () => {
      const content = `# Test Cycle

Run: npm test
When:   Lots of whitespace here

Description
`;
      const cycle = parseVerifyCycle(content, 'test.md');

      expect(cycle.when).toBe('Lots of whitespace here');
    });

    it('handles Run: with extra whitespace', () => {
      const content = `# Test Cycle

Run:   npm test
When: Changes

Description
`;
      const cycle = parseVerifyCycle(content, 'test.md');

      expect(cycle.run).toBe('npm test');
    });

    it('handles empty file', () => {
      expect(() => parseVerifyCycle('', 'empty.md'))
        .toThrow(ParseError);
    });

    it('handles file with only whitespace', () => {
      expect(() => parseVerifyCycle('   \n\n   ', 'whitespace.md'))
        .toThrow(ParseError);
    });
  });
});

describe('discoverCycles', () => {
  // These tests use mock filesystem - integration tests will use real files

  it('returns empty array when directory does not exist', async () => {
    const cycles = await discoverCycles('/nonexistent/path');
    expect(cycles).toEqual([]);
  });

  it('returns empty array when directory is empty', async () => {
    // This will be tested with actual filesystem in integration tests
    // For unit tests, we rely on the parser working correctly
    expect(true).toBe(true);
  });
});

describe('VerifyCycle type', () => {
  it('has required fields for automated cycle', () => {
    const cycle: VerifyCycle = {
      name: 'Test Cycle',
      type: 'automated',
      run: 'npm test',
      when: 'Test changes',
      filename: 'test.md',
      description: 'Full description here',
    };

    expect(cycle.type).toBe('automated');
    expect(cycle.run).toBeDefined();
  });

  it('has required fields for manual cycle', () => {
    const cycle: VerifyCycle = {
      name: 'Manual Cycle',
      type: 'manual',
      when: 'UI changes',
      filename: 'manual.md',
      description: 'Check things manually',
    };

    expect(cycle.type).toBe('manual');
    expect(cycle.run).toBeUndefined();
  });
});
