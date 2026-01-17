# Verify Cycle Skill Design

**Date:** 2026-01-15
**Status:** DRAFT
**Author:** Architecture Agent

---

## Goal

Enable project-specific verification cycles that run automatically during code review, allowing teams to define custom quality checks beyond generic code review.

---

## The Key Insight

**LLMs are good at semantic reasoning.** Instead of complex glob pattern matching, the Review Agent simply asks itself:

> "Does my change relate to this verification cycle?"

If yes -> run it. If no -> skip it.

**Example:**
```
Changed files: README.md, docs/api.md

Cycle: "Homepage Performance Check" - Spin up browser, verify loads < 2s

Agent reasoning: My README change has nothing to do with homepage performance.
Decision: SKIP

---

Changed files: src/pages/index.tsx, public/index.html

Cycle: "Homepage Performance Check"

Agent reasoning: I changed the homepage source code. This affects performance.
Decision: RUN
```

---

## Design

### 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    DEFINE PHASE (one-time)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User creates: .claude/verify-cycles/<name>.md                  │
│     │                                                            │
│     ├──► File format: Plain markdown                            │
│     ├──► Parse: Run: and When: from content                     │
│     │                                                            │
│  Optional: /verify command (creates template)                   │
│     │                                                            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION (automatic)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Coder implements task -> calls /review (EXISTING)              │
│     │                                                            │
│     ▼                                                            │
│  Review Agent (ENHANCED):                                       │
│     1. Get changed files                                        │
│     2. Check style compliance (existing)                        │
│     3. Check pattern consistency (existing)                     │
│     4. For each verify cycle:                                   │
│         - Read cycle description                                │
│         - Ask: "Does my change relate to this?"                 │
│         - If yes -> run it, if no -> skip                       │
│     5. Spawn Security Agent (existing)                          │
│     6. Return verdict (existing)                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Cycle Storage Format

Plain markdown files. No frontmatter, no YAML. Parse `Run:` and `When:` from the content naturally.

```markdown
# Homepage Performance Check

Run: npm run lighthouse
When: Homepage or landing page changes

Verify homepage loads in < 2s on fast-3g.

If this fails, block merge with the lighthouse output.
```

**Manual example:**
```markdown
# Visual Regression Check

When: CSS or style changes

Spin up a browser and verify:
- [ ] No broken layouts
- [ ] No overlapping elements
- [ ] Colors look correct on light/dark themes

Note: Run `/review` directly to complete manual checks.
```

**Parsing rules:**
- `Run: <command>` - Line starting with "Run:" indicates automated execution
- `When: <description>` - Plain English description of when this applies
- If no `Run:` line exists -> manual cycle
- Everything else is context for the human or the LLM

### 3. Cycle Relevance Algorithm

The Review Agent's internal reasoning:

```
For each cycle in .claude/verify-cycles/:
  1. Read the cycle file
  2. Extract the When: description
  3. Look at my changed files
  4. Ask: "Given what I changed, does this cycle apply?"

  Decision factors:
  - Do the changed files match the When: description?
  - Is there a semantic relationship between my changes and the check?
  - Would running this check provide meaningful feedback?

  If all factors align -> RUN the cycle
  Otherwise -> SKIP with brief note
```

**Example reasoning:**

| Changed Files | Cycle When: | Reasoning | Decision |
|---------------|-------------|-----------|----------|
| `README.md` | Homepage changes | Docs don't affect homepage | SKIP |
| `src/auth/login.ts` | Auth-related changes | Direct hit | RUN |
| `src/components/Button.tsx` | UI component changes | Changed a component | RUN |
| `package.json` | Build system changes | Dependency change | RUN |
| `.gitignore` | Homepage changes | No relation | SKIP |

### 4. Cycle Execution by Type

| Type | Detection | Action | On Failure |
|-------|-----------|--------|------------|
| **automated** | Has `Run:` line | Execute command, check exit code | Block merge with error output |
| **manual** | No `Run:` line | Show description to human | Always show note about manual checks |

**Manual cycle note:**

When a manual cycle is triggered, the Review Agent displays:
```
Manual verification needed: <Cycle Name>

<cycle description>

Note: Run `/review` directly to complete manual checks.
```

This same note is shown regardless of invocation context. No behavioral differences based on how the agent was spawned.

### 5. Review Agent Enhancement

**New section in `plugin/agents/code-review.md`:**

```markdown
## Verify Cycle Execution (NEW)

After style and pattern checks, run applicable verify cycles:

1. Get list of changed files (git diff)
2. For each cycle in `.claude/verify-cycles/`:
   a. Read the cycle file
   b. Parse When: description and check for Run: command
   c. Ask: "Does my change relate to: {When: description}?"
   d. If NO -> skip, continue to next cycle
   e. If YES:
      - If has Run: line -> execute command, check exit code
      - If no Run: line -> show as manual check with note
   f. If failure -> Return `BLOCK:<name>:<reason>`
3. Continue to Security Agent spawn

**Relevance question example:**
```
Changed files: README.md, docs/api.md
Cycle: "Homepage Performance Check" - When: Homepage changes

Question: Given I changed README.md and docs/api.md, does this relate to homepage performance?
Answer: No, those are documentation changes. Skip this cycle.
```
```

---

## Why This Approach Works

### Advantages Over Glob Matching

| Aspect | Glob Approach | LLM Approach |
|--------|---------------|--------------|
| **Dependencies** | Needs minimatch, js-yaml | None |
| **Complexity** | Pattern matching, edge cases | Simple reasoning |
| **User experience** | Learn glob syntax | Plain English |
| **Semantic awareness** | None (file paths only) | Understands meaning |
| **False positives** | High (matches unrelated files) | Low (semantic filtering) |

### Example: Why LLM is Better

**Cycle:** "Spin up browser and verify admin panel works"

**Glob approach:**
```yaml
files: ["src/admin/**/*"]
```
Matches: `src/admin/__tests__/utils.test.ts` <- Probably don't need to run browser for test utils

**LLM approach:**
```
When: Admin panel UI changes
```
Changed: `src/admin/__tests__/utils.test.ts`
Reasoning: "This is a test utility file, not the actual admin panel UI. Running the browser check wouldn't provide meaningful feedback."
Decision: SKIP

---

## Edge Cases

### 1. No Changed Files

**Handling:** Skip cycle discovery, return `APPROVED`.

### 2. No Cycles Directory

**Handling:** Continue review without cycles (feature not configured).

### 3. Malformed Cycle

**Handling:** Log warning, skip cycle, continue review.

### 4. Script Not Found

**Handling:** Return `BLOCK:script-not-found:<path>`, suggest creating script.

### 5. Ambiguous Relevance

**When unsure:** Run the cycle (better to over-check than under-check).

---

## Test Scenarios

### Scenario 1: Documentation Change

```bash
# Cycle
cat > .claude/verify-cycles/homepage.md << 'EOF'
# Homepage Performance Check

Run: npm run lighthouse
When: Homepage or landing page changes

Verify homepage loads in < 2s.
EOF

# Change README
echo "# My Project" > README.md

# Run review
/review

# Expected: Skips homepage-check (docs don't affect homepage)
# Output: "Skipped homepage-check: Documentation changes don't affect homepage"
```

### Scenario 2: Relevant Code Change

```bash
# Same cycle

# Change homepage
echo "export const HomePage = () => <div>New</div>" > src/pages/index.tsx

# Run review
/review

# Expected: Runs homepage-check (executes npm run lighthouse)
```

### Scenario 3: Manual Cycle

```bash
# Manual cycle
cat > .claude/verify-cycles/visual-check.md << 'EOF'
# Visual Regression Check

When: CSS or style changes

Spin up a browser and verify:
- [ ] No broken layouts
- [ ] No overlapping elements
- [ ] Colors look correct
EOF

# Change CSS
echo ".button { color: red; }" > styles.css

# Run /review -> shows manual check with note
# Expected output:
#   "Manual verification needed: Visual Regression Check"
#   "Note: Run `/review` directly to complete manual checks."
```

---

## Component Changes

### New Files

| Path | Purpose |
|------|---------|
| `plugin/commands/verify.md` | `/verify` command entry point (creates template) |
| `plugin/skills/verify/SKILL.md` | Verify skill documentation |

### Modified Files

| Path | Change |
|------|--------|
| `plugin/agents/code-review.md` | Add verify cycle execution section |

### No Dependencies

- No Node.js packages needed
- No glob matching libraries
- No YAML parsers

---

## Integration Points

### Review Agent Flow (Enhanced)

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Review Agent                                              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. Get changed files (git diff)                          │  │
│  │                                                           │  │
│  │ 2. Style compliance check (existing)                     │  │
│  │                                                           │  │
│  │ 3. Pattern consistency check (existing)                  │  │
│  │                                                           │  │
│  │ 4. For each cycle in .claude/verify-cycles/              │  │
│  │     - Read cycle (plain markdown)                        │  │
│  │     - Parse When: and check for Run:                     │  │
│  │     - Ask: "Does my change relate to: {When:}?"          │  │
│  │     - If yes -> run, if no -> skip                       │  │
│  │                                                           │  │
│  │ 5. Spawn Security Agent (existing)                       │  │
│  │                                                           │  │
│  │ 6. Return verdict (existing)                             │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Criteria

1. **Zero new dependencies:** No packages to install
2. **Simple format:** Plain markdown with `Run:` and `When:` lines
3. **Smart filtering:** LLM semantics beats globs
4. **Clear communication:** Skipped cycles show brief reasoning
5. **Manual cycles work:** Always show note, no context-dependent behavior

---

## Next Steps

1. Human approval
2. Product Agent validation
3. Use `/decompose` to create task tree
4. Implement
