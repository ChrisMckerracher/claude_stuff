# Spelunk Documentation Index

This index tracks all generated spelunk documentation.

## Lens Directories

| Lens | Purpose | Docs |
|------|---------|------|
| `contracts/` | Interfaces and contracts between components | [verify-cycle-analysis](contracts/verify-cycle-analysis.md), [mcp-tool-name-validation](contracts/mcp-tool-name-validation.md), [claude-bus-worker-registration](contracts/claude-bus-worker-registration.md) |
| `boundaries/` | Module exports, dependencies, communication patterns | [scripts-analysis](boundaries/scripts-analysis.md), [hooks-analysis](boundaries/hooks-analysis.md), [verify-cycle-analysis](boundaries/verify-cycle-analysis.md) |
| `flows/` | Execution paths and data flow | [codebase-overview](flows/codebase-overview.md), [register-worker-call-flow](flows/register-worker-call-flow.md) |

## Recent Spelunk Runs

| Doc | Generated | Focus Area |
|-----|-----------|------------|
| flows/register-worker-call-flow.md | 2026-01-17 | register_worker call flow from Claude Code to MCP server |
| contracts/mcp-tool-name-validation.md | 2026-01-17 | Zod schema validation for name parameter in worker tools |
| contracts/verify-cycle-analysis.md | 2026-01-15 | Review agent, skill/command system, git diff patterns |
| boundaries/verify-cycle-analysis.md | 2026-01-15 | Plugin structure, component relationships |
| flows/codebase-overview.md | 2026-01-10 | High-level architecture |
| boundaries/scripts-analysis.md | 2026-01-10 | scripts/ directory |
| boundaries/hooks-analysis.md | 2026-01-11 | hooks/ directory |

## Staleness Tracking

See `_staleness.json` for source file hashes and generation timestamps.

**Status values:**
- **FRESH**: Doc exists and all source files unchanged
- **STALE**: Doc exists but source files changed
- **MISSING**: No doc exists for this lens+focus
- **ORPHANED**: Doc exists but not tracked in staleness index
