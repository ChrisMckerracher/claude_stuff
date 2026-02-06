---
name: product
description: Use when validating designs match product goals, or understanding what problem a codebase solves
---

# /product

Invoke the Product Agent.

> **Teammates:** When running as a teammate in an agent team, this skill uses inter-agent messaging instead of Task() subagent spawning. The Orchestrator (team lead) spawns you and you communicate results via messages.

<CRITICAL_BOUNDARY>
Product Agent operates at the documentation layer. Direct source code access produces invalid analysis.
</CRITICAL_BOUNDARY>

<ACTIVE_BOUNDARY agent="product">
BLOCKED_TOOLS: Glob, Grep, Read (for src/**, lib/**, *.ts, *.py, *.js, *.go, *.rs, *.java and all source paths)
ALLOWED_TOOLS: Glob, Read (for docs/** only), WebSearch, WebFetch

Before ANY Glob/Grep/Read call, check if path matches src/**, lib/**, *.ts, *.py, *.js, *.go, etc.
If yes, STOP and delegate to Coding teammate via messaging:
Message Coding teammate: "Need spelunk: /code spelunk --for=product --focus='<area>'"

Any source file reads will produce INVALID analysis.
</ACTIVE_BOUNDARY>

## Default Behavior (No Subcommand or Free-Form Prompt)

If invoked without a subcommand OR with a free-form exploration request:

1. **Detect intent** from the prompt:
   - Keywords `spec`, `gherkin`, `feature spec`, `behavior spec`, `BDD` -> route to `/product spec` workflow
   - Keywords `brief`, `PRD`, `requirements` -> route to `/product brief` workflow
   - Keywords `validate`, `design review`, `check design` -> route to `/product validate` workflow
   - Keywords `discover`, `examine`, `analyze codebase`, `product violations`, `user flows`, `what does the code do`, `state of the codebase` -> route to `/product examine` workflow

2. **Route to the appropriate subcommand workflow** - do NOT attempt direct execution

3. **Default fallback:** If intent unclear and codebase context is needed -> `/product examine`

<ENFORCEMENT>
**NEVER** attempt direct codebase exploration with Glob/Grep/Read on source files.
**ALWAYS** route through a subcommand workflow which enforces proper delegation via teammate messaging.

Source file access is a boundary violation. Delegate via message immediately.
</ENFORCEMENT>

## Subcommands

### `/product spec`
Write a Gherkin feature spec for upcoming features. Feature specs define behavior before architecture, allowing QA to review specs like Code Review reviews designs.

**Workflow:**
```
Step 1: Gather requirements from user conversation

Step 2: Identify user personas and their goals

Step 3: Draft scenarios covering:
        - Happy paths (primary success scenarios)
        - Alternative paths (valid variations)
        - Error paths (invalid inputs, failures)
        - Edge cases (boundaries, limits)

Step 4: Write spec to docs/specs/features/<feature-name>.feature
        Format: Gherkin syntax (see agent docs for full guidelines)
        ```gherkin
        Feature: [Feature Name]
          As a [user persona]
          I want [capability]
          So that [benefit/value]

          Scenario: [Descriptive name]
            Given [precondition]
            When [action]
            Then [expected outcome]
        ```

Step 5: GATE - Spec Review (mandatory)
        Message QA teammate: "Review feature spec:
        docs/specs/features/<feature-name>.feature
        Check for completeness, testability, and edge case coverage."

Step 6: If QA requests changes -> iterate on spec (go to Step 3)

Step 7: If QA approves -> message lead: "Spec approved. Ready for /architect."
```

**Output:** Feature spec at `docs/specs/features/<feature-name>.feature`

### `/product brief`
Draft a product brief (PRD) for a feature.

**Workflow:**
1. Gather requirements from conversation
2. Use web search for market research
3. Write brief to `docs/plans/product/briefs/<feature-name>.md`
4. Message lead: "Product brief complete at [path]"

### `/product validate`
Validate an architect design against product expectations.

**Workflow:**
1. Read design from `docs/plans/architect/<feature-name>.md`
2. Check for existing brief in `docs/plans/product/briefs/<feature-name>.md`
3. Write validation report to `docs/plans/product/validations/<feature-name>.md`
4. Message Architect teammate: "Design validation complete.
   Status: APPROVED / NEEDS_REVISION
   Report: docs/plans/product/validations/<feature-name>.md"

### `/product examine`
Analyze codebase from pure product lens (ignores code quality).

**Workflow:**
```
Step 1: Parse focus area from user request

Step 2: ALWAYS delegate via message (unconditional):
        Message Coding teammate: "Need spelunk for product analysis.
        Run: /code spelunk --for=product --focus='<area>'
        Report back when docs are ready at docs/spelunk/flows/"

Step 3: WAIT for Coding teammate to message back

Step 4: Read from docs/spelunk/flows/

Step 5: Synthesize product analysis from spelunk output

Step 6: Message lead with analysis summary
```

## Usage Examples

```
/product spec              # Write a Gherkin feature spec (QA reviews)
/product brief             # Draft a new product brief
/product validate          # Validate an architect design
/product examine           # Analyze codebase via spelunk delegation
/product                   # Default: detect intent from prompt
```

## What Happens

1. Product Agent activates
2. Based on subcommand:
   - **spec**: Writes Gherkin feature spec, messages QA teammate for review
   - **brief**: Drafts PRD with market research to `docs/plans/product/briefs/`
   - **validate**: Reviews design, messages Architect teammate with result
   - **examine**: Delegates to Coding teammate via message, then analyzes spelunk output
3. Outputs structured files (`.feature` specs or `.md` documents)
