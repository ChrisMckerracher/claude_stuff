---
name: gitlab-push-mr
description: Use when creating or updating a GitLab MR from the current branch
---

# /gitlab push-mr

Create or update GitLab MR from current branch.

## Usage

`/gitlab push-mr` - Create MR for current branch
`/gitlab push-mr update` - Update existing MR description

## Process

1. Push current branch to remote
2. Check if MR exists for branch
3. If new: Create MR with generated description
4. If exists: Update description
5. Report MR URL

## MR Description Template

Generated from linked bead:

## Summary

[From bead description]

## Changes

- [Generated from commits]

## Task Tree

[From /visualize if part of merge tree]

## Test Plan

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual verification

---
Tracked by: bd-xxxx

## Commands

# Push branch
git push -u origin $(git branch --show-current)

# Create MR (glab CLI)
glab mr create --title "Title" --description "..."

# Or via API
curl -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
  "$GITLAB_HOST/api/v4/projects/$PROJECT_ID/merge_requests" \
  -d "source_branch=..." -d "target_branch=main" -d "title=..."
