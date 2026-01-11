# Make Plugin Remotely Installable

**Product brief:** Enable users to install agent-ecosystem via `/plugin install` command
**Date:** 2026-01-10
**Status:** DRAFT

## Goal

Convert the agent-ecosystem plugin from local symlink installation to a remotely installable plugin that users can install directly from GitHub using Claude Code's `/plugin` command.

## Background

Currently, installation requires:
1. Cloning the repository
2. Running `./scripts/install-ecosystem.sh`
3. Manually editing `~/.claude/settings.json`

This is friction-heavy. Claude Code supports direct installation from Git repositories and marketplaces, which would reduce installation to a single command.

**Reference:** [Claude Code Plugins Docs](https://code.claude.com/docs/en/plugins)

## Approach

Implement both installation methods:

1. **Direct Git Install** - `/plugin install https://github.com/ChrisMckerracher/claude_stuff`
2. **Marketplace Install** - `/plugin install agent-ecosystem@agent-ecosystem-marketplace`

### Key Changes

1. Add `marketplace.json` at repo root for marketplace discovery
2. Enhance `plugin.json` with full metadata (repository, license, engines)
3. Update README with new installation instructions
4. Test both installation methods

## Design

### 1. Marketplace Manifest (NEW FILE)

**Location:** `.claude-plugin/marketplace.json` (repo root)

```json
{
  "name": "agent-ecosystem-marketplace",
  "owner": {
    "name": "ChrisMckerracher",
    "email": "chris@example.com"
  },
  "metadata": {
    "description": "Specialized agents, merge tree workflows, and invisible task tracking for Claude Code",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "agent-ecosystem",
      "description": "7 specialist agents with merge tree workflows and spelunk exploration",
      "version": "0.1.0",
      "author": { "name": "chrismck" },
      "source": "./plugin",
      "category": "productivity",
      "tags": ["agents", "beads", "merge-tree", "tdd", "workflow", "spelunk", "orchestrator"]
    }
  ]
}
```

### 2. Enhanced Plugin Manifest (UPDATE)

**Location:** `plugin/.claude-plugin/plugin.json`

```json
{
  "name": "agent-ecosystem",
  "description": "7 specialist agents with merge tree workflows and invisible task tracking",
  "version": "0.1.0",
  "author": {
    "name": "chrismck"
  },
  "license": "MIT",
  "repository": "https://github.com/ChrisMckerracher/claude_stuff",
  "homepage": "https://github.com/ChrisMckerracher/claude_stuff#readme",
  "keywords": ["agents", "beads", "merge-tree", "tdd", "workflow", "spelunk", "orchestrator"],
  "engines": {
    "claude-code": ">=1.0.0"
  },
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

### 3. README Installation Section (UPDATE)

Replace current installation section with:

```markdown
## Installation

### Quick Install (Recommended)

```bash
# In Claude Code, run:
/plugin install https://github.com/ChrisMckerracher/claude_stuff
```

### Marketplace Install

```bash
# Add the marketplace
/plugin marketplace add ChrisMckerracher/claude_stuff

# Install the plugin
/plugin install agent-ecosystem@agent-ecosystem-marketplace
```

### Manual Install (Development)

For local development or contributing:

```bash
git clone git@github.com:ChrisMckerracher/claude_stuff.git
cd claude_stuff
./scripts/install-ecosystem.sh
```

### Verify Installation

```bash
/help  # Should show agent-ecosystem commands
```
```

### 4. Directory Structure Change

```
claude_stuff/                         # Repo root
├── .claude-plugin/                   # NEW: Repo-level plugin directory
│   └── marketplace.json              # NEW: Marketplace manifest
├── plugin/                           # Existing plugin directory
│   ├── .claude-plugin/
│   │   └── plugin.json               # UPDATED: Enhanced metadata
│   └── ...
└── README.md                         # UPDATED: New installation instructions
```

## Alternatives Considered

### A. Move plugin to repo root
- **Pro:** Simpler structure, direct `/plugin install` works
- **Con:** Breaks existing local installs, mixes plugin with repo files
- **Decision:** Keep `plugin/` subdirectory, use marketplace `source` field

### B. Publish to official Anthropic marketplace
- **Pro:** Higher visibility, official endorsement
- **Con:** Requires Anthropic review/approval, slower iteration
- **Decision:** Self-host marketplace first, consider official later

### C. Create separate repo for plugin only
- **Pro:** Cleaner separation
- **Con:** Splits development, harder to maintain
- **Decision:** Keep monorepo with marketplace pointing to `./plugin`

## Task Breakdown

| Task | Blocks | Description | Est. Lines |
|------|--------|-------------|------------|
| 1. Create marketplace.json | none | Add `.claude-plugin/marketplace.json` at repo root | 20 |
| 2. Enhance plugin.json | none | Add repository, license, engines, homepage fields | 10 |
| 3. Update README installation | 1, 2 | Replace installation section with new methods | 30 |
| 4. Test direct git install | 1, 2 | Verify `/plugin install <github-url>` works | - |
| 5. Test marketplace install | 1, 2 | Verify marketplace add + install works | - |

**Total:** ~60 lines changed, 2 test tasks

## Success Criteria

- [ ] `/plugin install https://github.com/ChrisMckerracher/claude_stuff` works
- [ ] `/plugin marketplace add ChrisMckerracher/claude_stuff` succeeds
- [ ] `/plugin install agent-ecosystem@agent-ecosystem-marketplace` works
- [ ] Existing local symlink installation still works
- [ ] README documents all installation methods
- [ ] `/help` shows agent-ecosystem commands after install

## Dependencies

- beads CLI must still be installed separately (documented in README)
- Node.js 18+ for dashboard functionality

## Risks

| Risk | Mitigation |
|------|------------|
| Claude Code doesn't follow `source: ./plugin` | Test early, adjust structure if needed |
| Hooks don't work with remote install | Document manual hook setup as fallback |
| Breaking existing local installs | Keep install-ecosystem.sh working |

---

**Next:** Awaiting Product validation before decomposition
