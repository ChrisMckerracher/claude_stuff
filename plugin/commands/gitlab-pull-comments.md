---
description: Fetch and review comments from a GitLab MR
allowed-tools: ["Bash", "Read"]
argument-hint: "<MR-number>"
---

# GitLab Pull Comments

Fetch MR feedback from GitLab into context.

## Process

1. Get MR details: `glab mr view <MR-number>`
2. Fetch comments: `glab mr note list <MR-number>`
3. Parse and summarize feedback
4. Categorize by type:
   - Blocking issues
   - Suggestions
   - Questions
   - Approvals

## Output Format

```
## MR #<number>: <title>

### Blocking Issues
- [ ] File:line - Comment summary

### Suggestions
- File:line - Comment summary

### Questions
- File:line - Question needing response

### Status
Approvals: X/Y required
```
