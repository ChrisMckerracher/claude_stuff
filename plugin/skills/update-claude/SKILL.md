---
name: update-claude
description: Use when you receive feedback that should update project CLAUDE.md conventions
---

# /update-claude

Update CLAUDE.md with feedback or new conventions.

## Usage

`/update-claude <feedback>` - Incorporate feedback into CLAUDE.md
`/update-claude` - Interactive mode to gather feedback

## Process

1. Read current CLAUDE.md
2. Analyze feedback for actionable conventions
3. Determine appropriate section
4. Draft update
5. Show diff for approval
6. Apply if approved

## Feedback Types

| Type | CLAUDE.md Section |
|------|-------------------|
| Code style | Code Standards |
| Architecture decisions | Architecture |
| Testing conventions | Testing |
| Git workflow | Git Workflow |
| Tool preferences | Tools |

## Example

Input feedback:
> "We should always use structured logging, not console.log"

Update:
## Code Standards

### Logging
- Use structured logging (e.g., pino, winston)
- Never use console.log in production code
- Include context: `logger.info({ userId, action }, 'message')`

## Safety

- Always show diff before applying
- Create backup: `cp CLAUDE.md CLAUDE.md.bak`
- Commit update separately
