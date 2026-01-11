# Scripts Directory Analysis

**Lens:** boundaries, interfaces
**Focus:** scripts/
**Generated:** 2026-01-10
**For:** Architect Agent

---

## Executive Summary

The `scripts/` directory contains 4 bash scripts originally created for local plugin development and testing. Now that `/plugin install` from remote URL is the primary installation method (as documented in README.md), most scripts serve only development/contributor use cases.

**Recommendation:** Keep 1 script, mark 2 as development-only, deprecate 1.

---

## Script Inventory

| Script | Lines | Purpose | Status |
|--------|-------|---------|--------|
| `cleanup-plugin.sh` | 77 | Remove plugin for fresh install testing | **KEEP (dev)** |
| `install-ecosystem.sh` | 121 | Full install: beads + plugin setup | **KEEP (dev)** |
| `setup-plugin.sh` | 159 | Create plugin structure, copy files, configure settings | **REDUNDANT** |
| `test-ecosystem.sh` | 137 | Verify installation completeness | **KEEP** |

---

## Detailed Analysis

### 1. cleanup-plugin.sh

**What it does:**
- Removes `~/.claude/plugins/local/` directory
- Removes `~/.claude/plugins/cache/local/` cache
- Uses `jq` to clean settings.json (removes `extraKnownMarketplaces.local` and `enabledPlugins["agent-ecosystem@local"]`)

**Use case:** Development testing - reset to clean state before re-testing install

**Assessment:** KEEP for development. Not needed by end users who use `/plugin install`.

---

### 2. install-ecosystem.sh

**What it does:**
1. Checks prerequisites (git, claude CLI)
2. Installs beads via npm, go, or curl script
3. Calls `setup-plugin.sh` to create plugin structure

**Header note:** Already marked "DEVELOPMENT/CONTRIBUTING ONLY" with reference to `/plugin install` as primary method.

**Assessment:** KEEP for contributors. Correctly documented as secondary path.

---

### 3. setup-plugin.sh

**What it does:**
1. Creates marketplace structure at `~/.claude/plugins/local/`
2. Copies `plugin/agents/`, `plugin/skills/`, `plugin/hooks/`, etc. to local marketplace
3. Configures `~/.claude/settings.json` with marketplace and enabledPlugins entries

**Problem:** This is called by `install-ecosystem.sh`, duplicating the "local marketplace" pattern. When users run `/plugin install https://github.com/...`, none of this is needed - Claude Code handles installation directly.

**Assessment:** REDUNDANT with `/plugin install`. Only needed if `install-ecosystem.sh` is used. Consider merging into `install-ecosystem.sh` or marking as internal.

---

### 4. test-ecosystem.sh

**What it does:**
Validates installation by checking:
- `bd` (beads) is installed
- Plugin directory exists at `~/.claude/plugins/local/agent-ecosystem/`
- All 7 agent files exist
- All 13 skill files exist
- All 2 hooks exist and are executable
- All 2 templates exist
- All 14 command files exist

**Assessment:** KEEP. Useful for both development and troubleshooting user installs.

**Note:** Hardcoded path `~/.claude/plugins/local/agent-ecosystem/` assumes local install, not remote plugin install. May need update to support validating remote installs.

---

## Recommendations

### Immediate Actions

1. **Deprecate `setup-plugin.sh`** - Merge its functionality into `install-ecosystem.sh` or delete entirely. It only serves the local marketplace pattern which is secondary to `/plugin install`.

2. **Update README.md Scripts table:**
   - Current table says "install-ecosystem.sh: Full installation (beads + plugin)"
   - Should clarify this is for development/contributing only

3. **Update `test-ecosystem.sh`** - Add support for detecting and validating remote plugin installs (different paths).

### Optional Cleanup

4. **Consolidate to 2 scripts:**
   - `dev-install.sh` - combines install-ecosystem + setup-plugin (for contributors)
   - `test-install.sh` - validates any install method (local or remote)

5. **Add `cleanup-plugin.sh` note** - Mark as development-only in header comment

---

## Scripts Boundary Map

```
User Install Path (PRIMARY):
  /plugin install https://... --> Claude Code handles everything
                                   (no scripts needed)

Developer Install Path:
  install-ecosystem.sh
       |
       +--> checks prerequisites
       +--> installs beads
       +--> calls setup-plugin.sh
                  |
                  +--> creates ~/.claude/plugins/local/
                  +--> copies plugin content
                  +--> configures settings.json

Testing:
  test-ecosystem.sh --> validates installation
  cleanup-plugin.sh --> removes for fresh testing
```

---

## Source Files Analyzed

| File | Hash |
|------|------|
| scripts/cleanup-plugin.sh | 29207c7a |
| scripts/install-ecosystem.sh | 3b3c1d8a |
| scripts/setup-plugin.sh | 6c194ff4 |
| scripts/test-ecosystem.sh | 162c1bed |

---

## Summary Table

| Script | Still Needed? | For Whom | Action |
|--------|--------------|----------|--------|
| cleanup-plugin.sh | Yes | Developers | Keep, add header note |
| install-ecosystem.sh | Yes | Contributors | Keep as-is (already marked dev-only) |
| setup-plugin.sh | No | N/A | Merge into install-ecosystem.sh or delete |
| test-ecosystem.sh | Yes | Everyone | Keep, update for remote install paths |
