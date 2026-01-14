# Spelunker LSP Integration Improvements

**Status:** DRAFT - Tool Call Delegation Approach
**Author:** Architecture Agent
**Date:** 2026-01-13
**Related:** docs/plans/architect/coding-agent-spelunking-mode.md
**Validation:** VALIDATED by Architecture Agent (2026-01-13)

## Executive Summary

The current spelunker implementation has a critical architectural gap: it claims to use LSP for efficient code intelligence, but actually uses regex-based text search simulations.

**The fix:** Have the TypeScript code **return tool call specifications** that the AI agent executes directly using its native LSP tool access. No MCP servers, no tree-sitter dependencies—the agent does what it's already good at.

## Current State Analysis

### The Problem

`plugin/lib/spelunk/lsp-executor.ts` contains "simulate" functions using regex:

```typescript
// Lines 450-608: Simulated LSP operations
async function simulateDocumentSymbol(filePath: string): Promise<LspSymbolInfo[]> {
  const patterns = [
    { regex: /^(?:export\s+)?interface\s+(\w+)/m, kind: 11, nameGroup: 1 },
    // ... more regex
  ];
  // Reads entire file, regex matching
}
```

**Issues:**
1. Inefficient - reads entire files, regex-based
2. Inaccurate - can't parse nested structures, generics
3. Misleading - reports `strategy: 'lsp'` when using regex

### Why This Happened

The original design tried to call LSP from TypeScript:

```
TypeScript process ──x─► LSP Tool (only available to AI agent)
                     └─► Falls back to regex simulations
```

## The Solution: Tool Call Delegation

Instead of calling LSP from TypeScript, the code returns **instructions for the agent to call LSP**:

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Agent (has LSP tool access)                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. Call TypeScript spelunk planner                     │   │
│  │  2. Receive tool call specifications                     │   │
│  │  3. Execute LSP tool calls                               │   │
│  │  4. Pass results back to TypeScript processor            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  TypeScript Layer (orchestrates, doesn't execute LSP)           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  planner.ts - Returns WHAT to explore                    │   │
│  │  processor.ts - Processes LSP results                    │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

### New Architecture

```typescript
/**
 * Tool call specification returned by the planner
 */
export interface LspToolCall {
  /** The LSP operation to perform */
  operation: 'documentSymbol' | 'findReferences' | 'hover' | 'goToDefinition';
  /** File URI for the operation */
  uri: string;
  /** Position (for hover, goToDefinition) */
  position?: { line: number; character: number };
}

/**
 * Result from the planner - what files to examine and which LSP calls to make
 */
export interface SpelunkPlan {
  /** Files to examine via LSP */
  filesToExamine: string[];
  /** LSP tool calls the agent should perform */
  toolCalls: LspToolCall[];
  /** Lens being applied */
  lens: LensType;
  /** Focus area */
  focus: string;
}

/**
 * Input for the processor - LSP results returned by the agent
 */
export interface SpelunkResults {
  /** documentSymbol results, keyed by file URI */
  documentSymbols: Record<string, LspSymbolInfo[]>;
  /** findReferences results */
  references: Record<string, LspLocation[]>;
  /** hover results */
  hovers: Record<string, LspHoverResult>;
}

/**
 * Final processed output
 */
export interface SpelunkOutput {
  lens: LensType;
  focus: string;
  entries: ExplorationEntry[];
  filesExamined: string[];
  warnings?: string[];
}
```

### Phase 1: The Planner

```typescript
// plugin/lib/spelunk/planner.ts

import { glob } from 'glob';
import { LensType, getLens } from './lens-specs';

/**
 * Plan a spelunk operation - returns WHAT to explore, not the results
 *
 * This function doesn't do any LSP calls. It returns a specification
 * of what LSP calls the AI agent should perform.
 */
export async function planSpelunk(
  lens: LensType,
  focus: string,
  options: { maxFiles?: number; projectRoot?: string } = {}
): Promise<SpelunkPlan> {
  const lensSpec = getLens(lens);
  const projectRoot = options.projectRoot ?? process.cwd();
  const maxFiles = options.maxFiles ?? 50;

  // Find files to examine
  const files = await findFilesForFocus(focus, lensSpec, projectRoot, maxFiles);

  // Build tool call specifications
  const toolCalls: LspToolCall[] = [];

  for (const file of files) {
    const uri = fileToUri(file);

    // Add documentSymbol call for each file
    if (lensSpec.lsp.operations.includes('documentSymbol')) {
      toolCalls.push({
        operation: 'documentSymbol',
        uri,
      });
    }
  }

  // For findReferences, we need entry points first
  // This is a two-phase operation:
  // 1. Get symbols via documentSymbol
  // 2. Return a second plan for findReferences on those symbols

  return {
    filesToExamine: files,
    toolCalls,
    lens,
    focus,
  };
}

/**
 * Plan phase 2: findReferences for discovered symbols
 */
export async function planReferencesPhase(
  symbols: Array<{ name: string; uri: string; position: { line: number; character: number } }>,
  options: { maxDepth?: number } = {}
): Promise<LspToolCall[]> {
  const toolCalls: LspToolCall[] = [];
  const maxDepth = options.maxDepth ?? 3;

  for (const symbol of symbols.slice(0, 50)) { // Limit to 50 symbols
    toolCalls.push({
      operation: 'findReferences',
      uri: symbol.uri,
      position: symbol.position,
    });
  }

  return toolCalls;
}
```

### Phase 2: The Processor

```typescript
// plugin/lib/spelunk/processor.ts

import { LensType, getLens } from './lens-specs';

/**
 * Process LSP results returned by the agent
 *
 * Takes the raw LSP results and applies lens filtering to extract
 * only the relevant information for the requesting agent.
 */
export async function processLspResults(
  plan: SpelunkPlan,
  results: SpelunkResults,
  options: { maxOutput?: number } = {}
): Promise<SpelunkOutput> {
  const lensSpec = getLens(plan.lens);
  const entries: ExplorationEntry[] = [];
  const maxOutput = options.maxOutput ?? 500;

  // Process documentSymbol results
  for (const [uri, symbols] of Object.entries(results.documentSymbols)) {
    const filePath = uriToPath(uri);

    for (const symbol of symbols) {
      // Filter by symbol kind
      if (!matchesSymbolFilter(symbol.kind, lensSpec.lsp.symbolFilters)) {
        continue;
      }

      // Filter by extract patterns
      if (!matchesExtractPatterns(symbol.name, lensSpec.extractPatterns)) {
        continue;
      }

      // Filter by ignore patterns
      if (matchesIgnorePatterns(symbol.name, filePath, lensSpec.ignorePatterns)) {
        continue;
      }

      // Get hover info if available
      const hoverKey = `${uri}:${symbol.range.start.line}:${symbol.range.start.character}`;
      const hover = results.hovers[hoverKey];
      const signature = extractHoverContent(hover);

      entries.push({
        name: symbol.name,
        kind: symbolKindToString(symbol.kind),
        filePath,
        line: symbol.range.start.line + 1,
        signature,
      });

      if (entries.length >= maxOutput) {
        break;
      }
    }

    if (entries.length >= maxOutput) {
      break;
    }
  }

  // Process references if available
  if (plan.lens === 'flows' || plan.lens === 'boundaries') {
    for (const [key, locations] of Object.entries(results.references)) {
      // Add reference information to entries
      // ...
    }
  }

  return {
    lens: plan.lens,
    focus: plan.focus,
    entries,
    filesExamined: plan.filesToExamine,
  };
}
```

### Phase 3: Skill Integration

```markdown
<!-- plugin/skills/spelunk/SKILL.md - Updated -->

## Spelunk Mode with LSP Tool Delegation

When a user invokes `/code spelunk`, follow this workflow:

### Step 1: Plan the spelunk

Call the TypeScript planner to get the specification:

```typescript
import { planSpelunk } from 'plugin/lib/spelunk/planner';

const plan = await planSpelunk('interfaces', 'authentication layer', {
  maxFiles: 50,
  projectRoot: process.cwd()
});

// Returns:
// {
//   filesToExamine: ['src/auth/handler.ts', 'src/auth/types.ts', ...],
//   toolCalls: [
//     { operation: 'documentSymbol', uri: 'file:///path/to/handler.ts' },
//     { operation: 'documentSymbol', uri: 'file:///path/to/types.ts' },
//     ...
//   ],
//   lens: 'interfaces',
//   focus: 'authentication layer'
// }
```

### Step 2: Execute LSP tool calls

For each tool call in the plan, use your available LSP tools:

**If ENABLE_LSP_TOOL=1 is set:**
- Use the native LSP tool for `documentSymbol`, `findReferences`, `hover`, etc.

**If LSP tool unavailable:**
- Fall back to Read tool to inspect file contents
- Use Grep tool for pattern searching

### Step 3: Process results

Pass the LSP results to the processor:

```typescript
import { processLspResults } from 'plugin/lib/spelunk/processor';

const output = await processLspResults(plan, {
  documentSymbols: {
    'file:///path/to/handler.ts': [
      { name: 'AuthHandler', kind: 5, range: {...}, ... },
      { name: 'authenticate', kind: 12, range: {...}, ... },
    ],
    // ...
  },
  references: {},
  hovers: {},
});

// Returns structured entries for report generation
```

### Step 4: Generate report

Use the existing report generator with the processed output.

```
```

### Tool Allowlist Configuration

```json
// .claude-plugin/plugin.json - Updated with LSP tool allowlist

{
  "name": "spelunk",
  "allowedTools": [
    "Read",      // For reading file contents
    "Grep",      // For pattern searching when LSP unavailable
    "Glob",      // For finding files
    "Lsp",       // Native LSP operations (when ENABLE_LSP_TOOL=1)
    "Bash"       // For running ast-grep if installed
  ]
}
```

## Updated File Structure

```
plugin/lib/spelunk/
├── index.ts              # Main entry point (delegates to planner/processor)
├── planner.ts            # NEW: Returns tool call specifications
├── processor.ts          # NEW: Processes LSP results
├── lens-specs.ts         # (unchanged)
├── types.ts              # (updated with new types)
├── file-finder.ts        # Extracted from lsp-executor
├── report-generator.ts   # (unchanged)
├── persistence.ts        # (unchanged)
├── staleness-check.ts    # (unchanged)
├── orchestrator.ts       # Updated for two-phase workflow
│
├── lsp-executor.ts       # DEPRECATED: Remove simulate functions
├── ast-executor.ts       # Keep as fallback option
└── grep-fallback.ts      # Keep as final fallback
```

## Implementation Tasks

| Task | Description | Lines | Priority |
|------|-------------|-------|----------|
| 1 | Create `planner.ts` | ~150 | High |
| 2 | Create `processor.ts` | ~200 | High |
| 3 | Update `types.ts` with new interfaces | ~50 | High |
| 4 | Update `orchestrator.ts` for two-phase workflow | ~100 | High |
| 5 | Update `SKILL.md` with LSP delegation instructions | ~80 | High |
| 6 | Add `file-finder.ts` (extract from lsp-executor) | ~80 | Medium |
| 7 | Remove simulate functions from `lsp-executor.ts` | -200 | Medium |
| 8 | Update tests | ~200 | Medium |

**Total net:** ~660 lines added

## Advantages of This Approach

1. **Simple** - No new dependencies, no MCP servers
2. **Accurate** - Uses actual LSP tool via the agent
3. **Fast** - LSP operations are native to the agent
4. **Flexible** - Falls back gracefully when LSP unavailable
5. **Clear** - TypeScript code orchestrates, Agent executes

## Example Workflow

```
User: /code spelunk --for=architect --focus="authentication layer"

1. Agent calls planner:
   planSpelunk('interfaces', 'authentication layer')
   → Returns { filesToExamine: [...], toolCalls: [...] }

2. Agent executes LSP calls:
   For each toolCall:
     - Use Lsp tool with documentSymbol operation
     - Collect results

3. Agent calls processor:
   processLspResults(plan, lspResults)
   → Returns { entries: [...] }

4. Agent generates report:
   generateReport(processedOutput)
   → Writes to docs/spelunk/contracts/authentication-layer.md
```

## Success Criteria

- [ ] Planner returns correct file list and tool call specifications
- [ ] Agent can execute LSP tool calls based on plan
- [ ] Processor correctly filters and structures LSP results
- [ ] Reports are generated with accurate symbol information
- [ ] Fallback works when LSP unavailable
- [ ] No more "simulate" functions being used in production

## Files to Modify

| File | Action |
|------|--------|
| `plugin/lib/spelunk/planner.ts` | Create |
| `plugin/lib/spelunk/processor.ts` | Create |
| `plugin/lib/spelunk/types.ts` | Update |
| `plugin/lib/spelunk/orchestrator.ts` | Update |
| `plugin/lib/spelunk/lsp-executor.ts` | Simplify/remove simulates |
| `plugin/skills/spelunk/SKILL.md` | Update workflow |
| `.claude-plugin/plugin.json` | Add tool allowlist |

---

## Architecture Validation (2026-01-13)

**Status:** ✅ VALIDATED WITH MINOR RECOMMENDATIONS

The Architecture Agent researched Claude Code's LSP functionality and validated this design.

### Confirmed Capabilities

| Operation | Supported | Notes |
|-----------|-----------|-------|
| `documentSymbol` | ✅ | Extracts symbols with hierarchical structure |
| `findReferences` | ✅ | Finds all usages across codebase |
| `hover` | ✅ | Type info and documentation |
| `goToDefinition` | ✅ | Navigate to symbol definition |
| `getDiagnostics` | ✅ | Errors and warnings |

**Enablement:** `export ENABLE_LSP_TOOL=1` or `export ENABLE_LSP_TOOL=true`

**Language Support:** TypeScript (vtsls), Python (pyright), Go (gopls), Rust (rust-analyzer), Java (jdtls), C/C++ (clangd)

### Validation Results

| Aspect | Finding |
|--------|---------|
| Architecture | ✅ Correct - LSP tool is only available to AI agent, not Node.js processes |
| LspToolCall interface | ✅ Compatible with Claude Code LSP tool interface |
| Two-phase workflow | ✅ Correct pattern for delegating to AI agent tools |
| Operations mapping | ✅ All supported operations accounted for |

### Recommendations to Address

1. **URI Format Verification** (Minor)
   - Add utility to convert between file paths and LSP URIs
   - Test with actual LSP tool calls to confirm format
   - Expected: `file:///path/to/file.ts` (percent-encoded)

2. **LSP Response Format Verification**
   - Capture actual LSP tool output from Claude Code
   - Ensure `SpelunkResults` types match reality
   - May need adjustments based on real output

3. **Two-Phase Reference Finding Clarity**
   - The `planReferencesPhase` function needs clearer handoff specification
   - Document how symbols from phase 1 feed into phase 2

4. **Skill Instruction Simplification**
   - Consider a wrapper function `spelunkWithLSP()` that handles full workflow
   - Reduces agent orchestration complexity
   - Single function call instead of multi-step process

5. **Fallback Strategy Documentation**
   - Make fallback to Read/Grep more explicit in skill instructions
   - Define when to trigger fallback

---

## README Updates Required (Product Agent Task)

The Product Agent should document the necessary README updates for LSP enablement:

1. **Installation section** - Add LSP enablement instructions
2. **Features section** - Document spelunk LSP capabilities
3. **Troubleshooting** - Add LSP-specific issues and solutions

---

**Next Steps:**

1. ✅ Validate this approach (COMPLETE)
2. Implement planner.ts
3. Implement processor.ts
4. Update orchestrator for two-phase workflow
5. Test with real codebase
