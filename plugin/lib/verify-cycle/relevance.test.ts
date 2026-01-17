/**
 * Tests for Verify Cycle Relevance Determination
 *
 * Test scenarios from the task requirements:
 * 1. Documentation-only change correctly SKIPS homepage check
 * 2. Homepage-related code change correctly RUNS homepage check
 * 3. Manual cycle correctly shows note (not executes command)
 * 4. Ambiguous change -> cycle runs (when unsure, run)
 *
 * See: docs/plans/architect/verify-cycle-skill.md
 */

import {
  determineRelevance,
  RelevanceDecision,
  RelevanceContext,
} from './relevance';
import { VerifyCycle } from './parser';

describe('determineRelevance', () => {
  // Helper to create a cycle for testing
  const createCycle = (overrides: Partial<VerifyCycle> = {}): VerifyCycle => ({
    name: 'Test Cycle',
    type: 'automated',
    run: 'npm test',
    when: 'Test changes',
    filename: 'test.md',
    description: 'Test description',
    ...overrides,
  });

  describe('Scenario 1: Documentation-only change SKIPS homepage check', () => {
    it('skips homepage cycle when only README.md changed', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
        run: 'npm run lighthouse',
      });

      const context: RelevanceContext = {
        changedFiles: ['README.md'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toMatch(/documentation|readme/i);
    });

    it('skips homepage cycle when only docs/ files changed', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['docs/api.md', 'docs/getting-started.md'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toMatch(/documentation/i);
    });
  });

  describe('Scenario 2: Homepage-related code change RUNS homepage check', () => {
    it('runs homepage cycle when src/pages/index.tsx changed', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
        run: 'npm run lighthouse',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/pages/index.tsx'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toMatch(/homepage|index/i);
    });

    it('runs homepage cycle when public/index.html changed', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['public/index.html'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('runs homepage cycle when landing page component changed', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/components/LandingHero.tsx'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toMatch(/landing/i);
    });
  });

  describe('Scenario 3: Manual cycle shows note (different handling)', () => {
    it('identifies manual cycle for display (not execution)', () => {
      const cycle = createCycle({
        name: 'Visual Regression Check',
        type: 'manual',
        run: undefined,
        when: 'CSS or style changes',
        description: 'Spin up a browser and verify...',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/styles/main.css'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true); // Relevant, but type is manual
      expect(cycle.type).toBe('manual'); // Code review agent handles display
    });

    it('marks relevant manual cycle for display', () => {
      const cycle = createCycle({
        name: 'Visual Regression Check',
        type: 'manual',
        run: undefined,
        when: 'CSS or style changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/components/Button.module.css'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toMatch(/style|css/i);
    });
  });

  describe('Scenario 4: Ambiguous change runs cycle (when unsure, run)', () => {
    it('runs cycle for shared utility that might affect homepage', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/utils/analytics.ts'],
        cycle,
      };

      const decision = determineRelevance(context);

      // Analytics could affect homepage performance - when unsure, run
      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toMatch(/unsure|may affect|could impact/i);
    });

    it('runs cycle for component that could be used on homepage', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/components/Button.tsx'],
        cycle,
      };

      const decision = determineRelevance(context);

      // Button component could be used on homepage - when unsure, run
      expect(decision.shouldRun).toBe(true);
    });

    it('runs cycle for package.json changes (build system)', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['package.json'],
        cycle,
      };

      const decision = determineRelevance(context);

      // Dependencies could affect homepage bundle - when unsure, run
      expect(decision.shouldRun).toBe(true);
    });
  });

  describe('TypeScript check cycle', () => {
    it('runs for TypeScript file changes', () => {
      const cycle = createCycle({
        name: 'TypeScript Check',
        when: 'TypeScript or JavaScript file changes',
        run: 'npx tsc --noEmit',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/auth/login.ts'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('runs for .tsx file changes', () => {
      const cycle = createCycle({
        name: 'TypeScript Check',
        when: 'TypeScript or JavaScript file changes',
        run: 'npx tsc --noEmit',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/components/App.tsx'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('skips for CSS-only changes', () => {
      const cycle = createCycle({
        name: 'TypeScript Check',
        when: 'TypeScript or JavaScript file changes',
        run: 'npx tsc --noEmit',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/styles/main.css'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });
  });

  describe('Auth smoke test cycle', () => {
    it('runs for auth-related file changes', () => {
      const cycle = createCycle({
        name: 'Auth Smoke Test',
        when: 'Auth-related changes, login, logout, or session handling',
        run: './scripts/test-auth.sh',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/auth/login.ts'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('runs for session handling changes', () => {
      const cycle = createCycle({
        name: 'Auth Smoke Test',
        when: 'Auth-related changes, login, logout, or session handling',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/lib/session.ts'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('skips for unrelated component changes', () => {
      const cycle = createCycle({
        name: 'Auth Smoke Test',
        when: 'Auth-related changes, login, logout, or session handling',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/components/Footer.tsx'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });
  });

  describe('Clear non-matches', () => {
    it('skips .gitignore for homepage cycle', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['.gitignore'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });

    it('skips .env changes for UI cycles', () => {
      const cycle = createCycle({
        name: 'Visual Regression Check',
        type: 'manual',
        run: undefined,
        when: 'CSS or style changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['.env.example'],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });

    it('skips test files for type check unless explicitly included', () => {
      const cycle = createCycle({
        name: 'TypeScript Check',
        when: 'TypeScript or JavaScript file changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['src/auth/login.test.ts'],
        cycle,
      };

      // Test files are still TypeScript - this should run
      const decision = determineRelevance(context);
      expect(decision.shouldRun).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('returns run=false for empty changed files list', () => {
      const cycle = createCycle({
        name: 'Any Cycle',
        when: 'Any changes',
      });

      const context: RelevanceContext = {
        changedFiles: [],
        cycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toMatch(/no.*files|empty/i);
    });

    it('handles mixed file types appropriately', () => {
      const cycle = createCycle({
        name: 'Homepage Performance Check',
        when: 'Homepage or landing page changes',
      });

      const context: RelevanceContext = {
        changedFiles: ['README.md', 'src/pages/index.tsx', 'docs/api.md'],
        cycle,
      };

      const decision = determineRelevance(context);

      // Should run because index.tsx is relevant
      expect(decision.shouldRun).toBe(true);
    });
  });
});

describe('RelevanceDecision', () => {
  it('has required fields', () => {
    const decision: RelevanceDecision = {
      shouldRun: true,
      reason: 'Changed files affect homepage',
    };

    expect(decision.shouldRun).toBe(true);
    expect(decision.reason).toBeDefined();
  });
});
