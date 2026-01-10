# Coding Agent Spelunking Mode Design

**Product brief:** No product brief (technical/infrastructure task)

## Goal

Enable specialist agents (Architect, Product, QA, Security) to delegate targeted codebase exploration to the Coding Agent at appropriate granularity levels, optimizing context usage while getting precisely the information each agent needs.

## Background

Different agents need different views of the same codebase:
- **Architect** needs interfaces, boundaries, dependencies - not implementation details
- **Product** needs user flows, capabilities, entry points - not algorithms
- **QA** needs testable surfaces, state transitions - not internal plumbing
- **Security** needs trust zones, auth boundaries, data flow - not business logic

Currently, each agent must do its own exploration, duplicating effort and potentially gathering inappropriate granularity. The Coding Agent is best positioned to understand code, but needs directives about what level of detail to extract.

## Approach

Add a **spelunk** subcommand to the Coding Agent that:
1. Accepts a granularity directive (`--for=<agent>` or `--lens=<granularity>`)
2. Accepts a focus area (`--focus="<area>"`)
3. **Persists findings to well-known documentation locations** (not inline responses)
4. All agents check these docs BEFORE requesting new spelunks
5. Includes staleness detection to know when docs need refresh

The Coding Agent becomes the "eyes" for other agents, with different "lenses" for different purposes. Spelunk output is **durable knowledge** that accumulates over time, not ephemeral context.

### Alternatives Considered

1. **Each agent does its own exploration** - Current state. Duplicates work, risks context bloat, agents may not be skilled at code navigation.

2. **Dedicated Explore Agent** - Adds another agent to the ecosystem. Spelunking is fundamentally a code-understanding task, so Coding Agent is the natural fit.

3. **Pre-computed static analysis** - Could use ast-grep or semgrep for structural search. Adds tooling dependency, may not capture runtime patterns, harder to answer ad-hoc questions.

## Research

### Primary Approach: Language Server Protocol (LSP)

Claude Code has **native LSP support** since v2.0.74 (December 2025), providing IDE-level code intelligence:

| LSP Operation | Spelunking Use Case |
|---------------|---------------------|
| `goToDefinition` | Navigate to interface/type definitions |
| `findReferences` | Find all usages of a function/type |
| `documentSymbol` | Extract file structure (classes, functions, exports) |
| `hover` | Get type information and documentation |
| `getDiagnostics` | Identify errors and warnings |

**Performance**: LSP finds call sites in ~50ms vs ~45 seconds with text search - a 900x improvement. This transforms spelunking from "expensive operation" to "instant feedback."

**Enablement**: `ENABLE_LSP_TOOL=1 claude` or add `export ENABLE_LSP_TOOL=1` to shell profile.

**Language Support**: TypeScript (vtsls), Python (pyright), Go (gopls), Rust (rust-analyzer), Java, C/C++ (clangd), C#, PHP, Kotlin, Ruby, HTML/CSS.

**MCP Integration**: Additional LSP capabilities available via MCP servers:
- [cclsp](https://github.com/ktnyt/cclsp) - Robust symbol resolution that handles LLM line/column inaccuracies
- [lsp-mcp](https://mcpservers.org/servers/Tritlo/lsp-mcp) - Bridge for LSP hover and completion

Sources:
- [Claude Code LSP Setup Guide](https://www.aifreeapi.com/en/posts/claude-code-lsp)
- [Claude Code v2.0.74 LSP Support](https://www.how2shout.com/news/claude-code-v2-0-74-lsp-language-server-protocol-update.html)
- [cclsp MCP Server](https://github.com/ktnyt/cclsp)

### Fallback: AST-Based Tools

For languages without LSP support or when LSP is unavailable, AST tools provide structural search:

**ast-grep** - Available via Homebrew (`brew install ast-grep`)
- AST-based structural search using tree-sitter
- Pattern matching independent of language-specific parsing
- [Homebrew formula](https://formulae.brew.sh/formula/ast-grep)

**semgrep** - Available via Homebrew (`brew install semgrep`)
- Semantic grep with scope, control flow, and syntax awareness
- [Homebrew formula](https://formulae.brew.sh/formula/semgrep)

Both tools demonstrate the value of operating at different granularity levels (lexical, structural, semantic).

### Tool Selection Strategy

```
1. If LSP server available for language → Use LSP (fastest, most accurate)
2. If ast-grep/semgrep installed → Use AST tools (structural search)
3. Fallback → Use Grep/Glob/Read (lexical search)
```

The spelunking mode will prefer LSP operations when available, falling back to AST tools, then to existing Grep/Glob/Read tools.

## Documentation Persistence

### The Problem

Spelunk output returned inline to requesting agents is ephemeral - it disappears when the conversation ends. This means:
- Same areas get re-spelunked across conversations
- Agents duplicate exploration work
- No accumulated knowledge about the codebase
- Cross-agent coordination requires re-spelunking

### The Solution

Spelunk findings are **persisted to well-known documentation locations** that all agents check BEFORE initiating a new spelunk.

### Standard Directory Structure

```
docs/
  spelunk/                    # Root for all spelunk-generated documentation
    contracts/                # Interface definitions, API contracts, type signatures
    flows/                    # User flows, feature paths, entry points
    boundaries/               # Module boundaries, layer dependencies, what talks to what
    trust-zones/              # Security boundaries, auth checks, data flow
    state/                    # State machines, transitions, data lifecycle
    _index.md                 # Master index of all spelunk docs with freshness status
    _staleness.json           # Machine-readable staleness tracking
```

### Lens-to-Directory Mapping

| Lens | Output Directory | Contents |
|------|-----------------|----------|
| `interfaces` | `docs/spelunk/contracts/` | Type definitions, public APIs, method signatures, module exports |
| `flows` | `docs/spelunk/flows/` | Entry points, user-facing paths, route handlers, command handlers |
| `boundaries` | `docs/spelunk/boundaries/` | Module edges, imports, dependency graph, communication patterns |
| `contracts` | `docs/spelunk/contracts/` | Input/output schemas, validation rules, error types (shares with interfaces) |
| `trust-zones` | `docs/spelunk/trust-zones/` | Auth checks, sanitization, privilege boundaries, data flow edges |

### File Naming Conventions

Within each directory, files follow this naming pattern:

```
{focus-area-slug}.md
```

**Rules:**
1. `focus-area-slug` is the `--focus` value converted to kebab-case
2. Spaces become hyphens, special chars removed
3. Maximum 50 characters (truncated with hash suffix if longer)
4. All lowercase

**Examples:**
```
docs/spelunk/contracts/authentication-layer.md      # --focus="authentication layer"
docs/spelunk/flows/user-onboarding.md               # --focus="user onboarding"
docs/spelunk/boundaries/payment-service.md          # --focus="payment service"
docs/spelunk/trust-zones/api-endpoints.md           # --focus="API endpoints"
docs/spelunk/flows/checkout-process-a3f2.md         # --focus="checkout process including cart validation and payment"
```

### File Format

Each spelunk document includes a frontmatter header for staleness tracking:

```markdown
---
lens: interfaces
focus: "authentication layer"
generated: 2025-01-10T14:30:00Z
source_files:
  - path: src/auth/handler.ts
    hash: a1b2c3d4
  - path: src/auth/types.ts
    hash: e5f6g7h8
  - path: src/auth/middleware.ts
    hash: i9j0k1l2
tool_chain: lsp  # or: ast-grep, grep-fallback
---

# Authentication Layer Contracts

## Summary
[2-3 sentence overview of findings]

## Interfaces

### AuthHandler
- `path/to/file.ts:L10-25`
  ```typescript
  interface AuthHandler {
    authenticate(token: string): Promise<User>;
    refresh(refreshToken: string): Promise<TokenPair>;
  }
  ```

...rest of content...
```

### Staleness Detection

The `_staleness.json` file tracks document freshness:

```json
{
  "version": 1,
  "docs": {
    "contracts/authentication-layer.md": {
      "generated": "2025-01-10T14:30:00Z",
      "source_files": {
        "src/auth/handler.ts": "a1b2c3d4",
        "src/auth/types.ts": "e5f6g7h8"
      }
    }
  }
}
```

**Staleness Check Algorithm:**

```
1. Read _staleness.json
2. For each source_file in doc entry:
   a. Compute current file hash (first 8 chars of SHA-256)
   b. Compare to stored hash
3. If ANY hash differs → doc is STALE
4. If all hashes match → doc is FRESH
5. If source file deleted → doc is ORPHANED (warn, don't auto-delete)
```

**Hash Computation:**
```bash
# Fast content hash (first 8 chars of SHA-256)
sha256sum path/to/file.ts | cut -c1-8
```

### Master Index

The `_index.md` provides human-readable navigation:

```markdown
# Spelunk Documentation Index

Last updated: 2025-01-10T14:35:00Z

## Contracts
| Document | Focus | Status | Last Updated |
|----------|-------|--------|--------------|
| [authentication-layer.md](contracts/authentication-layer.md) | authentication layer | FRESH | 2025-01-10 |
| [payment-types.md](contracts/payment-types.md) | payment types | STALE | 2025-01-08 |

## Flows
| Document | Focus | Status | Last Updated |
|----------|-------|--------|--------------|
| [user-onboarding.md](flows/user-onboarding.md) | user onboarding | FRESH | 2025-01-10 |

## Boundaries
...

## Trust Zones
...
```

### Agent Workflow Change

**Before (Ephemeral):**
```
Agent needs info → requests spelunk → gets inline response → response lost when conversation ends
```

**After (Persistent):**
```
Agent needs info
  → checks docs/spelunk/{lens}/ for existing doc
  → if exists AND fresh: read and use
  → if exists AND stale: request spelunk --refresh
  → if missing: request spelunk
  → spelunk writes/updates docs/spelunk/{lens}/{focus}.md
  → agent reads from file
```

### Spelunk Command Updates

New flags to support persistence:

```bash
# Normal spelunk - writes to docs/spelunk/
/code spelunk --for=architect --focus="authentication layer"

# Force refresh even if docs exist and are fresh
/code spelunk --for=architect --focus="authentication layer" --refresh

# Check staleness only, don't spelunk
/code spelunk --check --focus="authentication layer"

# Output: "FRESH: docs/spelunk/contracts/authentication-layer.md"
# Output: "STALE: docs/spelunk/contracts/authentication-layer.md (2 files changed)"
# Output: "MISSING: no docs for 'authentication layer'"
```

### Agent Skill Updates Required

All delegating agents need updates to check docs before spelunking:

**Pattern for all agents:**
```
1. Before requesting spelunk, check:
   - Does docs/spelunk/{lens}/{focus-slug}.md exist?
   - If yes, run /code spelunk --check --focus="{focus}"
   - If FRESH: Read file directly, skip spelunk
   - If STALE or MISSING: Request spelunk

2. After spelunk completes:
   - Read from docs/spelunk/{lens}/{focus-slug}.md
   - (Spelunk will have created/updated the file)
```

**Agents requiring updates:**
- `architect.md` - Add doc check before spelunking in Examine mode
- `product.md` - Add doc check before spelunking for flow validation
- `qa.md` - Add doc check before spelunking for contract discovery
- `security.md` - Add doc check before spelunking for trust-zone mapping

### Git Considerations

**Should spelunk docs be committed?**

Recommendation: **YES, selectively**

```gitignore
# .gitignore
docs/spelunk/_staleness.json   # Machine state, regenerate as needed
# Everything else in docs/spelunk/ is committed
```

**Rationale:**
- Spelunk docs are valuable accumulated knowledge
- New team members/agents benefit from existing exploration
- Code review can validate spelunk accuracy
- _staleness.json can be regenerated by running `--check` on all docs

## Components

### 1. Granularity Lenses

Five predefined lenses, each mapping to a specific abstraction level:

| Lens | Target Agent | Extracts | Ignores |
|------|-------------|----------|---------|
| `interfaces` | Architect | Type definitions, public APIs, method signatures, module exports | Implementation bodies, private methods |
| `flows` | Product | Entry points, user-facing paths, route handlers, command handlers | Internal algorithms, utility functions |
| `boundaries` | Architect | Module edges, imports, dependency graph, communication patterns | File-internal code |
| `contracts` | QA | Input/output schemas, validation rules, error types, state machines | Business logic implementation |
| `trust-zones` | Security | Auth checks, sanitization, privilege boundaries, data flow edges | Non-security code paths |

### 2. Invocation Interface

```bash
# Agent-specific shorthand (recommended)
/code spelunk --for=architect --focus="authentication layer"
/code spelunk --for=product --focus="user onboarding flow"
/code spelunk --for=qa --focus="payment processing"
/code spelunk --for=security --focus="API endpoints"

# Direct lens specification (advanced)
/code spelunk --lens=interfaces --focus="authentication"
/code spelunk --lens=boundaries,contracts --focus="data layer"
```

The `--for` flag automatically selects appropriate lens(es):

| Agent | Default Lens(es) |
|-------|-----------------|
| architect | interfaces, boundaries |
| product | flows |
| qa | contracts |
| security | trust-zones, contracts |

### 3. Output Format

Structured markdown with consistent sections:

```markdown
# Spelunk Report: [focus area]

**Lens:** [lens name]
**Scope:** [files/directories examined]
**Generated for:** [requesting agent]

## Summary
[2-3 sentence overview of findings]

## Findings

### [Category 1]
- `path/to/file.ts:L10-25` - [description of interface/flow/boundary]
  ```typescript
  // Relevant snippet (signatures only, not bodies)
  ```

### [Category 2]
...

## Connections
[How components relate to each other]

## Gaps/Questions
[Things that need human clarification]
```

### 4. Persistence Layer (replaces in-memory cache)

Results persisted to `docs/spelunk/` for cross-session, cross-agent reuse:

```
docs/spelunk/
  contracts/                           # Interface and contract definitions
  flows/                               # User flows and entry points
  boundaries/                          # Module boundaries and dependencies
  trust-zones/                         # Security boundaries
  state/                               # State machines (future)
  _index.md                            # Human-readable index
  _staleness.json                      # Machine-readable freshness tracking
```

Persistence provides:
- **Cross-session durability**: Survives conversation restarts
- **Hash-based invalidation**: Tracks source file hashes, marks stale on change
- **Cross-agent sharing**: Any agent can read existing docs
- **Git-friendly**: Docs can be committed for team knowledge sharing
- **Incremental**: Only stale/missing areas need re-spelunking

See "Documentation Persistence" section above for full details.

### 5. Depth Limiting

Prevent runaway exploration with configurable limits:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--max-files` | 50 | Maximum files to examine |
| `--max-depth` | 3 | Maximum directory depth from focus |
| `--max-output` | 500 lines | Maximum output length |

Exceeded limits produce a summary with "... and N more files" with option to continue.

## Data Flow

### New Workflow with Documentation Persistence

```
Delegating Agent                    docs/spelunk/              Coding Agent
      |                                   |                          |
      |--- Check docs/{lens}/{focus}.md --|                          |
      |<-- File exists? Fresh/Stale? -----|                          |
      |                                   |                          |
[If FRESH]                                |                          |
      |--- Read docs directly ------------|                          |
      |<-- Contents --------------------- |                          |
      | (Done - no spelunk needed)        |                          |
      |                                   |                          |
[If STALE or MISSING]                     |                          |
      | Task(spelunk --for=X --focus=Y)   |                          |
      |-------------------------------------------------->|          |
      |                                   |               |          |
      |                                   |               |-- LSP/AST explore
      |                                   |               |-- Apply lens filter
      |                                   |               |-- Compute file hashes
      |                                   |<-- Write ----|-- Generate report
      |                                   |   (creates/updates doc)  |
      |                                   |               |          |
      |                                   |<-- Update ---|-- Update _staleness.json
      |                                   |               |          |
      |<----------------------------------|-- "Doc written to path" -|
      |                                   |                          |
      |--- Read docs/{lens}/{focus}.md ---|                          |
      |<-- Contents ----------------------|                          |
```

### Key Changes from Original Design

1. **Agents check docs FIRST** - Before spawning Coding Agent
2. **Spelunk writes to files** - Not inline response
3. **Hash-based freshness** - Source file changes invalidate docs
4. **Agents read from files** - After spelunk completes

## Integration with Agent Ecosystem

### How Agents Invoke Spelunking

**Step 1: Check for existing docs (ALL agents must do this)**

```python
# Pseudocode for doc check
def check_spelunk_docs(lens: str, focus: str) -> DocStatus:
    slug = to_kebab_case(focus)
    doc_path = f"docs/spelunk/{lens}/{slug}.md"

    if not exists(doc_path):
        return DocStatus.MISSING

    # Check staleness via _staleness.json
    staleness = read_json("docs/spelunk/_staleness.json")
    doc_entry = staleness["docs"].get(f"{lens}/{slug}.md")

    if not doc_entry:
        return DocStatus.MISSING

    for file_path, stored_hash in doc_entry["source_files"].items():
        current_hash = compute_hash(file_path)
        if current_hash != stored_hash:
            return DocStatus.STALE

    return DocStatus.FRESH
```

**Step 2: Only spelunk if needed**

```
status = check_spelunk_docs(lens="contracts", focus="authentication layer")

if status == FRESH:
    # Read directly - no spelunk needed
    read("docs/spelunk/contracts/authentication-layer.md")
else:
    # Spawn Coding Agent to spelunk
    Task(
      subagent_type: "agent-ecosystem:code",
      prompt: "spelunk --for=architect --focus='authentication layer'"
    )
    # Then read the generated doc
    read("docs/spelunk/contracts/authentication-layer.md")
```

### Workflow Integration (Updated)

**Architect Agent (Execute mode):**
```
1. Check docs/spelunk/boundaries/ and docs/spelunk/contracts/ for focus area
2. If FRESH: read docs directly
3. If STALE/MISSING: spelunk for boundaries and interfaces
4. Use findings to inform component breakdown
5. Docs remain available for Product validation (no re-spelunk needed)
```

**Product Agent (Validate mode):**
```
1. Check docs/spelunk/flows/ for area being validated
2. If FRESH: read docs directly
3. If STALE/MISSING: spelunk for flows
4. Compare actual flows to design intent
5. Flag mismatches
```

**QA Agent (Spec to Tests mode):**
```
1. Check docs/spelunk/contracts/ for target area
2. If FRESH: read docs directly
3. If STALE/MISSING: spelunk for contracts
4. Generate tests covering all input/output combinations
5. Ensure edge cases from contracts are tested
```

**Security Agent (Audit mode):**
```
1. Check docs/spelunk/trust-zones/ for scope
2. If FRESH: read docs directly
3. If STALE/MISSING: spelunk for trust-zones
4. Verify all trust boundaries have proper checks
5. Flag gaps in auth/sanitization
```

### Required Agent Skill File Updates

Each agent skill file needs a new section added:

**Template for all agent skills:**
```markdown
## Pre-Spelunk Documentation Check

Before requesting a spelunk, ALWAYS check for existing documentation:

1. Determine the lens you need: {lens_for_this_agent}
2. Convert focus to slug: "authentication layer" → "authentication-layer"
3. Check if `docs/spelunk/{lens}/{slug}.md` exists
4. If exists, run: `/code spelunk --check --focus="{focus}"`
5. If FRESH: Read the doc directly, skip spelunk
6. If STALE or MISSING: Request spelunk as normal

This prevents redundant exploration and leverages accumulated knowledge.
```

**Files requiring this addition:**
| Agent Skill | File Location | Lenses to Check |
|-------------|--------------|-----------------|
| Architect | `.claude/skills/agent-ecosystem/architect.md` | contracts/, boundaries/ |
| Product | `.claude/skills/agent-ecosystem/product.md` | flows/ |
| QA | `.claude/skills/agent-ecosystem/qa.md` | contracts/ |
| Security | `.claude/skills/agent-ecosystem/security.md` | trust-zones/, contracts/ |
| Code | `.claude/skills/agent-ecosystem/code.md` | (implements spelunk, no check needed) |

## LSP-to-Lens Mapping

Each lens maps to specific LSP operations:

| Lens | Primary LSP Operations | Fallback Tools |
|------|----------------------|----------------|
| `interfaces` | `documentSymbol` (filter: interfaces, types, exports), `hover` (type signatures) | ast-grep patterns for type definitions |
| `flows` | `findReferences` (from entry points), `goToDefinition` (trace calls) | Grep for route/handler patterns |
| `boundaries` | `documentSymbol` (module exports), `findReferences` (cross-module calls) | ast-grep for import/export |
| `contracts` | `hover` (input/output types), `getDiagnostics` (type errors) | semgrep for validation patterns |
| `trust-zones` | `findReferences` (auth functions), `goToDefinition` (auth implementations) | semgrep security rules |

### LSP Operation Workflow

```
1. Identify entry points in focus area (Glob + file heuristics)
2. For each entry point:
   a. documentSymbol → Get file structure
   b. Filter symbols by lens criteria
   c. hover → Get type information for relevant symbols
   d. findReferences → Map usage patterns (if lens needs it)
3. Aggregate and deduplicate across files
4. Generate structured report
```

### Prerequisites Check

Before spelunking, verify tool availability:

```bash
# Check LSP availability
claude /lsp status  # Shows active language servers

# Check AST tool availability (fallback)
which ast-grep && ast-grep --version
which semgrep && semgrep --version
```

If LSP is unavailable for the target language, log a warning and use fallback tools.

## Interaction with Existing Explore Agent

The current Coding Agent already has an "Examine Mode" that:
- Maps imports, calls, inheritance
- Understands data flow
- Identifies patterns and conventions

**Spelunking extends this** by:
1. Adding granularity control (lenses)
2. **LSP-first implementation** for speed and accuracy
3. Structured output format
4. Cross-agent caching
5. Explicit delegation protocol

The existing examine mode becomes the implementation backing for spelunk operations, now powered by LSP when available.

## Task Breakdown

| Task | Blocks | Est. Lines | Description |
|------|--------|------------|-------------|
| 1. LSP availability detection | - | 100 | Check for LSP servers, ast-grep, semgrep; determine tool strategy |
| 2. Define lens specifications | - | 150 | Lens configs with LSP operation mappings + AST fallback patterns |
| 3. Implement persistence layer | - | 300 | File writing to docs/spelunk/, _staleness.json management, hash computation |
| 4. Add spelunk subcommand parsing | - | 150 | Parse --for, --lens, --focus, --refresh, --check flags |
| 5. LSP-based lens implementation | 1, 2 | 350 | Use LSP operations (documentSymbol, findReferences, hover) per lens |
| 6. AST fallback implementation | 2 | 200 | ast-grep/semgrep patterns for each lens when LSP unavailable |
| 7. Structured report generator | 2, 3 | 200 | Markdown report with frontmatter, file writing, index updates |
| 8. Staleness check implementation | 3 | 150 | --check flag, hash comparison, FRESH/STALE/MISSING detection |
| 9. Update Coding Agent skill | 4, 5, 6, 7, 8 | 150 | Add spelunk mode to /code command with persistence |
| 10. Update Architect Agent skill | 9 | 100 | Add pre-spelunk doc check for contracts/, boundaries/ |
| 11. Update Product Agent skill | 9 | 100 | Add pre-spelunk doc check for flows/ |
| 12. Update QA Agent skill | 9 | 100 | Add pre-spelunk doc check for contracts/ |
| 13. Update Security Agent skill | 9 | 100 | Add pre-spelunk doc check for trust-zones/, contracts/ |
| 14. Master index maintenance | 3, 7 | 100 | _index.md generation and updates |
| 15. Integration tests | 9-14 | 300 | Test persistence, staleness detection, cross-agent workflow |

**Total estimated:** ~2500 lines across 15 tasks

### Task Dependencies Visualization

```
                    ┌─────────────────┐
                    │ 1. LSP detect   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ 2. Lens specs │   │ 3. Persistence│   │ 4. Parsing    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        │    ┌──────────────┼───────────────────┤
        │    │              │                   │
        ▼    ▼              ▼                   │
┌───────────────┐   ┌───────────────┐           │
│ 5. LSP impl   │   │ 7. Report gen │           │
└───────┬───────┘   └───────┬───────┘           │
        │                   │                   │
        ▼                   │                   │
┌───────────────┐           │                   │
│ 6. AST fallbk │           │                   │
└───────┬───────┘           │                   │
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼───────┐
                    │ 8. Staleness  │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │ 9. Code Agent │
                    └───────┬───────┘
                            │
        ┌───────────────────┼───────────────────┐
        │           │       │       │           │
        ▼           ▼       ▼       ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌───┐ ┌─────────┐ ┌─────────┐
   │10.Archt │ │11.Prodct│ │12.│ │13.Securt│ │14.Index │
   └────┬────┘ └────┬────┘ │QA │ └────┬────┘ └────┬────┘
        │           │      └─┬─┘      │           │
        └───────────┴────────┼────────┴───────────┘
                             │
                     ┌───────▼───────┐
                     │ 15. Tests     │
                     └───────────────┘
```

## Success Criteria

### Functional
- [ ] Architect can spelunk for interfaces/boundaries without seeing implementation
- [ ] Product can spelunk for flows without seeing internal code
- [ ] QA can spelunk for contracts and generate comprehensive tests
- [ ] Security can spelunk for trust-zones and identify all auth boundaries
- [ ] Depth limits prevent runaway context consumption
- [ ] Output format is consistent and parseable by delegating agents

### Documentation Persistence
- [ ] Spelunk output written to `docs/spelunk/{lens}/{focus-slug}.md`
- [ ] Frontmatter includes source file paths and hashes
- [ ] `_staleness.json` updated on every spelunk
- [ ] `_index.md` provides navigable index of all docs
- [ ] FRESH docs reused without re-spelunking
- [ ] STALE docs trigger re-spelunk on request
- [ ] Cross-session persistence verified (docs survive conversation restart)
- [ ] Cross-agent sharing works (Architect doc readable by Product)

### Staleness Detection
- [ ] Hash computed correctly for source files (first 8 chars SHA-256)
- [ ] FRESH status when no source files changed
- [ ] STALE status when any source file changed
- [ ] ORPHANED warning when source file deleted
- [ ] `--check` flag returns correct status without spelunking
- [ ] `--refresh` flag forces re-spelunk even if FRESH

### Agent Integration
- [ ] All agents check docs/spelunk/ BEFORE requesting spelunk
- [ ] Architect checks contracts/, boundaries/
- [ ] Product checks flows/
- [ ] QA checks contracts/
- [ ] Security checks trust-zones/, contracts/
- [ ] Agents read from files after spelunk completes (not inline)

### LSP Integration
- [ ] LSP operations used when language server available (TypeScript, Python, Go, Rust, etc.)
- [ ] Graceful fallback to AST tools when LSP unavailable
- [ ] Graceful fallback to Grep/Glob when AST tools unavailable
- [ ] Performance: LSP-based spelunking completes in <5 seconds for typical focus areas
- [ ] Tool availability reported in spelunk output header

## Open Questions

### Resolved by Documentation Persistence Design

1. ~~**Cache persistence:** Should cache survive conversation restarts?~~
   **RESOLVED:** YES - docs/spelunk/ is persistent file storage, not in-memory cache

2. ~~**Partial results:** If spelunking is interrupted, should partial results be cached?~~
   **RESOLVED:** NO - only complete spelunks write to docs/spelunk/

### Still Open

3. **Custom lenses:** Should agents be able to define ad-hoc lenses, or only use predefined? (Current proposal: predefined only, with ability to combine)

4. **Language-specific lens implementations:** Do lenses need language-specific logic (e.g., Python vs TypeScript interfaces)? (Current proposal: yes, LSP handles this automatically; AST fallback needs language-specific patterns)

5. **LSP startup latency:** LSP servers have cold-start time. Should we pre-warm servers when starting a spelunk session? (Current proposal: yes, warm on first spelunk call per language)

6. **cclsp vs native LSP:** Should we use Claude Code's native LSP tool or the cclsp MCP server? (Current proposal: prefer native LSP, use cclsp for rename/advanced operations if needed)

7. **Homebrew dependencies:** Should spelunking auto-install ast-grep/semgrep if missing, or just warn? (Current proposal: warn and proceed with Grep/Glob fallback)

### New Questions from Persistence Design

8. **Hash granularity:** Should we track hashes at file level (current design) or line-range level for more precise staleness? (Current proposal: file level - simpler, line-range adds complexity for marginal benefit)

9. **Doc cleanup:** What happens to spelunk docs when their focus area is removed from code? Should there be a cleanup command? (Current proposal: docs become ORPHANED, manual cleanup, no auto-delete)

10. **Concurrent spelunks:** What if two agents request spelunk for same focus area simultaneously? (Current proposal: file locking via temp file, second agent waits)

11. **Doc versioning:** Should spelunk docs track their generation count or history? (Current proposal: no, just latest - git provides history if needed)

12. **Cross-repo spelunks:** If a project has submodules or workspaces, how should docs/spelunk/ be structured? (Current proposal: one docs/spelunk/ per repo root, submodules are separate)

---

**Status:** DRAFT - Updated with Documentation Persistence design

Design draft complete at `/Users/chrismck/tasks/claude_stuff/docs/plans/architect/coding-agent-spelunking-mode.md`

**Summary:**
- Adds `spelunk` subcommand to Coding Agent with 5 granularity lenses (interfaces, flows, boundaries, contracts, trust-zones)
- **LSP-first implementation** using Claude Code's native LSP support (900x faster than text search)
- Fallback to AST tools (ast-grep, semgrep) when LSP unavailable - both available via Homebrew
- Each delegating agent (Architect, Product, QA, Security) gets appropriate abstraction level via `--for=<agent>` flag
- **NEW: Documentation Persistence** - spelunk output written to `docs/spelunk/{lens}/` for cross-session reuse
- **NEW: Staleness Detection** - hash-based tracking to know when docs need refresh
- **NEW: Agent Workflow Change** - all agents check docs BEFORE requesting spelunk

**Key Design Decisions (Documentation Persistence):**
- Standard directory structure: `docs/spelunk/{contracts,flows,boundaries,trust-zones,state}/`
- File naming: `{focus-slug}.md` (kebab-case, max 50 chars)
- Frontmatter with source file hashes for staleness tracking
- `_staleness.json` for machine-readable freshness checks
- `_index.md` for human-readable navigation
- New flags: `--check` (staleness only), `--refresh` (force update)
- Git-friendly: docs committed, _staleness.json gitignored

**Agent Skill Updates Required:**
- Architect, Product, QA, Security agents need pre-spelunk doc check logic
- Pattern: check docs -> if FRESH read directly -> if STALE/MISSING spelunk -> read from file

**Key Research Findings:**
- ast-grep: `brew install ast-grep` (confirmed available)
- semgrep: `brew install semgrep` (confirmed available)
- Claude Code LSP: Native support since v2.0.74, enable with `ENABLE_LSP_TOOL=1`
- LSP provides: goToDefinition, findReferences, documentSymbol, hover, getDiagnostics
- MCP servers (cclsp, lsp-mcp) available for advanced LSP integration

**Estimated Scope:** ~2500 lines across 15 tasks

Review and let me know:
- Approve -> I'll proceed to decomposition
- Revise -> Tell me what to change
- Discuss -> Let's talk through any of the open questions
