# Spelunker LSP README Updates - Product Design

**Design reviewed:** `docs/plans/architect/spelunker-lsp-improvements.md`
**Date:** 2026-01-13
**Status:** DRAFT - Ready for Implementation

## Summary

The spelunker is being updated to use Claude Code's native LSP tool for accurate, fast code intelligence. Users need clear documentation on how to enable LSP and what benefits it provides.

## Problem Statement

Users are not aware that:
1. LSP can dramatically improve spelunk accuracy and speed
2. LSP requires manual enablement (`export ENABLE_LSP_TOOL=1`)
3. Spelunk falls back to slower, less accurate Read/Grep tools when LSP is unavailable

Without documentation, users will experience suboptimal spelunk performance without understanding why or how to fix it.

## Target Users

| User | Context | Need |
|------|---------|------|
| **New users** | Installing plugin for first time | Clear setup instructions with LSP enablement |
| **Existing users** | Already using plugin | How to enable LSP, what to expect |
| **Troubleshooting** | Experiencing slow/innaccurate spelunk | Diagnosis and fix guidance |

## Success Criteria

- [ ] Users can easily find LSP enablement instructions
- [ ] Benefits of LSP are clearly communicated
- [ ] Fallback behavior is well-documented
- [ ] Common LSP issues have troubleshooting steps

---

## README Update Specifications

### 1. Installation Section Updates

**Location:** After beads installation (lines 56-60)

**Content to Add:**

```markdown
### LSP Enablement (Recommended)

The spelunker uses Claude Code's native LSP tool for fast, accurate code intelligence. Enable LSP for best results:

```bash
export ENABLE_LSP_TOOL=1
```

Add to your `~/.zshrc` or `~/.bashrc` to persist across sessions.

**Supported Languages:** TypeScript (vtsls), Python (pyright), Go (gopls), Rust (rust-analyzer), Java (jdtls), C/C++ (clangd)

**What LSP enables:**
- **Accurate symbol extraction** - Classes, functions, interfaces with proper nesting
- **Find references** - All usages of a symbol across the codebase
- **Type information** - Hover documentation and signatures
- **Fast navigation** - Jump-to-definition for exploring relationships

**Fallback behavior:** When LSP is unavailable, spelunk falls back to Read/Grep tools (slower, less accurate for complex code).
```

**Rationale:** Placing LSP enablement immediately after core installation ensures users see it early. The "Recommended" label signals importance without requiring it.

---

### 2. Spelunk System Section Updates

**Location:** Within "Spelunk System" section (after line 111)

**Content to Add:**

```markdown
**LSP vs Fallback Modes:**

The spelunker operates in two modes depending on LSP availability:

| Aspect | LSP Mode (Recommended) | Fallback Mode |
|--------|----------------------|---------------|
| **Symbol extraction** | Accurate parsing with type info | Regex-based, may miss nested structures |
| **Reference finding** | True cross-reference analysis | Grep-based text search |
| **Speed** | Fast (native LSP operations) | Slower (file reading + pattern matching) |
| **Requirements** | `ENABLE_LSP_TOOL=1` + language server | None (always available) |
| **Best for** | Production use, large codebases | Quick checks, unsupported languages |

**When LSP is enabled, spelunk uses:**
- `documentSymbol` - Extract classes, functions, interfaces with hierarchy
- `findReferences` - Find all usages across the codebase
- `hover` - Get type signatures and documentation
- `goToDefinition` - Navigate to symbol definitions
```

**Rationale:** This table sets clear expectations about what users get with vs without LSP. The comparison helps users understand the tradeoff and make an informed decision.

---

### 3. Troubleshooting Section (New)

**Location:** After "Dependencies" section (before "Development")

**Full Content:**

```markdown
## Troubleshooting

### Spelunk Issues

**Problem:** Spelunk results are incomplete or missing symbols

**Solution:** Enable LSP for accurate code intelligence:
```bash
export ENABLE_LSP_TOOL=1
```

Then re-run the spelunk command:
```bash
/code spelunk --for=product --focus='your focus area'
```

**Problem:** LSP operations fail or timeout

**Possible causes:**
1. Language server not installed for your project
2. Large files exceeding LSP response limits
3. Project has build errors preventing LSP indexing

**Solutions:**
- Ensure your language server is installed (`npm install -g typescript-language-server` for TypeScript)
- Run a clean build in your project
- Spelunk will automatically fall back to Read/Grep tools if LSP fails

**Problem:** Spelunk is slow on large codebases

**Solutions:**
- Enable LSP (`export ENABLE_LSP_TOOL=1`) - significantly faster than grep fallback
- Use focused lenses: `--focus='specific area'` instead of exploring entire codebase
- Check staleness with `/visualize` - fresh docs skip re-analysis

### Hooks Issues

**Problem:** Session-start hook doesn't show tasks

**Check:**
1. Verify beads is installed: `which bd`
2. Check hook path in `~/.claude/settings.json` points to correct location
3. Ensure hook file has execute permissions: `chmod +x hooks/session-start.sh`

### GitLab Integration Issues

**Problem:** GitLab commands fail with authentication errors

**Solution:** Verify environment variables are set:
```bash
echo $GITLAB_TOKEN
echo $GITLAB_HOST
```

Token should have `api`, `read_api`, `read_repository` scopes.
```

**Rationale:** Centralized troubleshooting section makes it easy for users to find help. The spelunk/LSP issues come first since that's the most common user-facing problem with the new LSP integration.

---

### 4. Dependencies Section Updates

**Location:** Update existing Dependencies section (lines 449-456)

**Current content:**
```markdown
## Dependencies

- [beads](https://github.com/steveyegge/beads) - Git-backed task tracking for AI agents
- [Claude Code](https://claude.ai/code) - Anthropic's CLI for Claude
- Node.js 18+ (required for dashboard and TypeScript tooling)
- `jq` - JSON processing (for hooks)
- `glab` (optional) - GitLab CLI for MR operations
```

**Updated content:**
```markdown
## Dependencies

### Required

- [beads](https://github.com/steveyegge/beads) - Git-backed task tracking for AI agents
- [Claude Code](https://claude.ai/code) - Anthropic's CLI for Claude
- Node.js 18+ - Required for dashboard and TypeScript tooling
- `jq` - JSON processing (for hooks)

### Optional

| Dependency | Purpose |
|------------|---------|
| Language servers | LSP support for spelunk (recommended) |
| `typescript-language-server` | TypeScript LSP (vtsls) |
| `pyright` | Python LSP |
| `gopls` | Go LSP |
| `rust-analyzer` | Rust LSP |
| `jdtls` | Java LSP |
| `clangd` | C/C++ LSP |
| `glab` | GitLab CLI for MR operations |

**Language server installation:**
```bash
# TypeScript
npm install -g typescript-language-server

# Python
npm install -g pyright

# Go
go install golang.org/x/tools/gopls@latest

# Rust
rustup component add rust-analyzer
```
```

**Rationale:** Separating required vs optional dependencies reduces setup friction. Users can start without LSP and add it later. Language server install commands reduce discovery friction.

---

### 5. Overview Section Updates (Minor)

**Location:** Update "Spelunk System" bullet point (line 39)

**Current:**
```markdown
- **Spelunk System** - Persistent codebase exploration with hash-based cache validation
```

**Updated:**
```markdown
- **Spelunk System** - Persistent codebase exploration with LSP-powered code intelligence
```

**Rationale:** One-line update signals LSP capability early in the README. Users scanning the overview will see LSP as a key feature.

---

## Content Principles

All added content follows these principles:

1. **Actionable first** - Every section includes concrete commands users can run
2. **Benefits-driven** - Explain WHY before explaining HOW
3. **Expectations set** - Users know what happens with and without LSP
4. **No gatekeeping** - LSP is recommended, not required; fallback is documented
5. **Troubleshooting accessible** - Problems grouped with solutions

---

## Validation Checklist

- [ ] Clear problem statement
- [ ] Solution addresses problem directly
- [ ] No unnecessary features (YAGNI)
- [ ] User value is clear
- [ ] Success criteria defined

## Recommendation

**APPROVE** - These updates provide clear, actionable documentation for LSP enablement. The content:

- Addresses the user knowledge gap about LSP benefits
- Provides clear setup instructions
- Sets expectations about fallback behavior
- Includes troubleshooting for common issues
- Fits naturally into existing README structure

**Minor suggestions for README author:**
1. Consider adding a "Quick Start" subsection under Installation with just the essential steps (beads + LSP)
2. The troubleshooting section could be extracted to a separate TROUBLESHOOTING.md if README length becomes a concern
