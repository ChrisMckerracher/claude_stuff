# Product Agent Structured Workflow Design

## Goal

Give the Product Agent persistent context through structured markdown files, enabling asynchronous collaboration with the Architect Agent and on-demand web research.

## Problem Statement

Currently the Product Agent:
1. **Moves blind** - validates designs without persistent product context
2. **Has no memory** - each invocation starts fresh, no accumulated product knowledge
3. **Cannot research** - no web search for market analysis, competitor features, or best practices
4. **Reactive only** - only validates architect work, never initiates product direction

## Approach

Mirror the Architect's `docs/plans/architect/` pattern with `docs/plans/product/` containing:
- **Product briefs** (PRDs) - define WHAT and WHY before design
- **Validation reports** - record of design reviews and decisions

Enable **asynchronous workflow** where either agent can work independently:
- Product can draft specs without waiting for architect
- Architect can design technical solutions; Product validates when invoked
- Human orchestrates which to invoke and when

Add **web search** capability to both agents for on-demand research.

## Folder Structure

```
docs/plans/
├── architect/
│   └── <feature-name>.md        # Technical design docs
└── product/
    ├── briefs/
    │   └── <feature-name>.md    # Product briefs/PRDs
    └── validations/
        └── <feature-name>.md    # Validation reports
```

## Product Brief Template

```markdown
# [Feature Name] Product Brief

## Problem
What user pain point or opportunity are we addressing?

## Users
Who experiences this problem? (personas, segments)

## Success Criteria
How do we know we solved it? (measurable outcomes)

## User Stories
- As a [user], I want [capability] so that [benefit]

## Scope
### In Scope
- Feature A
- Feature B

### Out of Scope
- Feature X (why: reason)

## Research
### Market Analysis
[Web search findings about how others solve this]

### User Research
[Any user feedback, support tickets, or interviews]

## Open Questions
- Question 1?
- Question 2?
```

## Validation Report Template

```markdown
# [Feature Name] Validation Report

**Design reviewed:** `docs/plans/architect/<feature-name>.md`
**Date:** YYYY-MM-DD
**Status:** APPROVED | NEEDS_REVISION | REJECTED

## Checklist
- [x] Clear problem statement
- [x] Solution addresses problem directly
- [ ] No unnecessary features (YAGNI)
- [x] User value is clear
- [ ] Success criteria defined

## Findings

### Aligned with Product Goals
- Point 1
- Point 2

### Concerns
- Concern 1: explanation
- Concern 2: explanation

### Scope Creep Flags
- None | List items that exceed scope

## Recommendation
[Approve / Revise with specific changes / Reject with rationale]
```

## Async Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    ASYNC AGENT WORKFLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PRODUCT-INITIATED:                                             │
│  ┌─────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ /product│───▶│ Draft brief to  │───▶│ Human reviews   │     │
│  │ (human) │    │ docs/plans/     │    │ invokes /arch   │     │
│  └─────────┘    │ product/briefs/ │    └─────────────────┘     │
│                 └─────────────────┘                             │
│                                                                 │
│  ARCHITECT-INITIATED:                                           │
│  ┌─────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │/architect│──▶│ Check if product│───▶│ Design against  │     │
│  │ (human) │    │ brief exists    │    │ brief or infer  │     │
│  └─────────┘    └─────────────────┘    └─────────────────┘     │
│                        │                                        │
│                        ▼                                        │
│              ┌─────────────────┐                                │
│              │ If no brief:    │                                │
│              │ - Pure tech? OK │                                │
│              │ - User-facing?  │                                │
│              │   Suggest brief │                                │
│              └─────────────────┘                                │
│                                                                 │
│  VALIDATION (when human invokes /product on design):            │
│  ┌─────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │ /product│───▶│ Read arch design│───▶│ Write validation│     │
│  │ validate│    │ + product brief │    │ report          │     │
│  └─────────┘    └─────────────────┘    └─────────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Agent Behavior Changes

### Product Agent

**New capabilities:**
1. **Read `docs/plans/product/briefs/`** for context on any feature
2. **Write briefs** when drafting product specs
3. **Write validation reports** to `docs/plans/product/validations/`
4. **Web search** for market research, competitor analysis, best practices

**New workflow:**
```
1. On invocation, check for existing brief in docs/plans/product/briefs/<feature>.md
2. If drafting: use web search for research, write brief
3. If validating: read architect design + product brief, write validation report
4. Always output to structured files, not just conversation
```

### Architect Agent

**New capabilities:**
1. **Read `docs/plans/product/briefs/`** before designing
2. **Web search** for technical research, API docs, library comparisons

**New workflow:**
```
1. On invocation, check for product brief in docs/plans/product/briefs/<feature>.md
2. If brief exists: design against it
3. If no brief AND user-facing feature: suggest human invoke /product first
4. If no brief AND pure technical work: proceed (note in design doc)
```

## Web Search Integration

Both agents get access to `WebSearch` tool for on-demand research:

| Agent | Search Use Cases |
|-------|------------------|
| Product | Market analysis, competitor features, user research trends, industry best practices |
| Architect | Technical approaches, library comparisons, API documentation, implementation patterns |

**Search should be:**
- On-demand (not automatic)
- Cited in documents (source links)
- Cached conceptually (findings written to docs, not re-searched)

## Task Breakdown

**Path Migration:** All agent/skill files currently use `plans/` - we are migrating to `docs/plans/`.

1. **Create folder structure** (blocks: none)
   - Create `docs/plans/product/briefs/` and `docs/plans/product/validations/`
   - Ensure `docs/plans/architect/` exists

2. **Update Product Agent definition** (blocks: none)
   - Update `plugin/agents/product.md`:
     - Change `plans/architect/` → `docs/plans/architect/`
     - Add `docs/plans/product/briefs/` awareness
     - Add `docs/plans/product/validations/` output
     - Add brief and validation templates
     - Add web search instruction

3. **Update Architect Agent definition** (blocks: none)
   - Update `plugin/agents/architecture.md`:
     - Change all `plans/architect/` → `docs/plans/architect/`
     - Add `docs/plans/product/briefs/` awareness (check for product brief)
     - Add web search instruction
     - Add "suggest brief" logic for user-facing features

4. **Update Coding Agent definition** (blocks: none)
   - Update `plugin/agents/coding.md`:
     - Change `plans/architect/` → `docs/plans/architect/`

5. **Update QA Agent definition** (blocks: none)
   - Update `plugin/agents/qa.md`:
     - Change `plans/architect/` → `docs/plans/architect/`

6. **Update Product skill** (blocks: 2)
   - Update `plugin/skills/product/SKILL.md` for new workflow
   - Add `/product brief` and `/product validate` subcommands

7. **Update Architect skill** (blocks: 3)
   - Update `plugin/skills/architect/SKILL.md` for brief checking

8. **Update command files** (blocks: none)
   - Update `plugin/commands/architect.md`: `plans/` → `docs/plans/`
   - Update `plugin/commands/code.md`: `plans/` → `docs/plans/`

## Open Questions

1. Should validation reports block architect iteration, or just inform?
   - **Proposed:** Inform only. Human decides whether to iterate.

2. Should we add a `/product brief` vs `/product validate` subcommand distinction?
   - **Proposed:** Yes, clearer intent.

---

**Status:** DRAFT - Awaiting human review
