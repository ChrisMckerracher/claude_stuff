/**
 * Verify Cycle Relevance Determination
 *
 * Uses semantic reasoning to determine if a verify cycle should run
 * based on the changed files. This module provides the logic that the
 * Code Review Agent uses to make relevance decisions.
 *
 * Key principle: "When unsure, run the cycle" (better to over-check)
 *
 * See: docs/plans/architect/verify-cycle-skill.md
 */

import { VerifyCycle } from './parser';

/**
 * Result of a relevance check
 */
export interface RelevanceDecision {
  /** Whether the cycle should run */
  shouldRun: boolean;
  /** Human-readable explanation of the decision */
  reason: string;
}

/**
 * Context for determining relevance
 */
export interface RelevanceContext {
  /** List of files changed in the current review */
  changedFiles: string[];
  /** The verify cycle to check */
  cycle: VerifyCycle;
}

/**
 * Keyword patterns that indicate file categories
 */
const FILE_PATTERNS = {
  documentation: [/readme/i, /\.md$/, /^docs\//i, /changelog/i, /license/i],
  homepage: [/index\.(tsx?|jsx?|html)$/i, /landing/i, /home/i, /^public\/index/i, /pages\/index/i],
  styles: [/\.css$/i, /\.scss$/i, /\.sass$/i, /\.less$/i, /style/i, /\.module\.css$/i],
  typescript: [/\.tsx?$/i, /\.jsx?$/i],
  javascript: [/\.jsx?$/i],
  auth: [/auth/i, /login/i, /logout/i, /session/i, /token/i, /credential/i],
  config: [/\.gitignore$/i, /\.env/i, /\.editorconfig$/i],
  build: [/package\.json$/i, /webpack/i, /vite/i, /tsconfig/i, /babel/i],
  components: [/components?\//i, /\.tsx$/i, /\.jsx$/i],
  utils: [/utils?\//i, /lib\//i, /helpers?\//i, /shared\//i],
};

/**
 * Keywords to look for in "When:" descriptions
 */
const WHEN_KEYWORDS = {
  homepage: ['homepage', 'landing', 'index', 'landing page', 'home page'],
  styles: ['css', 'style', 'styling', 'stylesheet', 'visual', 'layout'],
  typescript: ['typescript', 'ts', 'javascript', 'js'],
  auth: ['auth', 'login', 'logout', 'session', 'authentication', 'authorization'],
  build: ['build', 'package', 'dependencies', 'bundle'],
  ui: ['ui', 'component', 'interface', 'user interface'],
};

/**
 * Determine if a verify cycle should run based on changed files
 *
 * @param context - Changed files and cycle to evaluate
 * @returns Decision with shouldRun flag and explanation
 */
export function determineRelevance(context: RelevanceContext): RelevanceDecision {
  const { changedFiles, cycle } = context;

  // Edge case: no changed files
  if (changedFiles.length === 0) {
    return {
      shouldRun: false,
      reason: 'No files changed',
    };
  }

  const whenLower = cycle.when.toLowerCase();
  const fileCategories = categorizeFiles(changedFiles);

  // Check for clear matches
  const clearMatch = checkClearMatch(fileCategories, whenLower, changedFiles);
  if (clearMatch) {
    return clearMatch;
  }

  // Check for clear non-matches
  const clearNonMatch = checkClearNonMatch(fileCategories, whenLower, changedFiles);
  if (clearNonMatch) {
    return clearNonMatch;
  }

  // Ambiguous case: when unsure, run the cycle
  return {
    shouldRun: true,
    reason: 'May affect the checked functionality - running to be safe',
  };
}

/**
 * Categorize changed files into semantic groups
 */
function categorizeFiles(files: string[]): Set<string> {
  const categories = new Set<string>();

  for (const file of files) {
    const fileLower = file.toLowerCase();

    for (const [category, patterns] of Object.entries(FILE_PATTERNS)) {
      if (patterns.some(pattern => pattern.test(fileLower))) {
        categories.add(category);
      }
    }
  }

  return categories;
}

/**
 * Check for clear matches that should definitely run the cycle
 */
function checkClearMatch(
  fileCategories: Set<string>,
  whenLower: string,
  changedFiles: string[]
): RelevanceDecision | null {
  // Homepage cycle + homepage files
  if (hasKeyword(whenLower, WHEN_KEYWORDS.homepage)) {
    if (fileCategories.has('homepage')) {
      const indexFile = changedFiles.find(f =>
        /index\.(tsx?|jsx?|html)$/i.test(f) || /landing/i.test(f)
      );
      return {
        shouldRun: true,
        reason: `Changed homepage file: ${indexFile || 'landing page component'}`,
      };
    }
  }

  // Style cycle + style files
  if (hasKeyword(whenLower, WHEN_KEYWORDS.styles)) {
    if (fileCategories.has('styles')) {
      const styleFile = changedFiles.find(f => /\.(css|scss|sass|less)$/i.test(f) || /style/i.test(f));
      return {
        shouldRun: true,
        reason: `Changed style file: ${styleFile || 'CSS/style file'}`,
      };
    }
  }

  // TypeScript cycle + TS/JS files
  if (hasKeyword(whenLower, WHEN_KEYWORDS.typescript)) {
    if (fileCategories.has('typescript') || fileCategories.has('javascript')) {
      const tsFile = changedFiles.find(f => /\.(tsx?|jsx?)$/i.test(f));
      return {
        shouldRun: true,
        reason: `Changed TypeScript/JavaScript file: ${tsFile || 'source file'}`,
      };
    }
  }

  // Auth cycle + auth files
  if (hasKeyword(whenLower, WHEN_KEYWORDS.auth)) {
    if (fileCategories.has('auth')) {
      const authFile = changedFiles.find(f =>
        /auth|login|logout|session|token/i.test(f)
      );
      return {
        shouldRun: true,
        reason: `Changed auth-related file: ${authFile || 'authentication file'}`,
      };
    }
  }

  return null;
}

/**
 * Check for clear non-matches that should definitely skip the cycle
 */
function checkClearNonMatch(
  fileCategories: Set<string>,
  whenLower: string,
  changedFiles: string[]
): RelevanceDecision | null {
  // Documentation-only changes for non-docs cycles
  const onlyDocs = changedFiles.every(f =>
    FILE_PATTERNS.documentation.some(p => p.test(f.toLowerCase()))
  );

  if (onlyDocs && !whenLower.includes('documentation') && !whenLower.includes('docs')) {
    // Skip for cycles that aren't about documentation
    if (hasKeyword(whenLower, WHEN_KEYWORDS.homepage)) {
      return {
        shouldRun: false,
        reason: 'Only documentation changes - does not affect homepage',
      };
    }
    if (hasKeyword(whenLower, WHEN_KEYWORDS.styles)) {
      return {
        shouldRun: false,
        reason: 'Only documentation changes - does not affect styles',
      };
    }
    if (hasKeyword(whenLower, WHEN_KEYWORDS.auth)) {
      return {
        shouldRun: false,
        reason: 'Only documentation changes - does not affect authentication',
      };
    }
    // Generic documentation skip
    return {
      shouldRun: false,
      reason: 'Only documentation changes - does not affect checked functionality',
    };
  }

  // Config-only changes for UI/style cycles
  const onlyConfig = changedFiles.every(f =>
    FILE_PATTERNS.config.some(p => p.test(f.toLowerCase()))
  );

  if (onlyConfig) {
    if (hasKeyword(whenLower, WHEN_KEYWORDS.styles)) {
      return {
        shouldRun: false,
        reason: 'Only config file changes - does not affect styles',
      };
    }
    if (hasKeyword(whenLower, WHEN_KEYWORDS.homepage)) {
      return {
        shouldRun: false,
        reason: 'Only config file changes - does not affect homepage',
      };
    }
  }

  // CSS-only changes for TypeScript cycles
  const onlyStyles = changedFiles.every(f =>
    /\.(css|scss|sass|less)$/i.test(f)
  );

  if (onlyStyles && hasKeyword(whenLower, WHEN_KEYWORDS.typescript)) {
    return {
      shouldRun: false,
      reason: 'Only CSS changes - does not affect TypeScript compilation',
    };
  }

  // Unrelated component for auth cycles
  if (hasKeyword(whenLower, WHEN_KEYWORDS.auth)) {
    const hasAuthRelevant = changedFiles.some(f =>
      /auth|login|logout|session|token|credential/i.test(f)
    );
    if (!hasAuthRelevant && !fileCategories.has('utils') && !fileCategories.has('build')) {
      // Check if files are clearly unrelated (e.g., Footer.tsx, Header.tsx)
      const allUnrelatedComponents = changedFiles.every(f => {
        const filename = f.split('/').pop() || '';
        return /^(Footer|Header|Sidebar|Nav|Menu|Logo|Icon)\./i.test(filename);
      });
      if (allUnrelatedComponents) {
        return {
          shouldRun: false,
          reason: 'UI component changes unrelated to authentication',
        };
      }
    }
  }

  return null;
}

/**
 * Check if text contains any of the keywords
 */
function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}
