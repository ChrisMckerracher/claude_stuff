# Hooks JSON Fix Validation Report

**Design reviewed:** `docs/plans/architect/hooks-json-fix.md`
**Date:** 2026-01-11
**Status:** APPROVED

---

## Checklist

- [x] Clear problem statement
- [x] Solution addresses problem directly
- [x] No unnecessary features (YAGNI)
- [x] User value is clear
- [x] Success criteria defined

---

## Findings

### Aligned with Product Goals

1. **Hooks should "just work" for users** - The design directly addresses this by moving hook configuration to `hooks/hooks.json`, matching the pattern used by 100% of working Anthropic plugins. Users installing the plugin will get SessionStart hooks working automatically without manual configuration.

2. **Minimal configuration burden** - The solution eliminates the need for users to manually copy hook configurations to `~/.claude/settings.json` for the SessionStart hook. This matches user expectations from other plugins.

3. **Evidence-based approach** - The design is grounded in empirical analysis of 5 official Anthropic plugins (security-guidance, learning-output-style, explanatory-output-style, ralph-loop, hookify), all of which use `hooks/hooks.json`. This is the established pattern.

4. **Clear success criteria** - The verification plan is concrete and testable: reinstall plugin, start session, verify message appears.

### Security Hook Opt-in Decision: APPROPRIATE

The design correctly keeps the `PreToolUse` security hook as manual opt-in. This is the right product decision for several reasons:

| Factor | Analysis |
|--------|----------|
| **Scope of impact** | Runs on ALL Bash commands, not just git push |
| **Performance** | Adds latency to every bash tool use |
| **User surprise** | Auto-enabling invasive scanning violates least astonishment |
| **Security theater risk** | Users might falsely assume they're protected when they haven't configured it |
| **Power user pattern** | Security-conscious users will explicitly enable it; casual users won't be slowed down |

This mirrors how other successful plugins handle invasive features - auto-enable the helpful, opt-in the intrusive.

### User Experience Assessment

**Positive UX aspects:**

1. **Silent success** - SessionStart hook fires automatically, user sees "Project has beads task tracking" message seamlessly
2. **Progressive disclosure** - Basic functionality works out of box; advanced security is opt-in with clear documentation
3. **No regression risk** - Existing manual configurations will continue to work alongside plugin hooks
4. **Familiar pattern** - Users who've installed other Claude Code plugins will find this behavior expected

**Potential UX concern (minor):**

- The README update should be explicit about WHY the security hook is opt-in. The current design mentions "invasive" but could frame it more positively: "For users who want additional security scanning, add the following to your settings.json..."

### Alignment with Industry Patterns

Per [Claude Code documentation](https://code.claude.com/docs/en/hooks) and [plugin structure guidelines](https://claude-plugins.dev/skills/@anthropics/claude-plugins-official/plugin-structure):

1. **`hooks/hooks.json` is the canonical location** - Plugin hooks belong in this file, not inline in plugin.json. The design correctly identifies this.

2. **`${CLAUDE_PLUGIN_ROOT}` variable** - The design uses the correct environment variable pattern for portable paths.

3. **Matcher pattern** - Using `"startup|resume|clear|compact"` matches the superpowers plugin pattern, which is known working.

4. **Description field** - The design includes a description field, which is a best practice for plugin hooks.

---

## Concerns

### Minor: README Documentation Tone

The design mentions updating README to clarify that PreToolUse "requires manual settings.json configuration (opt-in)". The framing should be user-positive rather than implementation-focused.

**Current implied framing:**
> "This hook isn't auto-registered because it's invasive"

**Recommended framing:**
> "The security scanning hook is available for users who want additional protection. To enable: [configuration steps]"

This is a documentation polish item, not a design flaw.

---

## Scope Creep Flags

- None identified. The scope is appropriately minimal: ~30 lines across 3 files.

---

## Recommendation

**APPROVED**

The design correctly solves the problem (hooks not firing) by moving configuration to the canonical location (`hooks/hooks.json`). The decision to keep security hooks as opt-in is the right product call - it balances "just works" for basic functionality against "don't slow everyone down" for invasive features.

The solution follows established patterns from official Anthropic plugins and Claude Code documentation. Implementation can proceed.

---

## Sources

- [Hooks reference - Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Plugin Structure - Claude Skills](https://claude-plugins.dev/skills/@anthropics/claude-plugins-official/plugin-structure)
- [Claude Code Hooks Complete Guide - SmartScope](https://smartscope.blog/en/generative-ai/claude/claude-code-hooks-guide/)
