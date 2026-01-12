# Status Line Feature Validation Report

**Design reviewed:** `docs/plans/architect/statusline-feature.md`
**Date:** 2026-01-11
**Status:** APPROVED

---

## User Request Summary

> "I want to see my task count and session info at a glance without asking Claude."

The user's original request was to have a **status line that shows task information directly in the terminal** when Claude starts, rather than having the information passed to Claude's context (which requires asking Claude to relay it).

---

## Validation Checklist

- [x] Clear problem statement
- [x] Solution addresses problem directly
- [x] No unnecessary features (YAGNI)
- [x] User value is clear
- [x] Success criteria defined

---

## Findings

### Aligned with Product Goals

1. **Direct visibility solves the core problem.** The current SessionStart hook outputs task count to Claude's context, meaning users must ask Claude "how many tasks?" to get the information. The status line displays this information **directly in the terminal** where users can see it at a glance. This directly addresses the user's stated need.

2. **Chosen components match user request.** The display format `[Opus] $0.42 | master | 3 tasks` includes:
   - Model name (session awareness)
   - Session cost (spend tracking)
   - Git branch (context)
   - Task count (the primary requested feature)

3. **Graceful fallbacks maintain usability.** When beads is not initialized or git is unavailable, the status line shows "-" rather than erroring. This ensures the feature works across different project states.

4. **Low friction implementation.** Option A (simple bash script) requires only `jq` and `bd`, both already dependencies of the plugin. No new runtime dependencies introduced.

5. **Integration with existing patterns.** Uses the same `bd ready --json` pattern as the SessionStart hook, maintaining consistency and leveraging proven infrastructure.

### Concerns

1. **Minor: Windows support unclear.** Design notes Windows truncation issue #12870 and recommends "<80 chars" mitigation. The design explicitly documents Windows as "untested" which is acceptable for an MVP, but should be revisited if Windows users report issues.

2. **Minor: Session cost not updating on `/resume`.** This is a known Claude Code limitation, not a design flaw. The design acknowledges it and suggests displaying "N/A" which is appropriate.

### Scope Creep Flags

- None detected. The design is appropriately scoped to a single status line script with 4 components. The recommendation to "upgrade to ccstatusline if users want advanced features" appropriately defers scope expansion to future requests.

---

## Product Analysis

### Problem Validation

| Aspect | Assessment |
|--------|------------|
| Problem is real | YES - Users cannot see session state without asking Claude |
| Problem is specific | YES - Task count visibility specifically |
| Existing workarounds | LIMITED - `/visualize` requires explicit invocation |

### Solution Fit

| Aspect | Assessment |
|--------|------------|
| Solves stated problem | YES - Status line provides persistent visibility |
| Minimal viable scope | YES - 4 components, single script |
| Uses existing infrastructure | YES - `bd ready --json`, Claude Code statusLine config |
| Respects user attention | YES - Single line, non-intrusive, glanceable format |

### Relationship to SessionStart Hook

The design correctly identifies that SessionStart and status line are **complementary**, not competing:

| Component | Channel | Purpose |
|-----------|---------|---------|
| SessionStart hook | Claude context | Informs Claude about project state |
| Status line | Terminal display | Informs user about session state |

This dual-channel approach is sound product design.

---

## Recommendation

**APPROVED** - Proceed to decomposition and implementation.

The design meets the user's stated need with a minimal, well-scoped solution. The bash script approach is appropriate for MVP, with a clear upgrade path to community tools if richer features are needed.

### Suggested minor enhancements (optional)

1. Consider adding a `--no-beads` graceful mode for users who want status line without task tracking
2. Document expected update latency (300ms minimum per Claude Code throttling)

---

## Next Steps

1. Decompose into implementation tasks via `/decompose`
2. Implement status line script
3. Add configuration to plugin
4. Update README with status line documentation

---

## References

- User request: "I want to see my task count and session info at a glance"
- Design: `docs/plans/architect/statusline-feature.md`
- Related: `docs/plans/architect/session-start-hook-investigation.md` (context on why SessionStart alone is insufficient)
- Spelunk: `docs/spelunk/boundaries/hooks-analysis.md`
