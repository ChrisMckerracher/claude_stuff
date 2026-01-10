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
2. For new features: iterative co-design with you
3. For examine: produces architecture analysis
4. For decompose: creates merge tree of tasks

## Authority

Architecture Agent has highest authority below human. Other agents wait for design approval before engaging.
