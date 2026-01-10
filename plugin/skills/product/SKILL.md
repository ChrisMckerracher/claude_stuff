---
name: product
description: Use when validating designs match product goals, or understanding what problem a codebase solves
---

# /product

Invoke the Product Agent.

<CRITICAL_BOUNDARY>
Product Agent operates at the documentation layer. Direct source code access produces invalid analysis.
</CRITICAL_BOUNDARY>

<ACTIVE_BOUNDARY agent="product">
BLOCKED_TOOLS: Glob, Grep, Read (for src/**, lib/**, *.ts, *.py, *.js, *.go, *.rs, *.java and all source paths)
ALLOWED_TOOLS: Glob, Read (for docs/** only), WebSearch, WebFetch

Before ANY Glob/Grep/Read call, check if path matches src/**, lib/**, *.ts, *.py, *.js, *.go, etc.
If yes, STOP and delegate to spelunker instead:
Task(subagent_type: "agent-ecosystem:coding", prompt: "/code spelunk --for=product --focus='<area>'")

Any source file reads will produce INVALID analysis.
</ACTIVE_BOUNDARY>

## Default Behavior (No Subcommand or Free-Form Prompt)

If invoked without a subcommand OR with a free-form exploration request:

1. **Detect intent** from the prompt:
   - Keywords `brief`, `PRD`, `requirements` → route to `/product brief` workflow
   - Keywords `validate`, `design review`, `check design` → route to `/product validate` workflow
   - Keywords `discover`, `examine`, `analyze codebase`, `product violations`, `user flows`, `what does the code do`, `state of the codebase` → route to `/product examine` workflow

2. **Route to the appropriate subcommand workflow** - do NOT attempt direct execution

3. **Default fallback:** If intent unclear and codebase context is needed → `/product examine`

<ENFORCEMENT>
**NEVER** attempt direct codebase exploration with Glob/Grep/Read on source files.
**NEVER** use `Task(subagent_type: "Explore")` - documentation-layer agents must use spelunk.
**ALWAYS** route through a subcommand workflow which enforces proper delegation.

Source file access is a boundary violation. Delegate immediately.
</ENFORCEMENT>

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
```
Step 1: Parse focus area from user request

Step 2: ALWAYS delegate (unconditional) - no exceptions, no checks for existing docs:
        Task(
          subagent_type: "agent-ecosystem:coding",
          prompt: "/code spelunk --for=product --focus='<area>'"
        )

Step 3: WAIT for delegation to complete

Step 4: Read from docs/spelunk/flows/

Step 5: Synthesize product analysis from spelunk output
```

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
