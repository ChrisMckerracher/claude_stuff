# Spelunk Mode

## Purpose

Targeted codebase exploration at specific granularity levels for different agents. Generates structured documentation about code relationships, boundaries, flows, and contracts that agents can use for context.

## Command Syntax

```
/code spelunk --for=<agent> --focus="<area>"
/code spelunk --lens=<lens1>,<lens2> --focus="<area>"
/code spelunk --check --focus="<area>" --lens=<lens>
```

## Options

| Option | Description | Required |
|--------|-------------|----------|
| `--for=<agent>` | Use agent's default lenses (architect, product, qa, security) | No* |
| `--lens=<name>` | Specific lens(es) - interfaces, flows, boundaries, contracts, trust-zones | No* |
| `--focus="<area>"` | The codebase area to explore (path, module name, or concept) | Yes |
| `--check` | Check staleness only, don't regenerate | No |
| `--refresh` | Force regeneration even if docs are fresh | No |
| `--max-files=N` | Limit files examined (default: 50) | No |
| `--max-depth=N` | Limit directory depth (default: 3) | No |
| `--max-output=N` | Limit output lines (default: 500) | No |

*Either `--for` or `--lens` must be specified, but not both.

## Agent Default Lenses

| Agent | Default Lenses | Use Case |
|-------|---------------|----------|
| architect | interfaces, boundaries | System structure and module boundaries |
| product | flows | User-facing functionality and data flow |
| qa | contracts | Input/output schemas and validation |
| security | trust-zones, contracts | Auth boundaries and privilege checks |

## Lens Descriptions

### interfaces
Extracts type definitions, interfaces, and class signatures. Shows the "shape" of data in the codebase.

### flows
Maps execution paths including entry points, handlers, and call chains. Shows how data moves through the system.

### boundaries
Identifies module exports, dependencies, and communication patterns. Shows system architecture.

### contracts
Finds validation schemas, error types, and API contracts. Shows expected inputs and outputs.

### trust-zones
Locates auth checks, sanitization, and privilege boundaries. Critical for security analysis.

## Examples

### Explore for Architect Agent
```
/code spelunk --for=architect --focus="authentication layer"
```
Uses interfaces and boundaries lenses to map auth system structure.

### Explore Specific Lenses
```
/code spelunk --lens=interfaces,contracts --focus="payment processing"
```
Examines types and validation schemas for payment code.

### Check Staleness Only
```
/code spelunk --check --lens=flows --focus="user registration"
```
Reports whether existing docs are FRESH, STALE, or MISSING without regenerating.

### Force Refresh
```
/code spelunk --refresh --for=security --focus="api/routes"
```
Regenerates security-focused docs even if current docs are fresh.

### With Limits
```
/code spelunk --for=qa --focus="src/services" --max-files=20 --max-depth=2
```
Explores services with constrained scope.

## Output Location

Results are written to `docs/spelunk/{lens}/{focus-slug}.md`

### Directory Structure
```
docs/spelunk/
  _staleness.json      # Tracks doc freshness by source file hashes
  _index.md            # Index of all spelunk docs
  contracts/           # interfaces and contracts lens output
  flows/               # flows lens output
  boundaries/          # boundaries lens output
  trust-zones/         # trust-zones lens output
```

## Staleness System

Each generated document tracks:
- Source files examined (with SHA-256 hashes)
- Generation timestamp
- Tool chain used (LSP, AST, or grep fallback)

Status values:
- **FRESH**: Doc exists and all source files unchanged
- **STALE**: Doc exists but source files changed
- **MISSING**: No doc exists for this lens+focus
- **ORPHANED**: Doc exists but not tracked in staleness index

## Tool Detection Strategy

Spelunk uses a **tool call delegation** approach:

1. **LSP** (preferred): When `ENABLE_LSP_TOOL=1`, the planner returns LSP tool call specifications that YOU execute using your native LSP tool.

2. **AST** (fallback): Uses `ast-grep` or `semgrep` if installed. Provides structural pattern matching.

3. **Grep** (last resort): Uses Grep/Glob/Read tools for lexical search. Always available.

## LSP Tool Delegation Workflow

When LSP is enabled (`ENABLE_LSP_TOOL=1`), follow this two-phase workflow:

### Phase 1: Plan and Execute documentSymbol

```typescript
import { planSpelunk, extractSymbolsForPhase2 } from 'plugin/lib/spelunk';

// 1. Get the plan
const plan = await planSpelunk('interfaces', 'authentication layer', {
  maxFiles: 50
});

// 2. Execute LSP tool calls for each entry
const results: SpelunkResults = {
  documentSymbols: {},
  references: {},
  hovers: {}
};

for (const toolCall of plan.toolCalls) {
  if (toolCall.operation === 'documentSymbol') {
    // Use your LSP tool to get documentSymbol
    const symbols = await lspDocumentSymbol(toolCall.uri);
    results.documentSymbols[toolCall.uri] = symbols;
  }
}
```

### Phase 2: Extract Symbols and Get References/Hover (Optional)

```typescript
import { planReferencesPhase, extractSymbolsForPhase2 } from 'plugin/lib/spelunk';
import { getLens } from 'plugin/lib/spelunk';

// 1. Extract symbols from phase 1 results
const lensSpec = getLens('interfaces');
const symbols = extractSymbolsForPhase2(results.documentSymbols, lensSpec);

// 2. Get phase 2 tool calls
const phase2Calls = await planReferencesPhase(symbols);

// 3. Execute phase 2 LSP tool calls
for (const toolCall of phase2Calls) {
  if (toolCall.operation === 'findReferences') {
    const refs = await lspFindReferences(toolCall.uri, toolCall.position!);
    results.references[`${toolCall.uri}:${toolCall.position.line}`] = refs;
  } else if (toolCall.operation === 'hover') {
    const hover = await lspHover(toolCall.uri, toolCall.position!);
    results.hovers[`${toolCall.uri}:${toolCall.position.line}:${toolCall.position.character}`] = hover;
  }
}
```

### Phase 3: Process Results

```typescript
import { processLspResults } from 'plugin/lib/spelunk';

// Process LSP results through lens filtering
const output = await processLspResults(plan, results, {
  maxOutput: 500
});

// output.entries contains filtered, structured exploration data
```

## LSP Enablement

To enable LSP-powered spelunking:

```bash
export ENABLE_LSP_TOOL=1
```

**Supported Languages:** TypeScript (vtsls), Python (pyright), Go (gopls), Rust (rust-analyzer), Java (jdtls), C/C++ (clangd)

**When LSP is unavailable:** Falls back to AST tools (ast-grep/semgrep) or grep-based search.

## Integration with Agents

### For Coding Agent
Before implementing a feature:
```
/code spelunk --for=architect --focus="feature-area"
```
Provides context about existing interfaces and boundaries.

### For QA Agent
Before writing tests:
```
/code spelunk --lens=contracts --focus="module-under-test"
```
Shows expected inputs, outputs, and validation.

### For Security Agent
Before security review:
```
/code spelunk --for=security --focus="sensitive-area"
```
Maps trust boundaries and auth checks.

## Programmatic Usage

The orchestrator can be called directly from TypeScript:

```typescript
import { spelunk, SpelunkResult } from 'plugin/lib/spelunk';

// Full exploration
const result: SpelunkResult = await spelunk('--for=architect --focus="auth"');

// Check only
const check = await spelunk('--check --lens=flows --focus="auth"');
if (check.staleness?.get('flows')?.status === 'STALE') {
  // Regenerate
  await spelunk('--refresh --lens=flows --focus="auth"');
}
```

## Best Practices

1. **Start narrow**: Use specific focus areas rather than broad paths
2. **Check first**: Use `--check` before regenerating to avoid unnecessary work
3. **Match agent needs**: Use `--for=<agent>` to get the right lenses automatically
4. **Limit scope**: Use `--max-files` and `--max-depth` for large codebases
5. **Trust the cache**: Only use `--refresh` when you know docs are stale
