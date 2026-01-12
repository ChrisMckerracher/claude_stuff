# Product Research: GitLab Stacked MR Workflow

**Date:** 2026-01-11
**Status:** APPROVED
**Requested by:** User
**Agent:** Product Agent

---

## Context

Research into updating GitLab skills to use `glab` CLI and adding a new workflow for collaborative MR breakdown with tree-structured cherry-pick roll-up.

---

## GitLab CLI (`glab`) Research

### What is glab?

`glab` is GitLab's **official CLI tool** (originally community-built, now maintained by GitLab at [gitlab.com/gitlab-org/cli](https://gitlab.com/gitlab-org/cli)). It brings GitLab functionality to the terminal alongside git workflows.

### Core Capabilities

| Category | Commands | Use Case |
|----------|----------|----------|
| **Merge Requests** | `glab mr create/list/view/checkout/approve/merge/diff/rebase` | Full MR lifecycle |
| **Pipelines** | `glab pipeline list/run/status`, `glab ci view/trace` | Watch CI, trigger runs, trace logs |
| **Issues** | `glab issue create/list/view/close` | Issue management |
| **API** | `glab api <endpoint>` | Direct REST/GraphQL access with auth |
| **CI Lint** | `glab ci lint` | Validate `.gitlab-ci.yml` locally |
| **Releases** | `glab release create/list/view` | Release management |
| **Duo AI** | `glab duo ask` | AI-powered git help |

### Key Features for Our Skills

1. **`glab api` - Generic API access** with automatic auth and placeholder substitution (`:fullpath`, `:branch`, etc.)
2. **`glab mr note list <MR>` - Comment fetching** (we already use this)
3. **`glab mr create --fill`** - Auto-fills title/description from commits
4. **`glab pipeline ci view`** - Real-time pipeline watching
5. **`glab ci lint`** - Local CI validation without pushing

### Current Skills vs glab Capabilities

| Our Skill | Current Usage | glab Opportunities |
|-----------|---------------|-------------------|
| `/gitlab-pull-comments` | `glab mr view`, `glab mr note list` | Already using glab |
| `/gitlab-push-mr` | `glab mr create --fill`, `glab mr list` | Already using glab |
| **(NEW)** Pipeline status | None | `glab pipeline status`, `glab ci view` |
| **(NEW)** CI validation | None | `glab ci lint` |
| **(NEW)** Issue linking | None | `glab mr for <issue>` |

### Requirements

- **GitLab version**: 16.0+ officially supported
- **Auth**: `GITLAB_TOKEN` env var or `glab auth login`
- **Install**: `brew install glab` / various package managers

---

## Git Stacking Research

### What are Stacked PRs/MRs?

"Stacking refers to breaking down a pull request (PR) for a feature into several, smaller PRs which all depend on each other – hence the term 'stacked'."

### Traditional Stacking vs Proposed Approach

| Aspect | Traditional Stacking | Proposed Approach |
|--------|---------------------|-------------------|
| **Structure** | Linear chain (A→B→C→D) | Tree (leaves→parents→root) |
| **Merge direction** | Bottom-up (A merges first) | Top-down (root MR merges last, combines all) |
| **Conflict handling** | Recursive rebase nightmare | Cherry-pick avoids duplication |
| **GitLab support** | MR dependencies (Premium), auto-retarget | Same tools apply |

### Key Benefits of Stacking

1. **Faster feature shipping** - smaller PRs review faster
2. **Improved collaboration** - team members can participate sooner
3. **Reduced merge conflicts** - smaller changes integrate quickly
4. **Simplified parallel work** - multiple people can work on different pieces

### Challenges of Traditional Stacking

- Anytime there's an upstream change, every PR in the rest of the stack needs recursive rebasing
- Git CLI wasn't designed for this workflow
- Tools like Graphite, ghstack, spr, git-town help automate

### GitLab-Specific Features

- **MR Dependencies** (Premium/Ultimate): Can block MR merge until dependencies merge
- **Auto-retarget**: When MR 1 merges to main, MR 2's target auto-shifts to main
- **Limitation**: GitLab doesn't support real stacked diffs—only basic retargeting

---

## Proposed Feature: `/gitlab-stack`

### User Request

A workflow that:
1. Takes current branch + examines product/arch docs + diff against parent
2. Product + Architect agents collaborate with user to draft MR breakdown
3. Creates MR branches in `.worktrees/` with tracking markdown
4. Uses a **"reverse tree"** structure where final branch is root combining all child MRs
5. Uses **cherry-pick** strategy so final MR has exactly N commits (no duplicates)

### Why This is Better Than Traditional Stacking

1. **Leaves can be developed/reviewed in parallel** (no waiting)
2. **Cherry-pick avoids the "rebase cascade" problem**
3. **Final MR shows clean, atomic commits** (one per node)

### Proposed Workflow

#### Phase 1: Analysis
1. Diff current branch against parent (main/develop)
2. Read `docs/plans/architect/` and `docs/plans/product/` for context
3. Analyze change scope

#### Phase 2: Collaborative Breakdown (Product + Architect)
1. Product agent: "What user value does each piece deliver?"
2. Architect agent: "What's the natural decomposition?"
3. Present proposed MR tree to user for approval

#### Phase 3: Branch/Worktree Creation
```bash
# Example: feature/auth-system breaks into 3 MRs
git worktree add .worktrees/auth-system-tree epic/auth-system

# Leaf branches (parallelizable)
git branch epic/auth-system/1-middleware
git branch epic/auth-system/2-routes
git branch epic/auth-system/3-tests

# Each targets parent branch for review
```

#### Phase 4: MR Creation with Dependencies
```bash
# Create leaf MRs targeting feature branch
glab mr create --source-branch epic/auth-system/1-middleware \
  --target-branch epic/auth-system \
  --title "1/3: Auth middleware" \
  --description "Part of auth-system stack"

# Use GitLab MR dependencies (Premium) or description linking
```

#### Phase 5: Cherry-Pick Roll-Up
When all leaves complete:
```bash
# On root branch (epic/auth-system)
git cherry-pick <commit-from-1-middleware>
git cherry-pick <commit-from-2-routes>
git cherry-pick <commit-from-3-tests>

# Result: 3 clean commits, no merge noise
# Push to final MR targeting main
```

### Tracking Markdown Location

Store in `docs/mr-stacks/{branch-name}.md`:

```markdown
# MR Stack: auth-system

Created: 2026-01-11
Parent: main
Status: in_progress

## Tree Structure
```
[MR #100] epic/auth-system (PENDING - awaits children)
├── [MR #101] epic/auth-system/1-middleware (MERGED ✓)
├── [MR #102] epic/auth-system/2-routes (IN REVIEW)
└── [MR #103] epic/auth-system/3-tests (DRAFT)
```

## Cherry-Pick Log
- [ ] #101 → commit abc123 (ready)
- [ ] #102 → commit def456 (pending merge)
- [ ] #103 → commit ghi789 (pending merge)

## Notes
- Review feedback: ...
```

### Key Design Decisions

| Decision | Recommendation |
|----------|----------------|
| **MR target branch** | Leaf MRs target `epic/{stack-name}`, root MR targets `main` |
| **Cherry-pick vs merge** | Cherry-pick (one commit per node, clean history) |
| **Worktree location** | `.worktrees/{stack-name}/` (consistent with existing design) |
| **Tracking location** | `docs/mr-stacks/{stack-name}.md` (survives across sessions) |
| **GitLab dependencies** | Use if Premium available, else link in descriptions |

### glab Commands We'd Use

| Purpose | Command |
|---------|---------|
| Create MR | `glab mr create --source-branch X --target-branch Y --fill` |
| List stack MRs | `glab mr list --source-branch "epic/{stack}/*"` |
| View MR status | `glab mr view <id>` |
| Check pipeline | `glab pipeline status` |
| Set dependencies | `glab api projects/:fullpath/merge_requests/:id -X PUT -f "merge_request_dependencies[]=<dep_id>"` |
| Cherry-pick | Native git (not glab) |

### Integration with Existing System

| Existing | New Addition |
|----------|--------------|
| `/decompose` → beads tasks | `/gitlab-stack` → MR tree + tracking md |
| `.worktrees/{epic}/` | Same location, MR-aware |
| `/merge-up` → beads close | `/mr-rollup` → cherry-pick + push |
| `docs/spelunk/` | `docs/mr-stacks/` |

---

## Recommendation

**APPROVED** - This is a well-conceived extension of our existing worktree/merge-tree architecture.

### Key Benefits

1. **Cherry-pick avoids duplication** - Solves the classic stacking problem
2. **Tree > Linear** - Better for parallel work than traditional stacking
3. **Agent collaboration** - Product + Architect bring different perspectives to breakdown
4. **GitLab-native** - Uses glab CLI we already depend on
5. **Consistent with existing design** - Uses `.worktrees/`, adds `docs/mr-stacks/`

### Opportunities for Skill Enhancement

1. **Pipeline monitoring skill** - Watch/trace CI runs from agent context
2. **CI lint integration** - Validate pipeline changes before push
3. **Issue-to-MR workflow** - `glab mr for <issue>` creates linked MRs
4. **Comment management** - New 2025 feature: `glab mr note add/reply` for responding to review feedback
5. **API passthrough** - Use `glab api` for advanced queries (approvals, discussions, etc.)

### Next Steps (if proceeding)

1. Draft architect design for `/gitlab-stack` skill
2. Define the tracking markdown schema
3. Implement cherry-pick roll-up logic
4. Add pipeline status checking to workflow

---

## Sources

- [GitLab CLI Documentation](https://docs.gitlab.com/cli/)
- [glab api Reference](https://docs.gitlab.com/cli/api/)
- [GitLab CLI Repository](https://gitlab.com/gitlab-org/cli)
- [GitLab MR Dependencies](https://docs.gitlab.com/ee/user/project/merge_requests/dependencies.html)
- [Stacking Workflow Guide](https://www.stacking.dev/)
- [Stacked MRs on GitLab with CLI Tools](https://joshtune.com/posts/stacked-merge-requests-gitlab-cli-tools/)
- [Tower Blog: Stacked PRs](https://www.git-tower.com/blog/stacked-prs/)
- [glab mr Commands](https://linuxcommandlibrary.com/man/glab-mr)
