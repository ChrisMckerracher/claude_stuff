---
name: product
description: Use when validating designs match product goals, or understanding what problem a codebase solves
---

# /product

Invoke the Product Agent.

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

**Workflow:**
1. Survey codebase for user-facing features
2. Map user journeys and value propositions
3. Identify product gaps

## Usage Examples

```
/product brief             # Draft a new product brief
/product validate          # Validate an architect design
/product examine           # Analyze codebase from product lens
/product                   # Default: validate current design
```

## What Happens

1. Product Agent activates
2. Based on subcommand:
   - **brief**: Drafts PRD with market research to `docs/plans/product/briefs/`
   - **validate**: Reviews design, writes report to `docs/plans/product/validations/`
   - **examine**: Analyzes codebase for user value and gaps
3. Outputs structured markdown files (not just conversation)
