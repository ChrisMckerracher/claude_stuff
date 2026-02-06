---
name: review
description: Use when reviewing code changes for style guide compliance and quality standards
---

# /review

Invoke the Code Review Agent.

## Usage

`/review` - Review current changes (or list epics if in worktree context)
`/review <epic-id>` - Review specific epic's changes against its active branch
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

## Multi-Epic Review

When working with epic worktrees, review is epic-aware.

### Finding Project Root

```bash
project_root=$(dirname "$(git rev-parse --git-common-dir)")
```

### List All Epics With Pending Changes

When invoked without arguments in a worktree context:

```bash
for wt in ${project_root}/.worktrees/*/; do
  epic_id=$(basename $wt)
  active=$(bd --cwd "${project_root}" show $epic_id --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')
  commits=$(cd $wt && git rev-list --count ${active}..HEAD 2>/dev/null || echo "0")
  echo "$epic_id: $commits commits ahead of $active"
done
```

Then ask user which epic to review (or "all").

### Reviewing Specific Epic

1. Navigate to worktree: `cd ${project_root}/.worktrees/{epic-id}`
2. Get active branch from label
3. Compare against active branch: `git diff ${active_branch}...epic/{epic-id}`
4. Run code review checks on the diff
5. Report findings with approval or rejection
