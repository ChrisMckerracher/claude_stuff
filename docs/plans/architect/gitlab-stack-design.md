# GitLab Stack Design

## Problem

Large features require multiple MRs for reviewability, but managing dependent MRs is painful:
- Traditional stacking creates linear chains that cascade rebase on any change
- Our beads/worktree system tracks tasks but doesn't create GitLab MRs
- No agent-assisted analysis to inform how to split a feature into MRs
- Cherry-pick roll-up for clean history isn't automated

## Solution

Add `/gitlab-stack` skill that:
1. Analyzes current branch diff with Product + Architect agent collaboration
2. Creates a tree of MR branches in `.worktrees/`
3. Tracks state in `docs/mr-stacks/{stack-name}.md`
4. Uses cherry-pick roll-up so root MR has exactly N commits (one per node)

---

## Architecture

### Relationship to Existing Systems

```
                    ┌─────────────────────────────────────────┐
                    │         /gitlab-stack (NEW)             │
                    │  - MR-focused workflow                  │
                    │  - Cherry-pick roll-up                  │
                    │  - Agent-assisted breakdown             │
                    └────────────────┬────────────────────────┘
                                     │ uses
                    ┌────────────────┴────────────────────────┐
                    │                                         │
         ┌──────────▼──────────┐              ┌───────────────▼───────────┐
         │   .worktrees/       │              │   docs/mr-stacks/         │
         │   (existing)        │              │   (NEW - tracking)        │
         │   - Git isolation   │              │   - MR tree state         │
         │   - Branch mgmt     │              │   - Cherry-pick log       │
         └─────────────────────┘              └───────────────────────────┘
                    │ parallel to
         ┌──────────▼──────────┐
         │   .beads/           │
         │   (existing)        │
         │   - Task tracking   │
         │   - Optional link   │
         └─────────────────────┘
```

**Key insight**: `/gitlab-stack` is MR-focused, while `/decompose` is task-focused. They can work together (MRs linked to beads) or independently (just MRs without beads).

### Directory Structure

```
${project_root}/
├── .worktrees/
│   └── {stack-name}/              # Worktree for MR stack
│       └── (full repo checkout)
├── docs/
│   └── mr-stacks/
│       └── {stack-name}.md        # Stack tracking document
└── (rest of repo)
```

### Branch Naming Convention

```
stack/{stack-name}                  # Root branch (final MR targets main)
stack/{stack-name}/1-{slug}         # Leaf branch (MR targets root)
stack/{stack-name}/2-{slug}         # Leaf branch (MR targets root)
stack/{stack-name}/1-{slug}/a       # Sub-leaf (MR targets parent leaf)
```

**Example**: Feature `auth-system` with 3 parallel pieces:

```
stack/auth-system                   # Root MR → main
├── stack/auth-system/1-middleware  # MR → stack/auth-system
├── stack/auth-system/2-routes      # MR → stack/auth-system
└── stack/auth-system/3-tests       # MR → stack/auth-system
```

---

## Workflow Phases

### Phase 1: Analysis

**Input**: Current branch with uncommitted or committed changes

```bash
# Get diff against parent branch
parent_branch=$(git merge-base --fork-point main HEAD 2>/dev/null || echo "main")
git diff ${parent_branch}...HEAD --stat
git diff ${parent_branch}...HEAD
```

**Agent collaboration**:

1. **Architect Agent** analyzes:
   - File boundaries and module structure
   - Logical separation points
   - Dependency order between pieces
   - Estimated size per MR (target: reviewable chunks)

2. **Product Agent** analyzes:
   - User value delivered by each piece
   - Incremental shippability
   - Risk isolation (which pieces could be reverted independently)

3. **Present breakdown** to user for approval

### Phase 2: Collaborative Breakdown

**Interaction flow**:

```
┌─────────────────────────────────────────────────────────────┐
│  Architect: "I see 3 natural boundaries:                    │
│    1. Auth middleware (src/middleware/) - 200 lines         │
│    2. User routes (src/routes/user.*) - 350 lines          │
│    3. Integration tests (tests/auth/) - 150 lines"         │
├─────────────────────────────────────────────────────────────┤
│  Product: "From a shipping perspective:                     │
│    - #1 can ship independently (enables other teams)        │
│    - #2 requires #1 (user-facing value)                    │
│    - #3 should verify both before merge to main"           │
├─────────────────────────────────────────────────────────────┤
│  Proposed MR Tree:                                          │
│                                                             │
│    [MR] auth-system → main                                  │
│    ├── [MR] 1-middleware → auth-system  (parallel)         │
│    ├── [MR] 2-routes → auth-system      (parallel)         │
│    └── [MR] 3-tests → auth-system       (blocked by 1,2)   │
│                                                             │
│  Approve this breakdown? [y/n/discuss]                      │
└─────────────────────────────────────────────────────────────┘
```

**Human validation gate**: User must explicitly approve before creating branches/MRs.

### Phase 3: Branch/Worktree Creation

After approval:

```bash
stack_name="auth-system"
project_root=$(pwd)

# 1. Create stack root branch from current HEAD
git branch stack/${stack_name}

# 2. Create worktree
git worktree add .worktrees/${stack_name} stack/${stack_name}

# 3. Create leaf branches (in worktree)
cd .worktrees/${stack_name}
git checkout -b stack/${stack_name}/1-middleware stack/${stack_name}
git checkout -b stack/${stack_name}/2-routes stack/${stack_name}
git checkout -b stack/${stack_name}/3-tests stack/${stack_name}

# 4. Initialize tracking document
mkdir -p ${project_root}/docs/mr-stacks
# (Create tracking markdown - see schema below)

# 5. Add .worktrees/ to .gitignore if not present
cd ${project_root}
grep -q "^\.worktrees/$" .gitignore || echo ".worktrees/" >> .gitignore
```

### Phase 4: MR Creation

For each leaf branch:

```bash
# In worktree, on leaf branch
glab mr create \
  --source-branch "stack/${stack_name}/1-middleware" \
  --target-branch "stack/${stack_name}" \
  --title "[1/3] Auth middleware" \
  --description "$(cat <<EOF
## Summary
Add authentication middleware for request validation.

## Part of Stack
- Stack: \`${stack_name}\`
- Parent MR: stack/${stack_name} → main
- Siblings: 2-routes, 3-tests

## Changes
$(git log stack/${stack_name}..HEAD --oneline)

---
🔗 Part of [auth-system stack](../docs/mr-stacks/auth-system.md)
EOF
)"
```

**For root MR** (created last, after leaves have MR numbers):

```bash
glab mr create \
  --source-branch "stack/${stack_name}" \
  --target-branch "main" \
  --title "[Stack] Auth system" \
  --description "$(cat <<EOF
## Summary
Complete authentication system implementation.

## MR Stack
This MR combines the following reviewed changes:
- !101 - Auth middleware
- !102 - User routes
- !103 - Integration tests

## Status
Awaiting child MR merges. Will cherry-pick commits when children complete.

---
📊 [Stack tracking](../docs/mr-stacks/auth-system.md)
EOF
)"
```

### Phase 5: Cherry-Pick Roll-Up

When all leaf MRs are merged to their target (the root branch):

```bash
cd .worktrees/${stack_name}
git checkout stack/${stack_name}

# Pull merged changes (from leaf MR merges)
git pull origin stack/${stack_name}

# Now stack/${stack_name} has all changes
# Push to update root MR
git push origin stack/${stack_name}

# Root MR now shows complete diff against main
```

**Alternative: True cherry-pick** (if leaves merge to main with squash):

```bash
# If leaves merged directly to main with squash commits
git checkout stack/${stack_name}
git cherry-pick <squash-commit-1-middleware>
git cherry-pick <squash-commit-2-routes>
git cherry-pick <squash-commit-3-tests>
git push origin stack/${stack_name}
```

**Result**: Root MR has exactly 3 commits, one per logical piece.

---

## Tracking Document Schema

Location: `docs/mr-stacks/{stack-name}.md`

```markdown
---
stack: auth-system
created: 2026-01-11T10:30:00Z
parent_branch: main
status: in_progress
---

# MR Stack: auth-system

## Overview

| Field | Value |
|-------|-------|
| Created | 2026-01-11 |
| Parent Branch | main |
| Worktree | .worktrees/auth-system |
| Status | in_progress |

## Tree Structure

```
[MR !100] stack/auth-system → main (PENDING - awaits children)
├── [MR !101] stack/auth-system/1-middleware (MERGED ✓)
│   └── Commit: abc1234 "Add auth middleware"
├── [MR !102] stack/auth-system/2-routes (IN REVIEW)
│   └── Commit: (pending)
└── [MR !103] stack/auth-system/3-tests (DRAFT)
    └── Commit: (pending)
```

## MR Details

### Root: !100 - Auth System
- **Branch**: stack/auth-system
- **Target**: main
- **Status**: PENDING (awaits children)
- **URL**: https://gitlab.com/org/repo/-/merge_requests/100

### Leaf: !101 - Auth Middleware
- **Branch**: stack/auth-system/1-middleware
- **Target**: stack/auth-system
- **Status**: MERGED ✓
- **Merged Commit**: abc1234
- **URL**: https://gitlab.com/org/repo/-/merge_requests/101

### Leaf: !102 - User Routes
- **Branch**: stack/auth-system/2-routes
- **Target**: stack/auth-system
- **Status**: IN REVIEW
- **URL**: https://gitlab.com/org/repo/-/merge_requests/102

### Leaf: !103 - Integration Tests
- **Branch**: stack/auth-system/3-tests
- **Target**: stack/auth-system
- **Status**: DRAFT
- **Blocked By**: !101, !102 (tests need impl first)
- **URL**: https://gitlab.com/org/repo/-/merge_requests/103

## Cherry-Pick Log

Track commits for final roll-up:

| MR | Status | Commit SHA | Cherry-picked |
|----|--------|------------|---------------|
| !101 | MERGED | abc1234 | ✓ |
| !102 | PENDING | - | - |
| !103 | PENDING | - | - |

## Notes

- 2026-01-11: Stack created from feature/auth branch
- 2026-01-11: !101 merged, cherry-picked to root

## Breakdown Rationale

**Architect analysis**:
- Middleware is self-contained, no external deps
- Routes depend on middleware types
- Tests verify integration of both

**Product analysis**:
- Middleware enables other teams immediately
- Routes deliver user-facing value
- Tests gate final merge to main
```

---

## New Skills/Commands

### `/gitlab-stack` (Primary Skill)

```yaml
name: gitlab-stack
description: Create and manage stacked MR workflows with agent-assisted breakdown
```

**Modes**:

1. **Create** (default): Analyze branch, collaborate on breakdown, create MR tree
2. **Status**: Show current stack state from tracking doc
3. **Sync**: Update tracking doc from GitLab MR states
4. **Rollup**: Cherry-pick merged leaves to root, update root MR

### `/gitlab-stack-status` (Alias)

Quick view of stack state:

```
Stack: auth-system
Status: 2/3 MRs merged

[✓] !101 1-middleware (merged)
[⏳] !102 2-routes (in review - 2 comments)
[📝] !103 3-tests (draft)

Root MR !100: Awaiting !102, !103
```

### `/gitlab-stack-rollup` (Alias)

Trigger cherry-pick roll-up:

```bash
# Cherry-pick all merged leaf commits to root branch
# Update tracking doc
# Push root branch
# Update root MR description with final commit list
```

---

## Integration Points

### With Existing `/decompose`

Optional integration - can link MR stack to beads:

```bash
# In tracking doc, add bead reference
bead_id: bd-a3f8

# In bead, add stack reference
bd update bd-a3f8 --add-label "mr-stack:auth-system"
```

Benefits:
- Task tracking (beads) + MR tracking (stack) together
- `/visualize` shows both
- `/merge-up` can trigger `/gitlab-stack-rollup`

### With Existing `/gitlab-push-mr`

`/gitlab-stack` uses same glab commands but with:
- Specific branch naming (stack/...)
- Target branch = parent in tree (not always main)
- Coordinated descriptions linking to stack

### With `/review` and `/security`

Before root MR merges to main:
1. `/review` runs on root branch (full diff vs main)
2. `/security` audits complete change set
3. Human validation gate

---

## glab Commands Reference

| Action | Command |
|--------|---------|
| Create MR | `glab mr create --source-branch X --target-branch Y --title "..." --description "..."` |
| List MRs by source | `glab mr list --source-branch "stack/{name}/*"` |
| View MR | `glab mr view <id>` |
| Check MR state | `glab api projects/:fullpath/merge_requests/<id> \| jq '.state'` |
| Get merge commit | `glab api projects/:fullpath/merge_requests/<id> \| jq '.merge_commit_sha'` |
| Set MR dependencies | `glab api projects/:fullpath/merge_requests/<id> -X PUT -f "merge_request_dependencies[]=<dep_id>"` (Premium) |
| Pipeline status | `glab pipeline status` |

---

## Human Validation Gates

1. **Breakdown Approval**: Before creating branches/MRs, user approves proposed tree
2. **Pre-Rollup**: Before cherry-pick roll-up, confirm all leaves reviewed
3. **Pre-Main-Merge**: Before root MR merges to main, full review cycle

---

## Edge Cases

### Conflict During Leaf Merge

If merging leaf to root branch conflicts:

1. Report conflict to user
2. Abort merge, leave clean state
3. Update tracking doc with conflict status
4. User resolves manually, re-runs `/gitlab-stack-rollup`

### Leaf MR Updated After Merge

If a merged leaf needs changes:

1. Create new branch from root: `stack/{name}/1-middleware-fix`
2. New MR targets root
3. Update tracking doc with fix MR
4. Cherry-pick fix commit in rollup

### Abandoning a Stack

```bash
# Close all MRs
glab mr close !101 !102 !103 !100

# Remove worktree
git worktree remove .worktrees/${stack_name}

# Delete branches
git branch -D stack/${stack_name}
git branch -D stack/${stack_name}/1-middleware
# ... etc

# Archive tracking doc
mv docs/mr-stacks/${stack_name}.md docs/mr-stacks/archived/${stack_name}.md
```

---

## Migration / Compatibility

- **Existing repos**: No changes required, `/gitlab-stack` is additive
- **Existing worktrees**: New stack worktrees use `stack/` prefix to avoid collision with `epic/` from beads
- **No GitLab**: Skill requires `glab` CLI and `GITLAB_TOKEN`

---

## Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| Skill | `plugin/skills/gitlab-stack/SKILL.md` | Main workflow orchestration |
| Command | `plugin/commands/gitlab-stack.md` | Slash command definition |
| Tracking | `docs/mr-stacks/{name}.md` | Persistent state across sessions |
| Worktree | `.worktrees/{name}/` | Git isolation for stack branches |
| Branches | `stack/{name}/*` | Branch naming convention |

**Key differentiators from traditional stacking**:
1. **Tree not chain** - Parallel leaf development
2. **Cherry-pick roll-up** - Clean commit history, no merge commits
3. **Agent-assisted breakdown** - Product + Architect perspectives
4. **Persistent tracking** - State survives sessions, visible to all agents
