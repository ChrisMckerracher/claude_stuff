---
name: verify
description: Create and manage verify cycles for project-specific quality checks during code review
---

# /verify

Create project-specific verification cycles that run automatically during code review.

## Usage

`/verify <cycle-name>` - Create a new verify cycle template

## What Are Verify Cycles?

Verify cycles are project-specific quality checks that the Code Review Agent runs automatically. They allow teams to define custom validations beyond generic code review.

## Cycle Format

Cycles are plain markdown files stored in `.claude/verify-cycles/`. The format uses natural parsing of `Run:` and `When:` lines.

```markdown
# <Name> Check

Run: <command to run>
When: <description of when this applies>

<verification notes>
```

### Parsing Rules

- `Run: <command>` - Line starting with "Run:" indicates automated execution
- `When: <description>` - Plain English description of when this applies
- If no `Run:` line exists, the cycle is manual
- Everything else is context for the human or the LLM

## Cycle Types

### Automated Cycles

Include a `Run:` line to execute a command automatically:

```markdown
# Homepage Performance Check

Run: npm run lighthouse
When: Homepage or landing page changes

Verify homepage loads in < 2s on fast-3g.
If this fails, block merge with the lighthouse output.
```

### Manual Cycles

Omit `Run:` for human verification:

```markdown
# Visual Regression Check

When: CSS or style changes

Spin up a browser and verify:
- [ ] No broken layouts
- [ ] No overlapping elements
- [ ] Colors look correct on light/dark themes

Note: Run `/review` directly to complete manual checks.
```

## How Cycles Are Triggered

The Code Review Agent uses semantic reasoning to determine relevance:

> "Does my change relate to this verification cycle?"

### Example Reasoning

| Changed Files | Cycle When: | Decision |
|---------------|-------------|----------|
| `README.md` | Homepage changes | SKIP - docs don't affect homepage |
| `src/auth/login.ts` | Auth-related changes | RUN - direct hit |
| `src/pages/index.tsx` | Homepage changes | RUN - homepage source |
| `.gitignore` | Build system changes | SKIP - no relation |

### Ambiguous Cases

When unsure, the agent runs the cycle. Better to over-check than under-check.

## Execution Behavior

| Type | Detection | Action | On Failure |
|------|-----------|--------|------------|
| Automated | Has `Run:` line | Execute command | Block merge with error output |
| Manual | No `Run:` line | Show checklist | Display note about manual verification |

## Examples

### Create a Performance Check

```bash
/verify homepage-performance
```

Then edit `.claude/verify-cycles/homepage-performance.md`:

```markdown
# Homepage Performance Check

Run: npm run lighthouse -- --only-categories=performance
When: Homepage, landing page, or critical path changes

Verify:
- Performance score > 90
- LCP < 2.5s
- CLS < 0.1
```

### Create a Manual Design Review

```bash
/verify design-review
```

Then edit `.claude/verify-cycles/design-review.md`:

```markdown
# Design Review Check

When: UI components or user-facing changes

Check with design team:
- [ ] Matches design specs
- [ ] Accessibility requirements met
- [ ] Mobile responsive
```

## Integration

Verify cycles integrate with the existing review workflow:

1. Developer runs `/review`
2. Code Review Agent performs standard checks
3. Agent scans `.claude/verify-cycles/` for applicable cycles
4. Relevant cycles execute (automated) or display (manual)
5. Security Agent spawned for final audit
6. Verdict returned

## File Location

All cycles stored in: `.claude/verify-cycles/<name>.md`
