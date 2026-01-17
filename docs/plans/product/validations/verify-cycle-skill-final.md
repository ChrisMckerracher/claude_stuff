# Verify Cycle Skill - Final Product Validation

**Design reviewed:** `docs/plans/architect/verify-cycle-skill.md`
**Date:** 2026-01-15
**Status:** **APPROVED**

---

## Executive Summary

The simplified verify cycle skill design is **APPROVED**. The architectural team successfully addressed all blocking issues from the previous code review by:

1. **Eliminating glob matching complexity** - LLM-based semantic relevance instead
2. **Removing dependencies** - No Node.js packages, no YAML parsers
3. **Simplifying rigor levels** - Two types: automated (has `Run:`) vs manual (no `Run:`)
4. **Plain markdown format** - No YAML frontmatter, parse `Run:` and `When:` from content
5. **No context-dependent behavior** - Manual cycles always show same note

The design is now elegant, achievable, and aligned with product goals.

---

## Validation Checklist

| Criterion | Status | Notes |
|-----------|--------|-------|
| Clear problem statement | Yes | Project-specific feedback loops |
| Solution addresses problem directly | Yes | LLM semantic matching is elegant |
| No unnecessary features (YAGNI) | Yes | Removed glob complexity |
| User value is clear | Yes | Custom quality checks beyond generic review |
| Success criteria defined | Yes | Zero dependencies, simple format |

---

## Findings

### Aligned with Product Goals

**1. Solves the Original Problem**

The design directly addresses the need for project-specific verification cycles:
- Teams can define custom quality checks ("homepage loads < 2s")
- Checks run automatically during code review
- No need to modify CLAUDE.md or generic review rules

**2. User Experience is Intuitive**

Plain markdown format is excellent:

```markdown
# Homepage Performance Check

Run: npm run lighthouse
When: Homepage or landing page changes

Verify homepage loads in < 2s on fast-3g.
```

- **No syntax to learn** - Just write what you mean
- **No YAML to debug** - Frontmatter removed
- **Obvious automation** - `Run:` line = automated, no `Run:` = manual

**3. Integration Approach is Sound**

The "review agent runs cycles" model is correct:
- Leverages existing `coder -> review` workflow
- No new workflow steps or triggers
- Review Agent already has authority to block merge
- Single point of integration (one file change: `plugin/agents/code-review.md`)

**4. Zero Dependencies is Major Win**

Removing all package dependencies:
- No `npm install` required
- Works in any environment with Claude Code
- Faster onboarding
- Less maintenance burden

### Strengths of Simplified Design

| Aspect | Previous Design | Simplified Design | Benefit |
|--------|----------------|-------------------|---------|
| File matching | Glob patterns with minimatch | LLM semantic reasoning | No dependency, smarter filtering |
| Format | YAML frontmatter | Plain markdown | Simpler, no parsing |
| Rigor levels | 5 levels (automated, semi-automated, manual, etc.) | 2 types (has `Run:` or not) | Clearer |
| Dependencies | minimatch, js-yaml | None | Easier installation |
| Manual cycles | Context-dependent behavior | Always show same note | Predictable |

### Minor Concerns (Non-blocking)

**1. LLM False Positives/Negatives**

Semantic matching isn't guaranteed perfect. The design acknowledges this with "When unsure: Run the cycle" - this is the right call. Better to over-check than under-check.

**2. Ambiguous When: Descriptions**

A vague `When:` description (e.g., "When: Important changes") could cause cycles to always run. This is user error, not a design flaw. The template/example should guide toward specificity.

**Recommendation:** Add one example of a good `When:` vs bad `When:` in the `/verify` command template.

**3. Manual Cycle Note Placement**

The design says manual cycles "always show note about manual checks." If 5 manual cycles trigger, the review output could get verbose.

**Mitigation:** Group manual checks into single summary:
```
Manual verification needed (3 cycles):
- Visual Regression Check
- Admin Panel Smoke Test
- Mobile Layout Verification

Note: Run `/review` directly to complete manual checks.
```

---

## Scope Assessment

### In Scope (Appropriate)

- Plain markdown cycle files in `.claude/verify-cycles/`
- `Run:` line detection for automated cycles
- `When:` description for semantic matching
- Review Agent integration
- `/verify` command for creating templates

### Out of Scope (Correctly Excluded)

| Excluded Feature | Why Excluded | Verdict |
|------------------|--------------|---------|
| Glob pattern matching | Adds dependency, complexity | Correct |
| YAML frontmatter parsing | Adds dependency | Correct |
| Context-dependent behavior | Adds confusion | Correct |
| Multiple rigor levels | Over-complication | Correct |
| Cycle versioning | Not needed for v1 | Correct |

---

## Differentiation from Existing Features

| Feature | Focus | Verify Cycles Add |
|---------|-------|-------------------|
| `/review` | Generic code quality, style | **Project-specific** custom checks |
| `/qa` | Test generation, coverage analysis | **Runtime verification** (scripts, manual checks) |
| `/security` | OWASP, secrets, CVEs | **Functional verification** (UI, performance, etc.) |

The distinction is clear and valuable.

---

## Test Scenarios Coverage

The design includes three test scenarios:
1. Documentation change - correctly skips homepage check
2. Relevant code change - correctly runs homepage check
3. Manual cycle - correctly shows note

**Missing scenario worth adding:**

| Scenario | Description |
|----------|-------------|
| Ambiguous change | Change to shared utility file - design says "when unsure, run" - validate this behavior |

**Non-blocking:** This can be added during implementation testing.

---

## Edge Cases Handled

| Edge Case | Handling | Status |
|-----------|----------|--------|
| No changed files | Skip discovery | Correct |
| No cycles directory | Continue without cycles | Correct |
| Malformed cycle | Log warning, skip | Correct |
| Script not found | BLOCK with helpful message | Correct |
| Ambiguous relevance | Run the cycle | Correct |

All major edge cases are addressed.

---

## Recommendation

**APPROVED**

The simplified design is elegant, achievable, and ready for implementation. The key insight - using LLM semantic reasoning instead of glob matching - eliminates complexity while improving user experience.

**Why this works:**

1. **Product fit:** Directly solves project-specific feedback loop problem
2. **User experience:** Plain markdown is intuitive, no syntax to learn
3. **Integration:** Single agent change, leverages existing workflow
4. **Completeness:** All edge cases handled, zero dependencies

**Next steps:**

1. Run `/decompose` to create implementation task tree
2. Implement in priority order:
   - Review Agent enhancement (core)
   - `/verify` command (UX)
   - Documentation

---

## Files Referenced

- `docs/plans/architect/verify-cycle-skill.md` - Design document
- `docs/plans/product/validations/feedback-loop-skill.md` - Original product brief
- `docs/spelunk/flows/codebase-overview.md` - Codebase understanding
