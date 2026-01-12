# Status Line Feature Design

**Date:** 2026-01-11
**Status:** Draft - Pending Product Validation
**Author:** Architecture Agent

---

## Executive Summary

Add a custom Claude Code status line that displays real-time session information at the bottom of the terminal: model name, session cost, git branch, and beads task count. This provides persistent visibility into session state without requiring Claude to relay information.

---

## Problem Statement

Currently, the SessionStart hook reports beads task count to Claude's context, but this information is not directly visible to the user. Users must ask Claude or use `/visualize` to see task status.

**User Need:** "I want to see my task count and session info at a glance without asking Claude."

---

## Proposed Solution

Implement a custom status line script that integrates with Claude Code's native `statusLine` configuration.

### Display Format

```
[Opus] $0.42 | master | 3 tasks
```

| Component | Source | Update Frequency |
|-----------|--------|------------------|
| Model name | JSON stdin `.model.display_name` | Per message |
| Session cost | JSON stdin `.cost.total_cost_usd` | Per message |
| Git branch | `git branch --show-current` | Per message |
| Task count | `bd ready --json \| jq length` | Per message |

---

## Feasibility Assessment

### Overall: HIGH FEASIBILITY

This is a well-supported feature with multiple community implementations demonstrating viability.

### Data Availability

| Field | Available | Source |
|-------|-----------|--------|
| Model name | YES | Native JSON stdin |
| Session cost | YES | Native JSON stdin |
| Git branch | YES | Shell command |
| Beads task count | YES | `bd` CLI (existing pattern in session-start.sh) |

### Community Validation

| Project | Features | Link |
|---------|----------|------|
| ccstatusline | 30+ widgets, powerline, multi-line | [GitHub](https://github.com/sirmalloc/ccstatusline) |
| claude-code-statusline | 18 components, themes, burn rate | [GitHub](https://github.com/rz1989s/claude-code-statusline) |
| Oh My Posh integration | Terminal prompt integration | [Blog](https://dev.to/jandedobbeleer/oh-my-posh-claude-code-66f) |

---

## Known Issues and Gotchas

### Platform Issues

| Platform | Issue | Severity | Mitigation |
|----------|-------|----------|------------|
| Windows | Output truncation ([#12870](https://github.com/anthropics/claude-code/issues/12870)) | Medium | Keep line <80 chars |
| macOS | Config sometimes ignored ([#17020](https://github.com/anthropics/claude-code/issues/17020)) | Medium | Verify on current version |

### Performance Considerations

| Concern | Risk | Mitigation |
|---------|------|------------|
| `bd ready` latency | Low | Beads uses local JSONL, should be fast |
| Update frequency | Low | Claude Code throttles to 300ms minimum |
| Git command overhead | Low | Single branch name lookup is fast |

### Configuration Gotchas

| Issue | Details | Solution |
|-------|---------|----------|
| Plugin hooks race condition | Bug #10997 affects plugin-registered hooks | Use project `.claude/settings.json` |
| Session cost not updating on `/resume` | Known Claude Code limitation | Accept or display "N/A" on resume |

---

## Implementation Approach

### Option A: Simple Bash Script (Recommended)

**Pros:** No dependencies beyond jq and bd, easy to debug, portable
**Cons:** No advanced formatting or caching

```bash
#!/bin/bash
input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // "."')

BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null || echo "-")

if [ -d "$CWD/.beads" ]; then
  TASKS=$(cd "$CWD" && bd ready --json 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
else
  TASKS="-"
fi

printf "[%s] \$%.2f | %s | %s tasks" "$MODEL" "$COST" "$BRANCH" "$TASKS"
```

### Option B: Use ccstatusline

**Pros:** Rich formatting, themes, caching, multi-line support
**Cons:** Requires Bun/Node.js, more complex setup, external dependency

### Recommendation

Start with Option A for MVP. Upgrade to ccstatusline if users want advanced features.

---

## Integration Points

### Relationship to SessionStart Hook

| Component | Purpose | Data |
|-----------|---------|------|
| SessionStart hook | One-time startup notification | Task count → Claude context |
| Status line | Continuous display | Task count → terminal display |

Both use `bd ready --json` - consistent pattern.

### Configuration Location

Due to bug #10997 affecting plugin hooks, the status line should be configured in:

**Project-level:** `.claude/settings.json`
```json
{
  "statusLine": {
    "type": "command",
    "command": "./plugin/scripts/statusline.sh"
  }
}
```

**Or user-level:** `~/.claude/settings.json`
```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh"
  }
}
```

---

## File Locations

| File | Purpose |
|------|---------|
| `plugin/scripts/statusline.sh` | Status line script (bundled with plugin) |
| `.claude/settings.json` | Project configuration enabling status line |
| `plugin/hooks/README.md` | Updated documentation |

---

## Testing Plan

| Test Case | Expected Result |
|-----------|-----------------|
| No .beads directory | Shows "-" for tasks |
| Empty beads (no ready tasks) | Shows "0 tasks" |
| Multiple ready tasks | Shows correct count |
| Not in git repo | Shows "-" for branch |
| Git repo with branch | Shows branch name |
| Long branch name (>20 chars) | Truncates gracefully |
| Windows terminal | No truncation under 80 chars |

---

## Alternatives Considered

### Alternative 1: Extend SessionStart Hook

Have SessionStart hook output more prominently.

**Rejected:** SessionStart output goes to Claude context, not terminal display. Fundamental limitation.

### Alternative 2: Use `/statusline` Interactive Setup

Let users run `/statusline` to auto-generate a script.

**Considered:** Could be offered as additional option, but we want a pre-configured solution for plugin users.

### Alternative 3: No Status Line

Keep current approach where users ask Claude or use `/visualize`.

**Rejected:** User explicitly requested persistent visibility.

---

## Success Criteria

1. Status line displays all 4 components correctly
2. Updates on each message without noticeable lag
3. Graceful fallbacks when git/beads not available
4. Works on macOS and Linux
5. Documentation updated

---

## Open Questions

1. **Should we bundle the script with the plugin or ask users to create it?**
   - Recommendation: Bundle with plugin for zero-config experience

2. **Should we add caching for bd ready calls?**
   - Recommendation: Not initially; monitor performance first

3. **Should we support Windows?**
   - Recommendation: Document as "untested on Windows" given known issues

---

## Next Steps

1. **Product validation** - Confirm design meets user needs
2. **Decompose into tasks** - Create beads tasks for implementation
3. **Implement** - Write script, update configs, update docs
4. **Test** - Verify on macOS/Linux with various scenarios

---

## References

- [Status line configuration - Claude Code Docs](https://code.claude.com/docs/en/statusline)
- [ccstatusline](https://github.com/sirmalloc/ccstatusline) - Community implementation
- [claude-code-statusline](https://github.com/rz1989s/claude-code-statusline) - Community implementation
- [Creating The Perfect Claude Code Status Line](https://www.aihero.dev/creating-the-perfect-claude-code-status-line)
- [StatusLine not displaying on Windows - Issue #6526](https://github.com/anthropics/claude-code/issues/6526)
- [statusLine config not working - Issue #17020](https://github.com/anthropics/claude-code/issues/17020)
- Internal: `docs/spelunk/boundaries/hooks-analysis.md`
- Internal: `docs/plans/architect/session-start-hook-investigation.md`
