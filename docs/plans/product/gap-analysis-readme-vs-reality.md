# Gap Analysis: README.md vs Codebase Reality

**Generated:** 2026-01-10
**Product Agent Mode:** Examine (Spelunking)

---

## Executive Summary

The README.md provides a solid overview of the Agent Ecosystem plugin but has significant gaps when compared to actual codebase capabilities. Most notably:

1. **Undocumented Feature:** The sophisticated **hash-based validation system** for spelunk documentation is completely absent from the README
2. **Missing Feature:** The `/dashboard` command and web UI are not mentioned
3. **Structural Discrepancy:** The actual plugin uses `commands/` directory, not mentioned in README structure
4. **Spelunk Feature:** The entire `spelunk` skill with its TypeScript library is not documented

---

## Feature-by-Feature Comparison

### 1. Agents

| README Claims | Actual Implementation | Status |
|---------------|----------------------|--------|
| 6 Specialist Agents | 7 files in `plugin/agents/` | PARTIAL |
| - Architecture | `architecture.md` | EXISTS |
| - Product | `product.md` | EXISTS |
| - Coding | `coding.md` | EXISTS |
| - QA | `qa.md` | EXISTS |
| - Code Review | `code-review.md` | EXISTS |
| - Security | `security.md` | EXISTS |
| - Orchestrator | `orchestrator.md` | EXISTS but not counted as "specialist" |

**Finding:** README counts 6 but there are 7 agent files. Orchestrator should perhaps be mentioned separately as the routing layer.

---

### 2. Skills/Commands

**README Documents (17 skills):**
```
/architect, /architect examine, /architect decompose
/product, /product examine
/code, /code examine
/qa, /qa examine
/review
/security
/decompose
/visualize
/merge-up
/rebalance
/gitlab pull-comments
/gitlab push-mr
/update-claude
```

**Actual Skills Directory (14 directories):**
```
architect, code, decompose, gitlab-pull-comments, gitlab-push-mr,
merge-up, product, qa, rebalance, review, security, spelunk,
update-claude, visualize
```

**Missing from README:**
- `/spelunk` - Entire codebase exploration feature with TypeScript library
- `/dashboard` - Web UI for viewing tasks and git diffs (exists in commands/)

**Actual Commands Directory (15 files):**
```
architect.md, code.md, dashboard.md, decompose.md, gitlab-pull-comments.md,
gitlab-push-mr.md, merge-up.md, orchestrator.md, product.md, qa.md,
rebalance.md, review.md, security.md, update-claude.md, visualize.md
```

---

### 3. Hash-Based Validation System (UNDOCUMENTED)

This is a **major undocumented feature** in `plugin/lib/spelunk/`:

**Location:** `/Users/chrismck/tasks/claude_stuff/plugin/lib/spelunk/`

**Core Components:**
1. `persistence.ts` - SHA-256 hash computation and document persistence
2. `staleness-check.ts` - FRESH/STALE/MISSING/ORPHANED status checking
3. `types.ts` - Type definitions for the staleness system
4. `orchestrator.ts` - Main spelunk entry point

**How It Works:**
```typescript
// From persistence.ts - Hash computation
export async function computeHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  const fullHash = crypto.createHash('sha256').update(content).digest('hex');
  return fullHash.slice(0, HASH_LENGTH); // First 8 chars
}
```

**Staleness Index Structure:**
```json
{
  "version": 1,
  "docs": {
    "contracts/auth.md": {
      "generated": "2026-01-10T12:00:00.000Z",
      "source_files": {
        "src/auth/handler.ts": "a1b2c3d4",
        "src/auth/types.ts": "e5f6g7h8"
      }
    }
  }
}
```

**Status Definitions:**
- `FRESH`: Doc exists, all source file hashes match current
- `STALE`: Doc exists but source files changed (hash mismatch)
- `MISSING`: No doc exists for this lens+focus
- `ORPHANED`: Doc exists but not tracked in `_staleness.json`

**Benefits Not Mentioned in README:**
- Cross-session persistence of codebase knowledge
- Automatic invalidation when source files change
- Token savings by avoiding redundant exploration
- Multi-agent sharing of spelunk documents

---

### 4. Dashboard Feature (UNDOCUMENTED)

**Location:** `/Users/chrismck/tasks/claude_stuff/plugin/dashboard/`

**Contents:**
- `server.js` - Node.js server
- `package.json` - Dependencies
- `public/` - Static files
- `node_modules/` - Installed dependencies

**Command Definition:** `plugin/commands/dashboard.md`
```markdown
Launch the agent ecosystem dashboard web interface.
Runs at http://localhost:3847
```

**Not mentioned anywhere in README.**

---

### 5. Plugin Structure Discrepancy

**README Claims:**
```
~/.claude/plugins/local/agent-ecosystem/
  .claude-plugin/plugin.json
  agents/
  skills/
  hooks/
  templates/
```

**Actual Structure Includes:**
```
plugin/
  .claude-plugin/plugin.json
  agents/
  skills/
  commands/        <-- NOT IN README
  hooks/
  templates/
  dashboard/       <-- NOT IN README
  lib/             <-- NOT IN README
    spelunk/       <-- TypeScript library
```

**Missing from README:**
1. `commands/` directory - Contains slash command definitions
2. `dashboard/` directory - Web UI
3. `lib/` directory - TypeScript utilities including spelunk

---

### 6. Lens System (UNDOCUMENTED)

The spelunk system uses a sophisticated "lens" concept:

**Available Lenses:**
| Lens | Purpose | Output Directory |
|------|---------|------------------|
| interfaces | Type definitions and class signatures | contracts/ |
| flows | Execution paths and call chains | flows/ |
| boundaries | Module exports and dependencies | boundaries/ |
| contracts | Validation schemas and API contracts | contracts/ |
| trust-zones | Auth checks and privilege boundaries | trust-zones/ |

**Agent-to-Lens Mapping:**
| Agent | Default Lenses |
|-------|---------------|
| architect | interfaces, boundaries |
| product | flows |
| qa | contracts |
| security | trust-zones, contracts |

---

### 7. Tool Detection Strategy (UNDOCUMENTED)

Spelunk auto-selects the best available tool:

1. **LSP** (preferred): Requires `ENABLE_LSP_TOOL=1`
2. **AST** (fallback): Uses ast-grep or semgrep
3. **Grep** (last resort): Always available

**From `tool-detection.ts`:**
- Language-specific strategies
- Automatic degradation
- Warning messages for reduced capability

---

## Claude Code Plugin Validity Check

### Required Plugin Structure

Based on Claude Code plugin conventions:

| Component | Required | Present | Status |
|-----------|----------|---------|--------|
| `.claude-plugin/plugin.json` | YES | YES | VALID |
| `plugin.json` has name | YES | YES ("agent-ecosystem") | VALID |
| `plugin.json` has version | YES | YES ("0.1.0") | VALID |
| Skills in `skills/*/SKILL.md` | YES | YES (14 skills) | VALID |
| Commands in `commands/*.md` | OPTIONAL | YES (15 commands) | VALID |
| Hooks defined | OPTIONAL | YES (SessionStart) | VALID |

### What's Missing for Complete Plugin

1. **Marketplace Metadata** (optional but recommended):
   - No `marketplace.json` in plugin root
   - No logo/icon file referenced

2. **Installation Test**:
   - `test-ecosystem.sh` expects files at `~/.claude/plugins/local/agent-ecosystem/`
   - Actual source is in `plugin/` directory
   - `setup-plugin.sh` should copy/symlink files

3. **TypeScript Compilation**:
   - `plugin/lib/spelunk/*.ts` files need compilation
   - No `tsconfig.json` or build script visible in plugin root
   - No compiled `.js` files visible

---

## Recommended README Updates

### Priority 1: Document Hash-Based Validation (HIGH)

Add a new section:

```markdown
## Spelunk: Smart Codebase Exploration

The spelunk system provides targeted codebase exploration with intelligent caching.

### Hash-Based Validation

Every spelunk document tracks its source files via SHA-256 hashes:

- **FRESH**: Source files unchanged, reuse existing doc
- **STALE**: Source files changed, regenerate doc
- **MISSING**: No doc exists, generate new
- **ORPHANED**: Doc exists but untracked

This enables:
- Cross-session knowledge persistence
- Automatic invalidation on code changes
- Token savings (avoid re-exploring unchanged code)
- Multi-agent doc sharing

### Staleness Index

Located at `docs/spelunk/_staleness.json`:

{json}
{
  "version": 1,
  "docs": {
    "contracts/auth.md": {
      "generated": "...",
      "source_files": { "src/auth.ts": "a1b2c3d4" }
    }
  }
}
{/json}
```

### Priority 2: Document Dashboard Feature (MEDIUM)

Add to Skills table:
```markdown
| `/dashboard` | Launch web UI for task/diff viewing |
```

Add section:
```markdown
## Dashboard

A web interface for viewing:
- Current task tree
- Git diff visualization
- Agent activity

Launch with `/dashboard` - runs at http://localhost:3847
```

### Priority 3: Fix Plugin Structure Documentation (MEDIUM)

Update the structure diagram to include:
```
commands/        # Slash command definitions
dashboard/       # Web UI (Node.js)
lib/             # TypeScript utilities
  spelunk/       # Codebase exploration library
```

### Priority 4: Document Lens System (LOW)

Add explanation of the lens abstraction and how agents use different lenses for their specific needs.

---

## Files Referenced

| File | Purpose |
|------|---------|
| `/Users/chrismck/tasks/claude_stuff/README.md` | Main documentation |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/spelunk/persistence.ts` | Hash computation |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/spelunk/staleness-check.ts` | FRESH/STALE logic |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/spelunk/types.ts` | Type definitions |
| `/Users/chrismck/tasks/claude_stuff/plugin/lib/spelunk/orchestrator.ts` | Main entry point |
| `/Users/chrismck/tasks/claude_stuff/plugin/skills/spelunk/SKILL.md` | Skill definition |
| `/Users/chrismck/tasks/claude_stuff/plugin/commands/dashboard.md` | Dashboard command |
| `/Users/chrismck/tasks/claude_stuff/plugin/.claude-plugin/plugin.json` | Plugin manifest |

---

## Conclusion

The README provides a good foundation but significantly under-documents the codebase. The hash-based validation system is a standout feature that deserves prominent documentation as it represents a novel approach to AI agent knowledge persistence across sessions.

The plugin structure is valid for Claude Code, though the TypeScript library compilation story needs clarification and the installation scripts may need updating to properly deploy the `lib/` directory.
