---
name: gitlab-pull-comments
description: Use when you need to fetch and review comments from a GitLab MR
---

# /gitlab pull-comments

Fetch MR feedback from GitLab into context.

## Usage

`/gitlab pull-comments` - Pull comments from current branch's MR
`/gitlab pull-comments <mr-id>` - Pull comments from specific MR

## Process

1. Determine MR (from branch or argument)
2. Fetch MR comments via GitLab API
3. Format for review
4. Route feedback to relevant agent if actionable

## Requirements

- `GITLAB_TOKEN` environment variable set
- `GITLAB_HOST` (defaults to gitlab.com)
- Git remote configured

## Output

## MR #123: Add user authentication

### Comments (3)

**@reviewer** on `src/auth.ts:45`
> Consider using bcrypt instead of plain hashing

**@reviewer** on general
> Missing error handling for network failures

**@pm** on general
> LGTM, just the security concern above

### Actionable Items
1. Security: Use bcrypt (route to Security Agent)
2. Code: Add error handling (route to Coding Agent)

## API Call

curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_HOST/api/v4/projects/$PROJECT_ID/merge_requests/$MR_ID/notes"
