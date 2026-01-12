# Implementation Plan: README.md Accuracy Fixes

**Created:** 2026-01-11
**Architect Agent:** Design for documentation fixes
**Status:** Pending Product Validation

---

## Overview

Fix documentation inaccuracies in README.md identified by Product Agent validation.

### Issues Summary

| Severity | Issue | Location |
|----------|-------|----------|
| **CRITICAL** | `gitlab-stack` skill completely undocumented | Commands table, GitLab section |
| **WARNING** | Skill count says "14" but actual is 15 | Line 288 |
| **MINOR** | Missing worktree-per-task cross-references | Throughout |

---

## Change Specifications

### Change 1: Add `/gitlab-stack` to Commands Table

**Location:** Lines 73-90 (Commands table)

**Current content:**
```markdown
| Command | Purpose |
|---------|---------|
| `/orchestrator` | Route requests to appropriate agents |
| `/architect` | Start design session, analyze architecture |
| `/product` | Validate design matches product goals |
| `/code` | Implement next ready task (TDD) |
| `/qa` | Generate tests from specs |
| `/review` | Code review for style/quality |
| `/security` | Security audit (OWASP, secrets, CVEs) |
| `/decompose` | Break feature into merge tree |
| `/visualize` | Show task tree with progress |
| `/merge-up` | Merge completed children to parent |
| `/rebalance` | Split large tasks, consolidate small ones |
| `/dashboard` | Open web UI at localhost:3847 |
| `/gitlab-pull-comments` | Fetch MR feedback |
| `/gitlab-push-mr` | Create/update MR |
| `/update-claude` | Update CLAUDE.md with feedback |
```

**New content (insert after `/gitlab-push-mr`):**
```markdown
| `/gitlab-stack` | Create and manage stacked MR workflows |
```

---

### Change 2: Update Skill Count from 14 to 15

**Location:** Line 288

**Current content:**
```markdown
├── skills/                          # Skills (14 total)
```

**New content:**
```markdown
├── skills/                          # Skills (15 total)
```

---

### Change 3: Add gitlab-stack to Plugin Structure

**Location:** Lines 288-302 (skills list)

**Current content:**
```markdown
│   ├── gitlab-pull-comments/SKILL.md
│   ├── gitlab-push-mr/SKILL.md
│   └── update-claude/SKILL.md
```

**New content:**
```markdown
│   ├── gitlab-pull-comments/SKILL.md
│   ├── gitlab-push-mr/SKILL.md
│   ├── gitlab-stack/SKILL.md        # Stacked MR workflows
│   └── update-claude/SKILL.md
```

---

### Change 4: Add GitLab Stack Documentation Section

**Location:** After line 405 (after existing GitLab Integration commands)

**New section to add:**
```markdown
### Stacked MR Workflows

The `/gitlab-stack` command enables sophisticated multi-MR workflows:

```bash
/gitlab-stack create <name> <manifest.json>   # Create MR stack
/gitlab-stack status <name>                   # Show stack state
/gitlab-stack sync <name>                     # Sync with GitLab
/gitlab-stack rollup <name>                   # Cherry-pick merged commits
/gitlab-stack comments <name> <mr-id>         # Fetch MR comments
/gitlab-stack fix <name> <mr-id>              # Agent-assisted review workflow
/gitlab-stack abandon <name>                  # Clean up stack
```

**Key concepts:**

- **Stack**: Tree of related MRs sharing a common root branch
- **Root MR**: Final MR merging to main (contains rolled-up commits)
- **Leaf MRs**: Individual MRs targeting root branch (parallel review)
- **Worktree isolation**: Each stack uses `.worktrees/{stack-name}/`
- **Tracking docs**: Persistent state at `docs/mr-stacks/{name}.md`

**When to use stacked MRs:**

- Feature requires multiple independently reviewable components
- Want parallel review workflow without premature merge
- Need clean cherry-pick roll-up to main branch
- Large feature spanning 500+ lines across multiple files

The fix workflow (`/gitlab-stack fix`) provides agent-assisted handling of review feedback:
- Fetches and categorizes MR comments (blocking/suggestions/questions)
- Architect agent drafts fix approach
- Coding agent implements in isolated worktree
- Human approval gates at plan and commit stages
```

---

### Change 5: Update Overview Skill Count

**Location:** Line 45 (Overview badge count)

**Current content:**
```markdown
- **15 Commands** - Direct agent invocation and workflow management
```

**No change needed** - the overview mentions commands, not skills. The overview section correctly states the feature set without specific counts.

---

### Change 6: Update Commands Count (if needed)

**Location:** Line 272 comment

**Current content:**
```markdown
├── commands/                        # Slash commands (15 total)
```

**Verification needed:** After adding gitlab-stack to the commands table, verify if there are 16 commands total. Based on glob results, there is no `gitlab-stack.md` command file, only the skill. The command count remains 15.

---

## Implementation Tasks

The changes can be implemented as a single task (~50 lines of documentation changes):

```
Task: Fix README.md accuracy issues
Description: Update README.md to document gitlab-stack skill and fix skill count
Files to modify:
  - README.md (lines 73-90, 288, 288-302, after 405)
Estimated changes: ~50 lines
Dependencies: None (can be done independently)
```

---

## Validation Criteria

After implementation, verify:

1. [ ] Commands table includes `/gitlab-stack` entry
2. [ ] Skills count updated from 14 to 15
3. [ ] Plugin structure includes gitlab-stack/SKILL.md
4. [ ] GitLab section has new "Stacked MR Workflows" subsection
5. [ ] No broken links or formatting issues
6. [ ] Markdown renders correctly

---

## Related Documentation

- Product validation: `docs/plans/product/readme-accuracy-issues.md` (to be created)
- gitlab-stack skill: `plugin/skills/gitlab-stack/SKILL.md`
- Existing gap analysis: `docs/plans/product/gap-analysis-readme-vs-reality.md`

---

## Next Steps

1. **Product Agent validation** - Review and approve this plan
2. **Coding Agent implementation** - Apply changes to README.md
3. **Review Agent verification** - Check formatting and completeness
