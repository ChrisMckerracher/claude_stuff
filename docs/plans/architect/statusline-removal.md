# Status Line Removal Plan

**Date:** 2026-01-11
**Status:** Draft
**Author:** Architecture Agent

---

## Objective

Remove all statusline-related code, documentation, and configuration from the codebase.

---

## Rationale

StatusLine cannot be auto-registered via `plugin.json` (unlike hooks). Users must manually configure it in `settings.json`, which plugins cannot modify. The feature requires manual setup that doesn't align with the "zero-config install" goal of the plugin.

---

## Files to DELETE

| File | Reason |
|------|--------|
| `plugin/scripts/statusline.sh` | Main implementation |
| `.worktrees/claude_stuff-mm6/plugin/scripts/statusline.sh` | Worktree copy |
| `docs/plans/architect/statusline-feature.md` | Design doc |
| `docs/plans/product/validations/statusline-feature.md` | Validation doc |
| `docs/spelunk/contracts/statusline-implementation-scope.md` | Spelunk output |
| `docs/spelunk/boundaries/statusline-config-scope.md` | Spelunk output |

---

## Files to EDIT

| File | Action |
|------|--------|
| `.claude/settings.json` | **DELETE** - entire file is statusLine config only |
| `.claude/settings.local.json` | Remove 2 Bash permission entries for statusline.sh (lines ~88, ~93) |
| `plugin/hooks/README.md` | Remove "## Status Line" section (lines 37-67) |
| `docs/plans/architect/worktree-per-task.md` | Remove statusline.sh reference |
| `plugin/commands/decompose.md` | Remove statusline example from docs |
| `docs/spelunk/_staleness.json` | Remove statusline entries |

---

## Implementation Tasks

1. Delete 6 files entirely
2. Delete `.claude/settings.json`
3. Edit 5 files to remove statusline sections
4. Remove worktree via `git worktree remove .worktrees/claude_stuff-mm6`

---

## Next Steps

Await user approval, then spawn Coding Agent to execute removal.
