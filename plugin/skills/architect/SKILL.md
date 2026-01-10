---
name: architect
description: Use when starting new features, making design decisions, or analyzing codebase architecture
---

# /architect

Invoke the Architecture Agent for design work.

## Usage

`/architect` - Start design session for new feature
`/architect examine` - Analyze current codebase architecture
`/architect decompose` - Break current design into task tree

## What Happens

1. Architecture Agent activates in appropriate mode
2. **Checks for product brief** at `docs/plans/product/briefs/<feature-name>.md`
   - If brief exists: designs against product requirements
   - If no brief + user-facing feature: suggests running `/product` first
   - If no brief + technical work: proceeds with note in design doc
3. For new features: iterative co-design with you
4. For examine: produces architecture analysis
5. For decompose: creates merge tree of tasks

## Capabilities

- **Product brief awareness:** Checks for and designs against product briefs
- **Web search:** Technical research for API docs, library comparisons, implementation patterns
- **Design docs:** Outputs to `docs/plans/architect/<feature-name>.md`

## Authority

Architecture Agent has highest authority below human. Other agents wait for design approval before engaging.
