---
description: Create or update a GitLab MR from current branch
allowed-tools: ["Bash", "Read"]
argument-hint: "[--draft]"
---

# GitLab Push MR

Create or update a GitLab MR from the current branch.

## Process

1. Check current branch: `git branch --show-current`
2. Ensure changes are pushed: `git push -u origin HEAD`
3. Check for existing MR: `glab mr list --source-branch <branch>`
4. If no MR exists, create one:
   ```bash
   glab mr create --fill --assignee @me
   ```
5. If MR exists, show its URL

## Options

- `--draft`: Create as draft MR (not ready for review)

## MR Description Template

Use the project's MR template if available, otherwise:

```markdown
## Summary
<brief description of changes>

## Changes
- Change 1
- Change 2

## Testing
<how to test these changes>

## Checklist
- [ ] Tests pass
- [ ] Code reviewed
- [ ] Documentation updated
```
