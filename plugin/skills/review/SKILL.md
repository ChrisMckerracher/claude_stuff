---
name: review
description: Use when reviewing code changes for style guide compliance and quality standards
---

# /review

Invoke the Code Review Agent.

## Usage

`/review` - Review current staged/uncommitted changes
`/review examine` - Analyze codebase for style compliance
`/review <files>` - Review specific files

## What Happens

1. Code Review Agent activates
2. Checks changes against language-specific style guides
3. Checks consistency with codebase patterns
4. Provides specific fix suggestions
5. Returns approval or blocking rejection

## Authority

Code Review Agent is a **gatekeeper** - can block merge.
