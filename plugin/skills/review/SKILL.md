---
name: review
description: Use when reviewing code changes for style guide compliance and quality standards
---

# /review

Invoke the Code Review Agent.

> **Teammates:** When running as a teammate in an agent team, this skill uses inter-agent messaging instead of Task() subagent spawning. The Orchestrator (team lead) spawns you and you communicate results via messages.

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
5. **Messages Security teammate** for pre-merge audit
6. Returns approval or blocking rejection via messages

## Authority

Code Review Agent is a **gatekeeper** - can block merge.

## Teammate Communication

### After Review Complete

```
# If approved (after security check)
Message lead: "Code review: APPROVED for task {task-id}.
Security audit: PASSED
All checks passed. Ready for pre-commit gate."

# If issues found
Message Coding teammate: "Code review: ITERATE:INTERNAL
Issues found:
1. [specific issue with location]
Please fix and re-request review."

# If architecture concerns
Message lead: "Code review: ESCALATE:ARCHITECTURE
Concern: [specific architecture issue]
Needs Architect input."
```

### Security Gate (Mandatory Before Approval)

Before approving any code review, MUST message Security teammate:
```
Message Security teammate: "Security audit needed before merge approval.
Changed files: [list]
Task: {task-id}
Worktree: .worktrees/{task-id}/"
```

Wait for Security teammate response before issuing final verdict.

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
5. Execute verify cycles
6. Message Security teammate for audit
7. Report findings via message to lead
