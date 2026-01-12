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

---

## CRITICAL: File Content Integrity

### Non-Negotiable Constraint

**File contents MUST be copied exactly from source branch using unix/git tooling.**

The agent MUST NOT:
- Read file contents and rewrite them using Write/Edit tools
- "Regenerate" or "rethink" code when splitting branches
- Modify file contents in any way during the split operation

The agent MUST:
- Use `git checkout`, `git show`, `cp`, `rsync` for exact byte copies
- Use `git cherry-pick` for moving commits between branches
- Use `head`, `tail`, `sed` (line-range extraction) for splitting files

### Why This Matters

Agent rewriting introduces hallucination risk:
- Subtle changes to logic
- Missing edge cases
- Changed variable names
- Dropped comments

Even "copying" by reading and writing can introduce encoding issues or whitespace changes.

### Approved File Operations

```bash
# Copy entire file from source branch
git show source-branch:path/to/file > path/to/file

# Checkout specific files from source
git checkout source-branch -- path/to/file path/to/other

# Copy with rsync (preserves permissions)
rsync -a source/ dest/

# Extract lines 1-50 from file (splitting a file)
head -n 50 source-file > dest-file-part1
tail -n +51 source-file > dest-file-part2

# Extract specific line range
sed -n '10,50p' source-file > extracted-section

# Cherry-pick entire commit
git cherry-pick <commit-sha>

# Cherry-pick specific files from a commit
git checkout <commit-sha> -- path/to/file
```

### Forbidden Operations

```bash
# FORBIDDEN: Agent reads file, then writes "equivalent" content
Read(file) -> agent processes -> Write(file)  # NO!

# FORBIDDEN: Agent "improves" or "cleans up" during copy
# FORBIDDEN: Agent regenerates from memory/understanding
```

### File Splitting Protocol

When a single file must be split across MRs:

```bash
# 1. Identify line ranges (agent analyzes, outputs line numbers)
# Agent says: "Split auth.ts: lines 1-100 to MR1, lines 101-250 to MR2"

# 2. Script extracts using sed/head/tail
sed -n '1,100p' source-branch:src/auth.ts > mr1-branch:src/auth.ts
sed -n '101,250p' source-branch:src/auth.ts > mr2-branch:src/auth-handlers.ts

# 3. Agent NEVER touches file contents directly
```

### Binary File Protocol

Binary files (images, compiled assets, PDFs) cannot use text-based extraction tools (`sed`, `head`, `tail`) as they may corrupt the file.

**Detection:**

```bash
is_binary() {
  local filepath="$1"
  file --mime-encoding "$filepath" | grep -q "binary"
}
```

**Copy strategy by file type:**

| File Type | Detection | Copy Method |
|-----------|-----------|-------------|
| Text | `file --mime-encoding` returns charset | `git show`, `sed`, `head/tail` allowed |
| Binary | `file --mime-encoding` returns `binary` | `git checkout` only (byte-exact) |
| Unknown | Detection fails | Treat as binary (safe default) |

**Implementation:**

```bash
copy_file() {
  local src_branch="$1"
  local dest_branch="$2"
  local filepath="$3"

  git checkout "$dest_branch"

  if is_binary "$filepath"; then
    # Binary-safe: direct checkout only
    git checkout "$src_branch" -- "$filepath"
  else
    # Text: can use show/sed if needed for splits
    git show "${src_branch}:${filepath}" > "$filepath"
  fi

  git add "$filepath"
}
```

**Manifest extension for binary files:**

```json
{
  "files": [
    {"path": "src/auth.ts", "operation": "copy", "type": "text"},
    {"path": "assets/logo.png", "operation": "copy", "type": "binary"}
  ]
}
```

**Constraint:** Binary files cannot be split. If a binary file must be in multiple MRs, it must be copied whole to each.

### UTF-8 and Line Ending Edge Cases

File splitting via line-range extraction can fail on edge cases:

| Edge Case | Problem | Mitigation |
|-----------|---------|------------|
| Multi-byte UTF-8 at boundary | Character split mid-byte corrupts file | Use `awk` instead of `sed` for safer boundary handling |
| CRLF line endings | Windows files may have inconsistent splits | Normalize to LF before split, restore after if needed |
| No trailing newline | Last line may be incomplete | Ensure destination has proper EOF handling |
| BOM markers | UTF-8 BOM (0xEF 0xBB 0xBF) at file start | Preserve BOM in first split only |

**Safe split implementation:**

```bash
split_file_safe() {
  local src_file="$1"
  local start_line="$2"
  local end_line="$3"
  local dest_file="$4"

  # Use awk for safer line extraction (handles edge cases better than sed)
  awk -v start="$start_line" -v end="$end_line" \
    'NR >= start && NR <= end' "$src_file" > "$dest_file"

  # Verify output is valid text
  if ! file "$dest_file" | grep -qE "(text|empty)"; then
    echo "WARNING: Split may have corrupted encoding in $dest_file"
    echo "  Source: $src_file, lines $start_line-$end_line"
    return 1
  fi
}
```

**Pre-split validation (agent responsibility):**

Before approving manifest, agent MUST verify:
1. Split boundaries don't break multi-line strings
2. Split boundaries don't break import statements
3. Split boundaries don't break function/class bodies
4. Each split is syntactically valid independently

---

## Programmatic Script Architecture

### Rationale

Mechanical git/glab operations should be scripted, not agent-driven:
- **Reproducibility**: Same inputs = same outputs
- **Speed**: No token overhead for git commands
- **Testability**: Script can be unit tested
- **Auditability**: User can inspect what will happen before execution

### Agent vs Script Responsibilities

| Task | Owner | Why |
|------|-------|-----|
| Analyze diff, propose breakdown | Agent | Requires understanding |
| Present breakdown to user | Agent | Conversational |
| Create branches | Script | Mechanical |
| Copy files between branches | Script | Must be exact |
| Create MRs via glab | Script | Mechanical |
| Update tracking doc | Script | Structured data |
| Cherry-pick commits | Script | Mechanical |
| Sync MR state from GitLab | Script | API calls |

### Script: `gitlab-stack.sh`

Location: `plugin/scripts/gitlab-stack.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# gitlab-stack.sh - Manage stacked MR workflows
#
# Usage:
#   gitlab-stack.sh create <stack-name> <manifest.json>
#   gitlab-stack.sh status <stack-name>
#   gitlab-stack.sh sync <stack-name>
#   gitlab-stack.sh rollup <stack-name>
#   gitlab-stack.sh abandon <stack-name>

COMMAND="${1:-}"
STACK_NAME="${2:-}"

case "$COMMAND" in
  create)
    MANIFEST="${3:?Manifest file required}"
    # Read manifest (agent-generated JSON with breakdown)
    # Create worktree
    # Create branches
    # Copy files per manifest (using git checkout, not agent writes)
    # Create MRs via glab
    # Generate tracking doc
    ;;
  status)
    # Read tracking doc
    # Query glab for MR states
    # Output status
    ;;
  sync)
    # Query glab for MR states
    # Update tracking doc
    ;;
  rollup)
    # Cherry-pick merged commits to root
    # Push root branch
    # Update tracking doc
    ;;
  abandon)
    # Close MRs
    # Remove worktree
    # Delete branches
    # Archive tracking doc
    ;;
esac
```

### Stack Name Validation

Stack names must avoid collision with existing naming conventions:

```bash
validate_stack_name() {
  local name="$1"

  # Cannot start with 'bd-' (reserved for beads system)
  if [[ "$name" == bd-* ]]; then
    echo "ERROR: Stack name cannot start with 'bd-' (reserved for beads)"
    exit 1
  fi

  # Cannot contain slashes (used in branch structure)
  if [[ "$name" == */* ]]; then
    echo "ERROR: Stack name cannot contain '/' (used in branch paths)"
    exit 1
  fi

  # Must be valid git branch name component
  if ! git check-ref-format --branch "stack/${name}" >/dev/null 2>&1; then
    echo "ERROR: Stack name '${name}' is not valid for git branches"
    exit 1
  fi
}
```

**Validation runs before any operations:**

```bash
create_stack() {
  local stack_name="$1"
  validate_stack_name "$stack_name"
  # ... rest of creation
}
```

### Error Recovery and Rollback Protocol

Stack creation must be transactional - either fully succeed or fully roll back.

**Phase model:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: VALIDATE (no side effects)                            │
│  - Validate manifest JSON schema                                 │
│  - Verify source files exist                                    │
│  - Check glab authentication                                    │
│  - Verify stack name available                                  │
│  - Check no conflicting branches exist                          │
├─────────────────────────────────────────────────────────────────┤
│  Phase 2: CREATE (with rollback on failure)                     │
│  - Create worktree         → rollback: remove worktree          │
│  - Create branches         → rollback: delete branches          │
│  - Copy files              → rollback: (covered by branch delete)│
│  - Create MRs via glab     → rollback: close MRs                │
│  - Generate tracking doc   → rollback: delete tracking doc      │
├─────────────────────────────────────────────────────────────────┤
│  Phase 3: COMMIT (point of no return)                           │
│  - Push branches to remote                                      │
│  - Report success                                               │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```bash
create_stack() {
  local stack_name="$1"
  local manifest="$2"
  local project_root
  project_root=$(git rev-parse --show-toplevel)

  # Phase 1: Validate (no side effects)
  echo "Phase 1: Validating..."
  validate_stack_name "$stack_name"
  validate_manifest "$manifest" || { echo "ERROR: Invalid manifest"; exit 1; }
  validate_source_files "$manifest" || { echo "ERROR: Missing source files"; exit 1; }
  check_glab_auth || { echo "ERROR: GitLab auth failed"; exit 1; }
  check_branch_available "$stack_name" || { echo "ERROR: Branch already exists"; exit 1; }

  # Phase 2: Create with rollback trap
  echo "Phase 2: Creating stack..."
  trap 'rollback_stack "$stack_name" "$project_root"' ERR

  create_worktree "$stack_name"
  create_branches "$stack_name" "$manifest"
  copy_files "$stack_name" "$manifest"

  # Track created MRs for potential rollback
  local created_mrs=()
  create_mrs "$stack_name" "$manifest" created_mrs
  generate_tracking_doc "$stack_name" "$manifest" "${created_mrs[@]}"

  # Phase 3: Commit (disable rollback trap)
  trap - ERR
  echo "Phase 3: Pushing to remote..."
  push_branches "$stack_name" "$manifest"

  echo "Stack '$stack_name' created successfully"
}

rollback_stack() {
  local stack_name="$1"
  local project_root="$2"

  echo ""
  echo "ERROR: Stack creation failed. Rolling back..."
  echo ""

  # Close any MRs that were created
  local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"
  if [[ -f "$tracking_doc" ]]; then
    local mrs
    mrs=$(grep -oE '![0-9]+' "$tracking_doc" | sort -u | tr -d '!')
    for mr in $mrs; do
      echo "  Closing MR !${mr}..."
      glab mr close "$mr" 2>/dev/null || true
    done
  fi

  # Remove worktree
  local worktree_path="${project_root}/.worktrees/${stack_name}"
  if [[ -d "$worktree_path" ]]; then
    echo "  Removing worktree..."
    git worktree remove --force "$worktree_path" 2>/dev/null || true
  fi

  # Delete local branches
  echo "  Cleaning up branches..."
  git branch -D "stack/${stack_name}" 2>/dev/null || true
  git for-each-ref --format='%(refname:short)' "refs/heads/stack/${stack_name}/" | \
    xargs -r git branch -D 2>/dev/null || true

  # Delete remote branches (only if pushed)
  git push origin --delete "stack/${stack_name}" 2>/dev/null || true
  git for-each-ref --format='%(refname:short)' "refs/remotes/origin/stack/${stack_name}/" | \
    sed 's|origin/||' | xargs -r -I{} git push origin --delete {} 2>/dev/null || true

  # Remove tracking doc
  if [[ -f "$tracking_doc" ]]; then
    echo "  Removing tracking doc..."
    rm -f "$tracking_doc"
  fi

  echo ""
  echo "Rollback complete. No stack artifacts remain."
  exit 1
}

check_branch_available() {
  local stack_name="$1"

  # Check local
  if git rev-parse --verify "stack/${stack_name}" >/dev/null 2>&1; then
    echo "ERROR: Local branch 'stack/${stack_name}' already exists"
    echo "  Use a different stack name or run 'gitlab-stack.sh abandon ${stack_name}' first"
    return 1
  fi

  # Check remote
  if git ls-remote --heads origin "stack/${stack_name}" | grep -q .; then
    echo "ERROR: Remote branch 'stack/${stack_name}' already exists"
    echo "  Use a different stack name or clean up remote first"
    return 1
  fi

  return 0
}
```

### Manifest Schema (Agent Output)

Agent produces a JSON manifest describing the breakdown:

```json
{
  "stack_name": "auth-system",
  "source_branch": "feature/auth",
  "target_branch": "main",
  "leaves": [
    {
      "id": "1-middleware",
      "title": "Auth middleware",
      "files": [
        {"path": "src/middleware/auth.ts", "operation": "copy"},
        {"path": "src/types/auth.ts", "operation": "copy"}
      ],
      "depends_on": []
    },
    {
      "id": "2-routes",
      "title": "User routes",
      "files": [
        {"path": "src/routes/user.ts", "operation": "copy"},
        {"path": "src/controllers/user.ts", "operation": "copy"}
      ],
      "depends_on": ["1-middleware"]
    },
    {
      "id": "3-tests",
      "title": "Integration tests",
      "files": [
        {"path": "tests/auth/", "operation": "copy_dir"}
      ],
      "depends_on": ["1-middleware", "2-routes"]
    }
  ],
  "file_splits": [
    {
      "source": "src/auth.ts",
      "splits": [
        {"target": "src/auth-core.ts", "lines": "1-100", "leaf": "1-middleware"},
        {"target": "src/auth-handlers.ts", "lines": "101-250", "leaf": "2-routes"}
      ]
    }
  ]
}
```

### Script Operations Detail

**File copy (exact)**:
```bash
copy_file() {
  local src_branch="$1"
  local dest_branch="$2"
  local filepath="$3"

  git checkout "$dest_branch"
  git checkout "$src_branch" -- "$filepath"
  git add "$filepath"
}
```

**File split (exact, by line)**:
```bash
split_file() {
  local src_branch="$1"
  local src_file="$2"
  local dest_file="$3"
  local start_line="$4"
  local end_line="$5"

  git show "${src_branch}:${src_file}" | sed -n "${start_line},${end_line}p" > "$dest_file"
  git add "$dest_file"
}
```

**Cherry-pick (exact)**:
```bash
rollup_commits() {
  local stack_name="$1"
  local tracking_doc="docs/mr-stacks/${stack_name}.md"

  git checkout "stack/${stack_name}"

  # Read merged commits from tracking doc
  commits=$(grep -E '^\| !.*MERGED' "$tracking_doc" | awk '{print $6}')

  for commit in $commits; do
    git cherry-pick "$commit"
  done

  git push origin "stack/${stack_name}"
}
```

### Rollup Race Condition Protection

A race condition can occur if a rollup is initiated while a leaf MR is still being updated.

**Scenario:**
1. User A runs `/gitlab-stack rollup` on `auth-system`
2. User B pushes new commit to `stack/auth-system/2-routes` (already merged MR)
3. Rollup cherry-picks stale commit, User B's changes are orphaned

**Protection: Pre-rollup verification**

```bash
rollup_commits_safe() {
  local stack_name="$1"
  local tracking_doc="docs/mr-stacks/${stack_name}.md"
  local project_root
  project_root=$(git rev-parse --show-toplevel)

  echo "Verifying all leaf MRs are in merged state..."

  # Get all leaf MRs from tracking doc
  local leaf_mrs
  leaf_mrs=$(grep -oE '!\d+' "$tracking_doc" | grep -v "$(get_root_mr "$stack_name")" | tr -d '!' | sort -u)

  local all_merged=true
  local pending_mrs=()

  for mr in $leaf_mrs; do
    local state
    state=$(glab api "projects/:fullpath/merge_requests/${mr}" 2>/dev/null | jq -r '.state')

    case "$state" in
      merged)
        echo "  !${mr}: MERGED (ok)"
        ;;
      opened|open)
        echo "  !${mr}: OPEN (not merged)"
        all_merged=false
        pending_mrs+=("$mr")
        ;;
      closed)
        echo "  !${mr}: CLOSED (abandoned?)"
        all_merged=false
        pending_mrs+=("$mr")
        ;;
      *)
        echo "  !${mr}: UNKNOWN STATE '${state}'"
        all_merged=false
        pending_mrs+=("$mr")
        ;;
    esac
  done

  if [[ "$all_merged" != "true" ]]; then
    echo ""
    echo "ERROR: Cannot rollup - not all leaf MRs are merged"
    echo "  Pending MRs: ${pending_mrs[*]}"
    echo ""
    echo "Options:"
    echo "  1. Wait for pending MRs to be reviewed and merged"
    echo "  2. Close pending MRs if no longer needed"
    echo "  3. Use --force to rollup only merged MRs (not recommended)"
    exit 1
  fi

  # Verify merge commits are available
  echo ""
  echo "Fetching latest from remote..."
  git fetch origin "stack/${stack_name}"

  # Now safe to cherry-pick
  echo ""
  echo "All leaf MRs merged. Proceeding with rollup..."

  git checkout "stack/${stack_name}"

  for mr in $leaf_mrs; do
    local merge_commit
    merge_commit=$(glab api "projects/:fullpath/merge_requests/${mr}" | jq -r '.merge_commit_sha')

    if [[ -z "$merge_commit" || "$merge_commit" == "null" ]]; then
      echo "ERROR: No merge commit found for !${mr}"
      exit 1
    fi

    echo "Cherry-picking !${mr} (commit: ${merge_commit:0:7})..."
    git cherry-pick "$merge_commit" || {
      echo "ERROR: Cherry-pick failed for !${mr}"
      echo "  Resolve conflicts and run: git cherry-pick --continue"
      echo "  Or abort with: git cherry-pick --abort"
      exit 1
    }
  done

  echo ""
  echo "Pushing rolled-up root branch..."
  git push origin "stack/${stack_name}"

  echo ""
  echo "Rollup complete. Root MR now contains all changes."
}
```

### Workflow with Script

```
┌─────────────────────────────────────────────────────────────┐
│  1. User: /gitlab-stack                                     │
├─────────────────────────────────────────────────────────────┤
│  2. Agent: Analyzes diff, collaborates with Product         │
│     - Reads git diff (via Bash)                            │
│     - Proposes breakdown                                    │
│     - Outputs manifest.json                                │
├─────────────────────────────────────────────────────────────┤
│  3. User: Approves breakdown                                │
├─────────────────────────────────────────────────────────────┤
│  4. Agent: Invokes script                                   │
│     gitlab-stack.sh create auth-system manifest.json        │
├─────────────────────────────────────────────────────────────┤
│  5. Script: Executes mechanically                           │
│     - Creates worktree                                      │
│     - Creates branches                                      │
│     - Copies files (git checkout, NEVER agent write)       │
│     - Creates MRs via glab                                 │
│     - Generates tracking doc                               │
├─────────────────────────────────────────────────────────────┤
│  6. Agent: Reports results to user                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Updated Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| Skill | `plugin/skills/gitlab-stack/SKILL.md` | Agent workflow (analysis only) |
| Command | `plugin/commands/gitlab-stack.md` | Slash command definition |
| **Script** | `plugin/scripts/gitlab-stack.sh` | **Mechanical operations (NEW)** |
| Tracking | `docs/mr-stacks/{name}.md` | Persistent state |
| Worktree | `.worktrees/{name}/` | Git isolation |
| Branches | `stack/{name}/*` | Branch naming |

**Key principle**: Agent thinks, script acts. File contents are NEVER touched by agent tools.

---

## Feedback Cycle: MR Review Integration

### Overview

After MRs are created, the workflow enters a feedback loop:

```
┌─────────────────────────────────────────────────────────────┐
│                    FEEDBACK CYCLE                           │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │  Sync    │───▶│  Pull    │───▶│ Examine  │───▶│ Draft │ │
│  │  State   │    │ Comments │    │ Feedback │    │ Fixes │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│       ▲                                              │      │
│       └──────────────────────────────────────────────┘      │
│                     (iterate until approved)                │
└─────────────────────────────────────────────────────────────┘
```

### Commands

| Command | Purpose |
|---------|---------|
| `/gitlab-stack sync` | Update tracking doc with current MR states from GitLab |
| `/gitlab-stack comments [MR]` | Pull comments from specific MR or all stack MRs |
| `/gitlab-stack fix [MR]` | Spawn Architect agent to draft fixes for comments |

### Phase: Sync State

Update tracking doc with live GitLab data:

```bash
gitlab-stack.sh sync <stack-name>

# For each MR in stack:
# - Query state (open, merged, closed)
# - Query approvals count
# - Query pipeline status
# - Query unresolved threads count
# - Update docs/mr-stacks/{stack-name}.md
```

**Tracking doc update**:

```markdown
## MR Status (synced: 2026-01-11T14:30:00Z)

| MR | Title | State | Pipeline | Approvals | Threads |
|----|-------|-------|----------|-----------|---------|
| !101 | Auth middleware | MERGED | ✓ passed | 2/2 | 0 |
| !102 | User routes | OPEN | ✓ passed | 1/2 | 3 unresolved |
| !103 | Tests | DRAFT | - | 0/2 | 0 |
```

### Phase: Pull Comments

Fetch review comments into local context:

```bash
# Pull all comments for a specific MR
glab mr note list 102 --json > /tmp/mr-102-comments.json

# Or via API for more detail (threads, resolved status)
glab api projects/:fullpath/merge_requests/102/discussions
```

**Output format** (agent-readable):

```markdown
## Review Comments: !102 (User Routes)

### Thread 1 (UNRESOLVED) - src/routes/user.ts:45
**@reviewer** (2026-01-11 10:15):
> This endpoint should validate the user ID format before querying the database.
> Consider using a Zod schema.

**@author** (2026-01-11 10:30):
> Good point. Should I add validation here or in the middleware?

**@reviewer** (2026-01-11 10:45):
> Middleware would be better for reusability.

---

### Thread 2 (UNRESOLVED) - src/controllers/user.ts:78
**@reviewer** (2026-01-11 11:00):
> Missing error handling for the case where user is not found.
> Should return 404, not 500.

---

### Thread 3 (RESOLVED) - src/routes/user.ts:12
**@reviewer** (2026-01-11 09:00):
> Typo in route path: `/uesr` should be `/user`

**Resolution**: Fixed in commit abc1234
```

### Phase: Examine Feedback

Agent categorizes comments by type and severity:

```markdown
## Feedback Analysis: !102

### Blocking Issues (must fix before merge)
1. **Missing validation** - src/routes/user.ts:45
   - Add Zod schema validation in middleware
   - Reviewer: @reviewer

2. **Missing error handling** - src/controllers/user.ts:78
   - Return 404 for user not found
   - Reviewer: @reviewer

### Suggestions (nice to have)
- None

### Questions (need response)
- None (all answered in threads)

### Already Resolved
- Typo fix (commit abc1234)

**Recommendation**: 2 blocking issues require fixes before merge approval.
```

### Phase: Draft Fixes

User requests fixes:

```
User: /gitlab-stack fix 102
```

Agent workflow:

1. **Read feedback analysis** from tracking doc or fresh pull
2. **Spawn Architect agent** to draft fix approach:
   ```
   Task(subagent_type: "agent-ecosystem:architect",
        prompt: "Draft fixes for MR !102 feedback:
                 1. Add Zod validation in middleware for user ID
                 2. Add 404 handling for user not found

                 Output: JSON manifest with file changes needed.
                 DO NOT write code - output line ranges and descriptions.")
   ```

3. **Architect outputs fix manifest**:
   ```json
   {
     "mr": "102",
     "fixes": [
       {
         "issue": "Missing validation",
         "file": "src/middleware/validation.ts",
         "action": "create",
         "description": "New file: Zod schema for user ID validation",
         "estimated_lines": 25
       },
       {
         "issue": "Missing validation",
         "file": "src/routes/user.ts",
         "action": "modify",
         "line_range": "44-50",
         "description": "Add validation middleware to route"
       },
       {
         "issue": "Missing error handling",
         "file": "src/controllers/user.ts",
         "action": "modify",
         "line_range": "75-85",
         "description": "Add null check and 404 response"
       }
     ]
   }
   ```

4. **User approves fix plan**

5. **Spawn Coding agent** to implement (in correct worktree/branch):
   ```
   Task(subagent_type: "agent-ecosystem:coding",
        prompt: "Implement fixes per manifest for MR !102.
                 Work in: .worktrees/{stack}/
                 Branch: stack/{stack}/2-routes

                 Fixes:
                 1. Create src/middleware/validation.ts with Zod schema
                 2. Modify src/routes/user.ts:44-50 to use validation
                 3. Modify src/controllers/user.ts:75-85 for 404 handling

                 Commit with message: 'fix: address review feedback for !102'")
   ```

6. **Push and notify**:
   ```bash
   git push origin stack/{stack}/2-routes
   # MR automatically updates

   # Optionally reply to threads
   glab mr note create 102 --message "Addressed in latest push: added validation middleware and 404 handling"
   ```

### Tracking Doc: Feedback Section

Add to `docs/mr-stacks/{stack-name}.md`:

```markdown
## Feedback History

### !102 - User Routes

#### Round 1 (2026-01-11)
- **Pulled**: 3 threads (2 unresolved, 1 resolved)
- **Blocking**: 2 issues identified
- **Fix commit**: def5678 "fix: address review feedback"
- **Status**: Pushed, awaiting re-review

#### Round 2 (2026-01-12)
- **Pulled**: 1 new thread
- **Blocking**: 0
- **Status**: Approved by @reviewer
```

### Full Feedback Cycle Workflow

```
┌────────────────────────────────────────────────────────────────┐
│ User: /gitlab-stack sync auth-system                           │
├────────────────────────────────────────────────────────────────┤
│ Script: Queries GitLab API, updates tracking doc               │
│ Output: "!102 has 3 unresolved threads"                        │
├────────────────────────────────────────────────────────────────┤
│ User: /gitlab-stack comments 102                               │
├────────────────────────────────────────────────────────────────┤
│ Script: Pulls comments via glab                                │
│ Agent: Categorizes into blocking/suggestions/questions         │
│ Output: Feedback analysis with 2 blocking issues               │
├────────────────────────────────────────────────────────────────┤
│ User: /gitlab-stack fix 102                                    │
├────────────────────────────────────────────────────────────────┤
│ Agent: Spawns Architect to draft fix approach                  │
│ Architect: Outputs fix manifest (files, line ranges)           │
│ User: Approves fix plan                                        │
├────────────────────────────────────────────────────────────────┤
│ Agent: Spawns Coding agent with manifest                       │
│ Coding: Implements fixes in correct branch                     │
│ Script: Pushes changes                                         │
│ Output: "Fixes pushed to !102, awaiting re-review"            │
├────────────────────────────────────────────────────────────────┤
│ User: /gitlab-stack sync auth-system                           │
│ Output: "!102 approved, ready for merge"                       │
└────────────────────────────────────────────────────────────────┘
```

### Script Additions

```bash
# gitlab-stack.sh additions

comments)
  MR_ID="${3:?MR ID required}"
  STACK_NAME="$2"

  # Fetch discussions (threads with context)
  glab api "projects/:fullpath/merge_requests/${MR_ID}/discussions" | \
    jq -r '.[] | select(.notes[0].resolvable == true)' > \
    "/tmp/mr-${MR_ID}-threads.json"

  # Output in readable format for agent
  # ... format as markdown
  ;;

reply)
  MR_ID="${3:?MR ID required}"
  MESSAGE="${4:?Message required}"

  glab mr note create "$MR_ID" --message "$MESSAGE"
  ;;
```

### Integration with Existing Skills

| Existing Skill | Integration |
|----------------|-------------|
| `/gitlab-pull-comments` | Enhanced version becomes `/gitlab-stack comments` |
| `/architect` | Spawned for fix planning |
| `/code` | Spawned for fix implementation |
| `/review` | Can be run locally before pushing fixes |

### Human Gates in Feedback Cycle

1. **Before pulling comments**: None (read-only)
2. **Before drafting fixes**: User explicitly requests `/gitlab-stack fix`
3. **Before implementing**: User approves Architect's fix manifest
4. **Before pushing**: User can review local changes first

---

## MR Description Generation: Agent-Crafted Design Overview

### Overview

Each MR description is a **terse, informative design doc** crafted through agent collaboration:

```
┌─────────────────────────────────────────────────────────────┐
│              MR DESCRIPTION GENERATION                       │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Spelunk  │───▶│ Product  │───▶│Architect │───▶│ Craft │ │
│  │  (code)  │    │ (value)  │    │(technical)│   │  MR   │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│                                                             │
│  Input: Most recent commit only (MR-specific changes)       │
│  Output: Terse design doc as MR description                 │
└─────────────────────────────────────────────────────────────┘
```

### Constraint: Most Recent Commit Only

MR descriptions are generated from **only the most recent commit** on that branch:

```bash
# Get the single commit that represents this MR's changes
git log -1 --format="%H" stack/${stack_name}/${leaf_id}

# Get diff for that commit only
git show --stat <commit>
git show <commit>
```

**Why single commit?**
- Each leaf MR should be one logical unit of work
- Avoids confusion from WIP commits
- Clean for cherry-pick roll-up later

### Phase 1: Spelunk (No Doc Saved)

Code agent analyzes the commit **in-memory only** - no `docs/spelunk/` output:

```bash
# Get changed files in this commit
git diff-tree --no-commit-id --name-only -r <commit>

# For each file, extract:
# - Function/class signatures changed
# - Dependencies added/removed
# - Public API changes
```

**Spelunk output** (ephemeral, passed to next agents):

```markdown
## Code Analysis: stack/auth-system/1-middleware (commit abc1234)

### Files Changed
- src/middleware/auth.ts (new file, 85 lines)
- src/types/auth.ts (new file, 23 lines)

### Key Constructs
- `AuthMiddleware` class: validates JWT tokens, extracts user context
- `AuthConfig` interface: configurable issuer, audience, algorithms
- `withAuth()` higher-order function: wraps route handlers

### Dependencies Added
- `jsonwebtoken@9.0.0` - JWT verification
- `zod@3.22.0` - Config validation

### Public API
- Export: `AuthMiddleware`, `AuthConfig`, `withAuth`
- No breaking changes to existing APIs
```

### Phase 2: Product Perspective

Product agent adds user/business value context:

```markdown
## Product Value

### What This Enables
- API endpoints can now require authentication
- User identity available in request context
- Foundation for role-based access control

### User Impact
- End users: No visible change (infrastructure)
- Developers: Can add `withAuth()` to any route

### Dependencies
- Requires: Nothing (self-contained)
- Enables: User routes (!102), admin features (future)
```

### Phase 3: Architect Perspective

Architect agent adds technical design rationale:

```markdown
## Technical Design

### Approach
Middleware pattern chosen over route-level auth for:
- Single point of enforcement
- Consistent error handling
- Easy to audit

### Alternatives Considered
- Per-route validation: Rejected (duplication risk)
- Global auth: Rejected (some routes need public access)

### Trade-offs
- (+) Reusable across all routes
- (+) Testable in isolation
- (-) Slight overhead on public routes (skipped via config)
```

### Phase 4: Craft MR Description

Combine into terse design doc format:

```markdown
## Summary

Add JWT authentication middleware for request validation. Enables protected API endpoints with user context extraction.

## Design

**Approach**: Middleware pattern with `withAuth()` wrapper for route-level opt-in.

**Key Components**:
| Component | Purpose |
|-----------|---------|
| `AuthMiddleware` | JWT validation, user extraction |
| `AuthConfig` | Configurable issuer/audience |
| `withAuth()` | Route wrapper for protected endpoints |

**Dependencies**: `jsonwebtoken`, `zod`

## Changes

```
+ src/middleware/auth.ts    (85 lines) - Core middleware
+ src/types/auth.ts         (23 lines) - Type definitions
```

## Why This Matters

- **Enables**: Protected routes, user context in handlers
- **Required by**: User routes (!102), admin features

## Alternatives Considered

- Per-route validation: Rejected (duplication)
- Global auth: Rejected (need public routes)

---
Part of [auth-system stack](../docs/mr-stacks/auth-system.md) | Commit: `abc1234`
```

### Tiered Description Pipeline

MR descriptions use a tiered approach based on change size to balance quality with efficiency.

**Tier selection:**

| MR Size | Lines Changed | Pipeline | Agent Invocations |
|---------|---------------|----------|-------------------|
| Small | < 50 lines | Fast | 1 (Spelunk only) |
| Medium | 50-200 lines | Standard | 2 (Spelunk + Architect) |
| Large | > 200 lines | Full | 3 (Spelunk + Product || Architect) |

**Rationale:**
- Small changes (typo fixes, config tweaks) don't need product/architect perspectives
- Medium changes need technical rationale but product value is often obvious
- Large changes benefit from full multi-agent analysis

**Size detection:**

```bash
get_mr_size_tier() {
  local commit="$1"
  local lines_changed

  lines_changed=$(git show --stat "$commit" | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | \
    awk '{sum += $1} END {print sum}')

  if [[ "$lines_changed" -lt 50 ]]; then
    echo "small"
  elif [[ "$lines_changed" -lt 200 ]]; then
    echo "medium"
  else
    echo "large"
  fi
}
```

### Agent Orchestration (Tiered)

```python
# Pseudocode for tiered MR description generation

def generate_mr_description(stack_name, leaf_id):
    # 1. Get most recent commit only
    commit = git_log_1(f"stack/{stack_name}/{leaf_id}")
    diff = git_show(commit)
    lines_changed = get_lines_changed(commit)

    # 2. Spelunk (always required, no doc saved)
    code_analysis = Task(
        subagent_type="agent-ecosystem:coding",
        prompt=f"""Analyze this commit for MR description (DO NOT save spelunk doc):

        Commit: {commit}
        Diff:
        {diff}

        Output JSON:
        - files_changed: list of files with line counts
        - key_constructs: functions/classes/interfaces added/changed
        - dependencies: packages added/removed
        - public_api: exports, breaking changes
        """
    )

    # 3. Tier-based additional analysis
    if lines_changed < 50:
        # SMALL: Fast path - template fill from spelunk only
        return craft_simple_description(code_analysis)

    elif lines_changed < 200:
        # MEDIUM: Add architect perspective only
        tech_design = Task(
            subagent_type="agent-ecosystem:architect",
            prompt=f"""Add technical design rationale to MR description:

            Code analysis: {code_analysis}

            Output:
            - approach: why this design
            - alternatives: what was considered
            - tradeoffs: pros/cons
            """
        )
        return craft_medium_description(code_analysis, tech_design)

    else:
        # LARGE: Full pipeline with parallel Product + Architect
        # See "Parallel Agent Execution" section below
        product_value, tech_design = run_parallel([
            Task(
                subagent_type="agent-ecosystem:product",
                prompt=f"""Add product perspective to MR description:

                Code analysis: {code_analysis}

                Output:
                - what_enables: user-facing capabilities
                - user_impact: who benefits and how
                - dependencies: what this requires/enables
                """
            ),
            Task(
                subagent_type="agent-ecosystem:architect",
                prompt=f"""Add technical design rationale to MR description:

                Code analysis: {code_analysis}

                Output:
                - approach: why this design
                - alternatives: what was considered
                - tradeoffs: pros/cons
                """
            )
        ])

        return craft_full_description(code_analysis, product_value, tech_design)
```

### Parallel Agent Execution

For large MRs (>200 lines), Product and Architect agents run in parallel after Spelunk completes.

**Execution flow:**

```
                                    ┌─────────────────────┐
                                    │  Product Agent      │
                    ┌──────────────▶│  (value analysis)   │─────┐
                    │               └─────────────────────┘     │
┌──────────────┐    │                                           │    ┌───────────┐
│   Spelunk    │────┤                                           ├───▶│   Craft   │
│  (required)  │    │               ┌─────────────────────┐     │    │    MR     │
└──────────────┘    │               │  Architect Agent    │     │    └───────────┘
                    └──────────────▶│  (design rationale) │─────┘
                                    └─────────────────────┘

Sequential: Spelunk must complete first
Parallel:   Product and Architect run concurrently
Sequential: Craft waits for both to complete
```

**Why parallel?**
- Product and Architect both depend only on Spelunk output
- No dependency between Product and Architect
- Reduces total latency from 3 sequential to 2 sequential steps

**Implementation:**

```python
def run_parallel(tasks):
    """Run multiple agent tasks concurrently, wait for all to complete."""
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = [executor.submit(execute_task, task) for task in tasks]
        results = [future.result() for future in concurrent.futures.as_completed(futures)]

    return results
```

**Fallback for small changes:**

For changes < 50 lines, skip Product and Architect entirely:

```python
def craft_simple_description(code_analysis):
    """Generate minimal MR description from spelunk output only."""
    return f"""## Summary

{code_analysis.summary}

## Changes

```
{code_analysis.file_stats}
```

---
Generated from commit `{code_analysis.commit_sha}`
"""
```

### Cost/Latency Comparison

| Tier | Agent Calls | Latency (parallel) | Token Cost |
|------|-------------|-------------------|------------|
| Small (<50 lines) | 1 | ~5s | Low |
| Medium (50-200 lines) | 2 | ~10s | Medium |
| Large (>200 lines) | 3 (2 parallel) | ~12s | High |

**For a 5-MR stack:**

| Scenario | Previous (sequential) | New (tiered + parallel) |
|----------|----------------------|-------------------------|
| All small | 15 calls | 5 calls |
| Mixed (2S, 2M, 1L) | 15 calls | 9 calls (2 parallel) |
| All large | 15 calls | 15 calls (10 parallel) |

Parallel execution reduces wall-clock time even when call count is the same.

### MR Description Template

```markdown
## Summary

<1-2 sentences: what and why>

## Design

**Approach**: <1 sentence design choice>

**Key Components**:
| Component | Purpose |
|-----------|---------|
| `Name` | Brief description |

**Dependencies**: <packages if any>

## Changes

```
<git diff --stat output>
```

## Why This Matters

- **Enables**: <what this unlocks>
- **Required by**: <dependent MRs if any>

## Alternatives Considered

- <Option>: <Why rejected>

---
Part of [<stack> stack](../docs/mr-stacks/<stack>.md) | Commit: `<sha>`
```

### Integration with Stack Creation

When `/gitlab-stack create` generates MRs:

```bash
# For each leaf MR
for leaf in "${leaves[@]}"; do
  # 1. Agent generates description via collaboration
  description=$(generate_mr_description "$stack_name" "$leaf")

  # 2. Script creates MR with generated description
  glab mr create \
    --source-branch "stack/${stack_name}/${leaf}" \
    --target-branch "stack/${stack_name}" \
    --title "<title from manifest>" \
    --description "$description"
done
```

### Key Constraints

1. **Single commit only**: Each MR analyzes only its most recent commit
2. **No spelunk doc**: Analysis is ephemeral, not persisted to `docs/spelunk/`
3. **Terse output**: Design doc overview, not full design doc
4. **Tiered analysis**: Agent involvement scales with change size (small: 1 agent, medium: 2, large: 3)
5. **Parallel execution**: Product and Architect run concurrently for large changes

### Human Gate

User can review/edit generated description before MR creation:

```
Generated MR description for 1-middleware:

[... description ...]

Accept? [y/edit/regenerate]
```

---

## Review-Driven Additions

This section documents additions made in response to Architecture Review (`docs/plans/architect/gitlab-stack-design-review.md`) and Product Validation (`docs/plans/product/validations/gitlab-stack-design-v2.md`).

### Issues Addressed

| Issue | Source | Section Added | Status |
|-------|--------|---------------|--------|
| Binary file detection protocol | Arch Review 1.1 | Binary File Protocol | COMPLETE |
| UTF-8/CRLF edge cases | Arch Review 1.2 | UTF-8 and Line Ending Edge Cases | COMPLETE |
| Script rollback/transaction semantics | Arch Review 2.2 | Error Recovery and Rollback Protocol | COMPLETE |
| Race condition: concurrent stack creation | Arch Review 5 | check_branch_available() in rollback section | COMPLETE |
| Race condition: rollup while leaf updating | Arch Review 5 | Rollup Race Condition Protection | COMPLETE |
| Stack name validation | Arch Review 5 | Stack Name Validation | COMPLETE |
| Tiered MR description pipeline | Arch Review 4.1, Product 4 | Tiered Description Pipeline | COMPLETE |
| Parallelize Product+Architect | Product 4 | Parallel Agent Execution | COMPLETE |

### Summary of New Sections

1. **Binary File Protocol** - Detects binary vs text files, uses `git checkout` only for binaries to prevent corruption

2. **UTF-8 and Line Ending Edge Cases** - Uses `awk` for safer splitting, validates output encoding, documents edge cases

3. **Stack Name Validation** - Blocks `bd-*` prefix (reserved for beads), validates git branch name compatibility

4. **Error Recovery and Rollback Protocol** - Three-phase transactional model (validate/create/commit), automatic rollback on failure

5. **Rollup Race Condition Protection** - Verifies all leaf MRs are merged state before cherry-picking, prevents orphaned changes

6. **Tiered Description Pipeline** - Small (<50 lines): 1 agent, Medium (50-200): 2 agents, Large (>200): 3 agents

7. **Parallel Agent Execution** - Product and Architect run concurrently after Spelunk for large changes

### Remaining Items (Out of Scope)

| Item | Source | Decision |
|------|--------|----------|
| Manifest schema versioning | Product suggestion | Defer to implementation |
| Commit message templates in manifest | Arch Review 2.1 | Defer to implementation |
| Spelunk caching in tracking doc | Arch Review 4.2 | Defer - may add complexity without clear benefit |
| CRLF normalization | Arch Review (nice-to-have) | Document only, don't enforce |

---

*Design document updated 2026-01-11 to address review findings.*
