---
description: Create a new verify cycle for project-specific quality checks
allowed-tools: ["Read", "Write", "Glob", "Bash"]
argument-hint: "<cycle-name>"
---

# Verify Cycle Creator

Create a new verify cycle template in `.claude/verify-cycles/`.

## Usage

`/verify <cycle-name>` - Create a new verify cycle with the given name

## Process

1. **Validate cycle name:** Ensure name is provided and is kebab-case friendly
2. **Create directory:** Ensure `.claude/verify-cycles/` exists
3. **Create template:** Generate cycle file at `.claude/verify-cycles/<cycle-name>.md`

## Template Format

```markdown
# <Name> Check

Run: <command to run>
When: <description of when this applies>

<verification notes>
```

## Cycle Types

### Automated Cycles

Include a `Run:` line to make the cycle automated:

```markdown
# API Contracts Check

Run: npm run test:contracts
When: API endpoints or schema changes

Verify API contracts match OpenAPI spec.
```

### Manual Cycles

Omit the `Run:` line for manual verification:

```markdown
# Visual Regression Check

When: CSS or style changes

Spin up a browser and verify:
- No broken layouts
- No overlapping elements
- Colors look correct on light/dark themes
```

## Execution

Verify cycles are executed automatically by the Code Review Agent during `/review`. The agent:

1. Reads each cycle in `.claude/verify-cycles/`
2. Parses `When:` description and checks for `Run:` command
3. Asks: "Does my change relate to this cycle?"
4. If relevant:
   - Automated: Execute command, check exit code
   - Manual: Display checklist with note to complete manually

## Example

```bash
/verify homepage-performance
```

Creates `.claude/verify-cycles/homepage-performance.md`:

```markdown
# Homepage Performance Check

Run: <your-command-here>
When: <describe when this applies>

<Add verification notes here>
```
