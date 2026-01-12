# Design: Fix SessionStart Hook Registration

**Date:** 2026-01-11
**Status:** Pending Validation
**Author:** Architecture Agent

---

## Problem Statement

The SessionStart hook is not firing on Claude startup. Investigation revealed the hook configuration is in the wrong file location.

## Root Cause Analysis

### Evidence from Official Anthropic Plugins

All 5 official plugins with hooks use `hooks/hooks.json`:

| Plugin | `hooks/hooks.json` | `plugin.json` hooks |
|--------|-------------------|---------------------|
| security-guidance | YES | No |
| learning-output-style | YES | No |
| explanatory-output-style | YES | No |
| ralph-loop | YES | No |
| hookify | YES | No |

### Current State (Broken)

```
plugin/
├── .claude-plugin/
│   └── plugin.json      ← Contains hooks (IGNORED by Claude Code)
└── hooks/
    ├── README.md
    ├── session-start.sh
    └── pre-push-security.sh
                         ← NO hooks.json file!
```

### Target State (Working)

```
plugin/
├── .claude-plugin/
│   └── plugin.json      ← No hooks field
└── hooks/
    ├── hooks.json       ← NEW: Hook configuration here
    ├── README.md
    ├── session-start.sh
    └── pre-push-security.sh
```

## Proposed Solution

### 1. Create `plugin/hooks/hooks.json`

```json
{
  "description": "Agent ecosystem session and security hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
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

**Note:** The `PreToolUse` security hook is intentionally omitted from plugin registration. Per existing README documentation, it requires manual opt-in by users who want security scanning on all Bash commands.

### 2. Remove hooks from `plugin/.claude-plugin/plugin.json`

Remove the entire `hooks` object from plugin.json, leaving only metadata fields.

### 3. Update `plugin/hooks/README.md`

Clarify that:
- SessionStart hook is auto-registered via plugin
- PreToolUse security hook requires manual settings.json configuration (opt-in)

## Design Rationale

### Why `hooks/hooks.json` instead of inline in `plugin.json`?

1. **Empirical evidence**: 100% of working Anthropic plugins use this pattern
2. **Documentation states both work**: But only `hooks/hooks.json` works in practice
3. **Separation of concerns**: Metadata in plugin.json, behavior in hooks.json

### Why `matcher: "startup|resume|clear|compact"`?

Copied from superpowers plugin (known working). Ensures hook fires for all session start scenarios.

### Why exclude PreToolUse from plugin hooks?

The pre-push-security.sh hook runs on ALL Bash commands. This is invasive and should be user opt-in, not auto-enabled by plugin installation.

## Verification Plan

1. Make changes to source repo
2. Reinstall plugin: `/plugin update agent-ecosystem`
3. Start new Claude session
4. Verify "Project has beads task tracking" message appears

## Cross-References

### Official Documentation
- [Plugins reference - Claude Code Docs](https://code.claude.com/docs/en/plugins-reference)
- [Plugin Structure - Claude Skills](https://claude-plugins.dev/skills/@anthropics/claude-plugins-official/plugin-structure)
- [Hook Development - Claude Skills](https://claude-plugins.dev/skills/@anthropics/claude-plugins-official/hook-development)

### Local Evidence
- `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/security-guidance/hooks/hooks.json`
- `~/.claude/plugins/cache/superpowers-marketplace/superpowers/4.0.3/hooks/hooks.json`

### Internal Spelunk
- `docs/spelunk/boundaries/hooks-analysis.md`
- `docs/plans/architect/session-start-hook-investigation.md`

## Implementation Scope

| Change | File | Lines |
|--------|------|-------|
| Create | `plugin/hooks/hooks.json` | ~15 |
| Edit | `plugin/.claude-plugin/plugin.json` | -10 |
| Edit | `plugin/hooks/README.md` | ~5 |

**Total: ~30 lines** - Single task, no decomposition needed.

## Success Criteria

1. SessionStart hook fires on first Claude session after plugin install
2. SessionStart hook fires on subsequent sessions
3. "Project has beads task tracking" message visible when `.beads` directory exists
4. No regression in other plugin functionality
