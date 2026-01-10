---
name: product
description: Use when validating designs match product goals, or understanding what problem a codebase solves
---

# /product

Invoke the Product Agent.

<CRITICAL-BOUNDARY>
## Documentation Layer Constraint

Product Agent operates ONLY at the documentation layer.

**ALLOWED:** `docs/**`, `README.md`, `package.json`
**NEVER:** Source code (`src/**`, `lib/**`, `*.ts`, `*.py`, etc.)

When codebase knowledge is needed, Product MUST delegate to spelunker.
</CRITICAL-BOUNDARY>

## Subcommands

### `/product brief`
Draft a product brief (PRD) for a feature.

**Workflow:**
1. Gather requirements from conversation
2. Use web search for market research
3. Write brief to `docs/plans/product/briefs/<feature-name>.md`

### `/product validate`
Validate an architect design against product expectations.

**Workflow:**
1. Read design from `docs/plans/architect/<feature-name>.md`
2. Check for existing brief in `docs/plans/product/briefs/<feature-name>.md`
3. Write validation report to `docs/plans/product/validations/<feature-name>.md`

### `/product examine`
Analyze codebase from pure product lens (ignores code quality).

**Workflow (MANDATORY - follow exactly):**
```
Step 1: Glob("docs/spelunk/flows/*.md") - check for existing docs

Step 2: If MISSING or need fresh exploration:
        DELEGATE (you cannot skip this):
        Task(
          subagent_type: "agent-ecosystem:coding",
          prompt: "/code spelunk --for=product --focus='<area>'"
        )

Step 3: WAIT for delegation to complete

Step 4: Read from docs/spelunk/flows/ (now within boundary)

Step 5: Read README.md and docs/**/*.md

Step 6: Synthesize product analysis from spelunk output
```

**ENFORCEMENT:** If you skip delegation and try to Read source files, you are violating your constraint. STOP and delegate.

## Usage Examples

```
/product brief             # Draft a new product brief
/product validate          # Validate an architect design
/product examine           # Analyze codebase via spelunk delegation
/product                   # Default: validate current design
```

## What Happens

1. Product Agent activates
2. Based on subcommand:
   - **brief**: Drafts PRD with market research to `docs/plans/product/briefs/`
   - **validate**: Reviews design, writes report to `docs/plans/product/validations/`
   - **examine**: Delegates to spelunker, then analyzes spelunk output for user value and gaps
3. Outputs structured markdown files (not just conversation)
