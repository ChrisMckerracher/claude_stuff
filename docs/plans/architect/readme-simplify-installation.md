# Simplify README Installation Section

**Date:** 2026-01-10
**Status:** APPROVED (trivial cleanup, no product validation needed)

## Goal

Remove obsolete local installation references now that remote `/plugin install` is the primary method.

## Changes

### README.md Installation Section

**BEFORE (current - 55 lines):**
- Quick Install
- Marketplace Install
- Manual Install (Development) ← REMOVE
- Enable the Plugin ← REMOVE
- Verify Installation
- Beads note

**AFTER (target - ~25 lines):**
```markdown
## Installation

### Quick Install (Recommended)

In Claude Code, run:

```bash
/plugin install https://github.com/ChrisMckerracher/claude_stuff
```

### Alternative: Marketplace Install

```bash
/plugin marketplace add ChrisMckerracher/claude_stuff
/plugin install agent-ecosystem@agent-ecosystem-marketplace
```

### Verify

```bash
/help  # Should show agent-ecosystem commands
```

### Dependencies

The [beads](https://github.com/steveyegge/beads) CLI is required for task tracking:

```bash
go install github.com/steveyegge/beads/cmd/bd@latest
```
```

### Other Files to Update

1. **Delete or archive `scripts/install-ecosystem.sh`** - No longer primary install method
2. **Delete or archive `scripts/setup-plugin.sh`** - Same reason
3. **Update any CONTRIBUTING.md** if it exists - Move local dev setup there if needed

## Rationale

- Remote install is now the standard
- Local symlink install adds confusion
- `@local` enabledPlugins key doesn't apply to remote installs
- Simpler docs = better UX

## Task

Single task - straightforward README edit + optional script cleanup.
