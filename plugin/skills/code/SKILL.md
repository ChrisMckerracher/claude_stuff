---
name: code
description: Use when implementing tasks, or understanding code relationships in a codebase
---

# /code

Invoke the Coding Agent.

## Usage

`/code` - Start implementing next ready task
`/code examine` - Analyze code relationships and patterns
`/code <task-description>` - Implement specific task

## What Happens

1. Coding Agent activates with TDD workflow
2. Claims task from ready queue
3. Writes tests first, then implementation
4. Closes task when complete, reports what's unblocked

**REQUIRED SUB-SKILL:** superpowers:test-driven-development
