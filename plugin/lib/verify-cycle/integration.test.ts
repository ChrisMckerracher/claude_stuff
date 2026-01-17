/**
 * Integration Tests for Verify Cycle System
 *
 * Tests the complete flow from discovery to relevance determination,
 * validating that the Code Review Agent can correctly:
 * 1. Discover cycles from .claude/verify-cycles/
 * 2. Parse Run: and When: lines
 * 3. Use semantic relevance to decide
 * 4. Handle automated vs manual cycles correctly
 *
 * See: docs/plans/architect/verify-cycle-skill.md
 */

import * as path from 'path';
import * as fs from 'fs';
import { discoverCycles, parseVerifyCycle, VerifyCycle } from './parser';
import { determineRelevance, RelevanceContext } from './relevance';

// Path to the actual verify-cycles directory
const VERIFY_CYCLES_DIR = path.resolve(__dirname, '../../../.claude/verify-cycles');

describe('Verify Cycle Integration', () => {
  describe('Cycle Discovery', () => {
    it('discovers cycles from .claude/verify-cycles/', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);

      // Should find at least our 3 example cycles
      expect(cycles.length).toBeGreaterThanOrEqual(3);

      const cycleNames = cycles.map(c => c.name);
      expect(cycleNames).toContain('Homepage Performance Check');
      expect(cycleNames).toContain('TypeScript Compilation Check');
      expect(cycleNames).toContain('Visual Regression Check');
    });

    it('correctly identifies automated vs manual cycles', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);

      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check');
      const typescriptCycle = cycles.find(c => c.name === 'TypeScript Compilation Check');
      const visualCycle = cycles.find(c => c.name === 'Visual Regression Check');

      expect(homepageCycle?.type).toBe('automated');
      expect(homepageCycle?.run).toBe('npm run lighthouse');

      expect(typescriptCycle?.type).toBe('automated');
      expect(typescriptCycle?.run).toBe('npx tsc --noEmit');

      expect(visualCycle?.type).toBe('manual');
      expect(visualCycle?.run).toBeUndefined();
    });

    it('parses When: descriptions correctly', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);

      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check');
      const visualCycle = cycles.find(c => c.name === 'Visual Regression Check');

      expect(homepageCycle?.when).toBe('Homepage or landing page changes');
      expect(visualCycle?.when).toBe('CSS or style changes');
    });

    it('skips malformed cycles with warning', async () => {
      // The malformed-test.md should be skipped
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);

      // Should not include malformed cycle
      const malformedCycle = cycles.find(c => c.filename === 'malformed-test.md');
      expect(malformedCycle).toBeUndefined();

      // Should have logged a warning
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('malformed')
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Test Scenario 1: Documentation-only change SKIPS homepage check', () => {
    it('skips homepage check for README.md change', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['README.md'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
      expect(decision.reason).toMatch(/documentation/i);
    });

    it('skips homepage check for docs/ changes', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['docs/api.md', 'docs/getting-started.md'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });
  });

  describe('Test Scenario 2: Homepage-related code change RUNS homepage check', () => {
    it('runs homepage check for src/pages/index.tsx', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/pages/index.tsx'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
      expect(decision.reason).toMatch(/homepage|index/i);
    });

    it('runs homepage check for landing page component', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/components/LandingHero.tsx'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });
  });

  describe('Test Scenario 3: Manual cycle shows note (not executes)', () => {
    it('identifies visual regression as manual cycle', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const visualCycle = cycles.find(c => c.name === 'Visual Regression Check')!;

      // Manual cycles have no Run: line
      expect(visualCycle.type).toBe('manual');
      expect(visualCycle.run).toBeUndefined();

      // But they still have a When: for relevance checking
      expect(visualCycle.when).toBe('CSS or style changes');

      // Description contains the checklist
      expect(visualCycle.description).toContain('No broken layouts');
    });

    it('manual cycle is marked relevant for CSS changes', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const visualCycle = cycles.find(c => c.name === 'Visual Regression Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/styles/main.css'],
        cycle: visualCycle,
      };

      const decision = determineRelevance(context);

      // Cycle is relevant (shouldRun=true), but type=manual means display note
      expect(decision.shouldRun).toBe(true);
      expect(visualCycle.type).toBe('manual');
    });
  });

  describe('Test Scenario 4: Ambiguous change runs cycle (when unsure, run)', () => {
    it('runs homepage check for shared utility file', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/utils/analytics.ts'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      // Analytics could affect homepage - when unsure, run
      expect(decision.shouldRun).toBe(true);
    });

    it('runs homepage check for package.json changes', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const homepageCycle = cycles.find(c => c.name === 'Homepage Performance Check')!;

      const context: RelevanceContext = {
        changedFiles: ['package.json'],
        cycle: homepageCycle,
      };

      const decision = determineRelevance(context);

      // Dependencies could affect bundle size - when unsure, run
      expect(decision.shouldRun).toBe(true);
    });
  });

  describe('TypeScript cycle behavior', () => {
    it('runs for .ts file changes', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const tsCycle = cycles.find(c => c.name === 'TypeScript Compilation Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/auth/login.ts'],
        cycle: tsCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(true);
    });

    it('skips for CSS-only changes', async () => {
      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const tsCycle = cycles.find(c => c.name === 'TypeScript Compilation Check')!;

      const context: RelevanceContext = {
        changedFiles: ['src/styles/main.css'],
        cycle: tsCycle,
      };

      const decision = determineRelevance(context);

      expect(decision.shouldRun).toBe(false);
    });
  });

  describe('Full Review Agent Simulation', () => {
    /**
     * Simulates what the Review Agent does:
     * 1. Get changed files
     * 2. Discover all cycles
     * 3. For each cycle, determine relevance
     * 4. Collect cycles to run (automated) and display (manual)
     */
    it('simulates review agent workflow for mixed changes', async () => {
      const changedFiles = [
        'src/pages/index.tsx',
        'src/components/Header.tsx',
        'src/styles/header.css',
      ];

      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);

      const cyclesToRun: VerifyCycle[] = [];
      const manualCycles: VerifyCycle[] = [];

      for (const cycle of cycles) {
        const decision = determineRelevance({
          changedFiles,
          cycle,
        });

        if (decision.shouldRun) {
          if (cycle.type === 'automated') {
            cyclesToRun.push(cycle);
          } else {
            manualCycles.push(cycle);
          }
        }
      }

      // Homepage cycle should run (changed index.tsx)
      expect(cyclesToRun.map(c => c.name)).toContain('Homepage Performance Check');

      // TypeScript cycle should run (changed .tsx files)
      expect(cyclesToRun.map(c => c.name)).toContain('TypeScript Compilation Check');

      // Visual regression manual cycle should be in manual list (changed .css)
      expect(manualCycles.map(c => c.name)).toContain('Visual Regression Check');
    });

    it('groups manual cycles for summary display', async () => {
      const changedFiles = [
        'src/components/Button.css',
        'src/components/Modal.css',
      ];

      const cycles = await discoverCycles(VERIFY_CYCLES_DIR);
      const manualCycles: VerifyCycle[] = [];

      for (const cycle of cycles) {
        const decision = determineRelevance({ changedFiles, cycle });
        if (decision.shouldRun && cycle.type === 'manual') {
          manualCycles.push(cycle);
        }
      }

      // At least visual regression should be in manual cycles
      expect(manualCycles.length).toBeGreaterThanOrEqual(1);

      // Format output as Code Review Agent would
      if (manualCycles.length > 0) {
        const output = [
          `Manual verification needed (${manualCycles.length} cycles):`,
          ...manualCycles.map(c => `- ${c.name}`),
          '',
          'Note: Run `/review` directly to complete manual checks.',
        ].join('\n');

        expect(output).toContain('Manual verification needed');
        expect(output).toContain('Visual Regression Check');
      }
    });
  });
});
