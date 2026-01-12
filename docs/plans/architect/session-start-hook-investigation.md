# Session Start Hook Investigation

**Date:** 2026-01-11
**Issue:** SessionStart hook not firing on Claude startup
**Status:** Root cause identified

---

## Executive Summary

The SessionStart hook is likely NOT firing due to a **known Claude Code bug** affecting plugins installed from GitHub marketplaces. The hook code itself is correct—the issue is in Claude Code's async marketplace loading.

---

## Investigation Findings

### 1. Hook Implementation: CORRECT ✓

The `session-start.sh` script is correctly implemented:
- Reads JSON from stdin (correct Claude hook protocol)
- Extracts `cwd` from input
- Checks for `.beads` directory
- Outputs ready task count
- Always exits 0 (non-blocking)

### 2. Plugin.json Registration: CORRECT ✓

The hook is properly registered in `plugin/.claude-plugin/plugin.json`:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

### 3. Event Name: CORRECT ✓

`SessionStart` is a valid Claude Code hook event (PascalCase format is correct).

---

## Root Cause: Claude Code Bug #10997

**GitHub Issue:** [SessionStart hooks don't execute on first run with GitHub marketplace plugins](https://github.com/anthropics/claude-code/issues/10997)

### The Bug

SessionStart hooks fail to execute on the **first run** when plugins are loaded from GitHub marketplaces via `extraKnownMarketplaces`. Works on subsequent runs.

### Race Condition

```
FIRST RUN:
1. Settings loaded
2. Marketplace fetch begins (async GitHub download)
3. SessionStart hooks fire → PLUGINS NOT YET LOADED ❌
4. Marketplace fetch completes (too late)

SUBSEQUENT RUNS:
1. Settings loaded
2. Cached marketplace loads (instant, synchronous)
3. Plugins registered
4. SessionStart hooks fire → WORKS ✓
```

### Issue Status

Closed as "NOT PLANNED" (2026-01-09). No official fix or workaround documented.

---

## Diagnosis Questions

To confirm this is the bug, check:

| Question | If YES | If NO |
|----------|--------|-------|
| Is this the first run after plugin install? | Likely bug #10997 | Different issue |
| Does hook work on second/third run? | Confirmed bug #10997 | Different issue |
| Plugin installed via `/plugin install`? | Susceptible to bug | Different path |
| Using `extraKnownMarketplaces`? | Susceptible to bug | May not apply |

---

## Workaround Options

### Option A: Manual settings.json Hook (Recommended)

Bypass plugin hook registration entirely. Add hook directly to user's `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

This uses a fixed path rather than `${CLAUDE_PLUGIN_ROOT}`, ensuring the hook is registered at settings load time (before marketplace async fetch).

### Option B: Local Plugin Install

Use local plugin installation (via `scripts/install-ecosystem.sh`) instead of marketplace. Local plugins don't have the async loading race condition.

### Option C: Run Claude Twice

Accept that first run won't have hooks. Second run will work. (Not a great UX.)

### Option D: Wait for Fix

Monitor Claude Code releases for a fix to the race condition. Since issue was closed "NOT PLANNED", this may require re-opening with more evidence.

---

## Recommendations

### Immediate

1. **Document the bug** in README.md under "Known Issues"
2. **Provide manual hook config** in README as the workaround
3. **Test locally** by installing plugin, running claude once, then again

### Medium Term

1. **Re-open issue #10997** with clear reproduction steps if this is confirmed
2. Consider shipping a **project-level `.claude/settings.json`** template that includes hooks

### Long Term

1. Wait for Claude Code to fix the async marketplace loading
2. Once fixed, hooks in plugin.json will work as designed

---

## Sources

- [SessionStart hooks don't execute on first run with GitHub marketplace plugins - Issue #10997](https://github.com/anthropics/claude-code/issues/10997)
- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Feature Request: SessionStart and SessionEnd Lifecycle Hooks - Issue #4318](https://github.com/anthropics/claude-code/issues/4318)
- Internal spelunk: `docs/spelunk/boundaries/hooks-analysis.md`

---

## Summary

| Aspect | Status |
|--------|--------|
| Hook script | ✓ Correct |
| plugin.json registration | ✓ Correct |
| Event name | ✓ Correct |
| **Claude Code behavior** | **❌ Bug #10997** |

**Action Required:** Use workaround Option A (manual settings.json) until Claude Code fixes async marketplace loading.
