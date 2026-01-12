# GitLab Stack Design - Architecture Review

**Document:** `docs/plans/architect/gitlab-stack-design.md`
**Review Date:** 2026-01-11
**Focus Areas:** File Content Integrity, Programmatic Script, Feedback Cycle, MR Description Generation

---

## Executive Summary

The design is **architecturally sound** with well-defined boundaries between agent intelligence and script execution. Four specific gaps and two race conditions are identified below, along with recommended mitigations.

| Section | Verdict | Issues Found |
|---------|---------|--------------|
| File Content Integrity | APPROVED with gaps | 2 edge cases need addressing |
| Programmatic Script Architecture | APPROVED with gaps | 1 schema gap, 1 error handling gap |
| Feedback Cycle | APPROVED | Sound orchestration |
| MR Description Generation | NEEDS REVISION | Pipeline overhead concern |

---

## 1. File Content Integrity (Lines 516-594)

### Assessment: APPROVED with 2 edge cases

The constraint is well-articulated and the approved operations list is comprehensive. The "agent MUST NOT" / "agent MUST" framing is clear and enforceable.

### Gap 1.1: Binary Files Not Addressed

**Issue:** The approved operations assume text files. Binary files (images, compiled assets, PDFs) copied via `git show` or `sed` could be corrupted if piped through text-mode operations.

**Edge case scenarios:**
- A leaf MR includes updated favicon.ico
- Documentation includes PNG diagrams
- Build artifacts accidentally staged

**Recommended mitigation:**

```bash
# Add binary detection before copy
is_binary() {
  file --mime-encoding "$1" | grep -q "binary"
}

copy_file() {
  local src_branch="$1"
  local dest_branch="$2"
  local filepath="$3"

  if is_binary "$filepath"; then
    # Binary-safe: checkout directly
    git checkout "$dest_branch"
    git checkout "$src_branch" -- "$filepath"
  else
    # Text: can use show/sed if needed
    git show "${src_branch}:${filepath}" > "$filepath"
  fi
}
```

**Add to design:** "Binary File Protocol" subsection under File Content Integrity.

### Gap 1.2: File Splitting Boundary Conditions

**Issue:** The `sed -n '1,100p'` approach assumes clean line boundaries. Edge cases:

1. **Multi-byte characters split mid-byte** - UTF-8 files with multi-byte chars at line 100
2. **CRLF vs LF** - Windows-edited files in Unix pipeline
3. **No trailing newline** - Last line may be incomplete

**Recommended mitigation:**

```bash
split_file() {
  local src_file="$1"
  local start_line="$2"
  local end_line="$3"
  local dest_file="$4"

  # Use awk for safer splitting (handles edge cases)
  awk -v start="$start_line" -v end="$end_line" \
    'NR >= start && NR <= end' "$src_file" > "$dest_file"

  # Verify byte integrity
  if ! file "$dest_file" | grep -q "text"; then
    echo "WARNING: Split may have corrupted encoding"
  fi
}
```

**Add to design:** Note that file splits should be validated by the agent before manifest approval. Agent should confirm line numbers don't split multi-line strings, imports, or function bodies.

---

## 2. Programmatic Script Architecture (Lines 596-811)

### Assessment: APPROVED with 2 gaps

The agent/script boundary is correctly drawn. The manifest schema captures the key elements.

### Gap 2.1: Manifest Schema Missing Commit Message Templates

**Issue:** The manifest (lines 678-719) specifies files but not commit messages. When the script commits changes per leaf, it needs:

1. Commit message for the leaf branch
2. Whether to squash or preserve commits

**Current schema:**
```json
{
  "leaves": [
    {
      "id": "1-middleware",
      "title": "Auth middleware",
      "files": [...]
    }
  ]
}
```

**Recommended addition:**
```json
{
  "leaves": [
    {
      "id": "1-middleware",
      "title": "Auth middleware",
      "commit_message": "feat(auth): add JWT middleware for request validation",
      "squash": true,
      "files": [...]
    }
  ]
}
```

This ensures the script can create semantically meaningful commits without agent involvement post-manifest.

### Gap 2.2: Script Error Recovery Not Specified

**Issue:** The script pseudocode (lines 624-670) shows the happy path but not failure handling.

**Critical failure scenarios:**

| Failure Point | Current Behavior | Risk |
|---------------|------------------|------|
| `git worktree add` fails (exists) | Script crashes | Partial state |
| `glab mr create` fails (auth) | Script crashes | Branches exist, no MRs |
| File copy fails (deleted in source) | Script crashes | Partial MR state |

**Recommended mitigation:** Add transaction-like semantics:

```bash
create_stack() {
  local stack_name="$1"
  local manifest="$2"

  # Phase 1: Validate (no side effects)
  validate_manifest "$manifest" || { echo "Invalid manifest"; exit 1; }
  validate_source_files "$manifest" || { echo "Missing source files"; exit 1; }
  check_glab_auth || { echo "GitLab auth failed"; exit 1; }

  # Phase 2: Create (with rollback on failure)
  trap 'rollback_stack "$stack_name"' ERR

  create_worktree "$stack_name"
  create_branches "$stack_name" "$manifest"
  copy_files "$stack_name" "$manifest"
  create_mrs "$stack_name" "$manifest"
  generate_tracking_doc "$stack_name" "$manifest"

  trap - ERR
  echo "Stack created successfully"
}

rollback_stack() {
  local stack_name="$1"
  echo "ERROR: Rolling back partial stack creation..."
  # Close any MRs that were created
  # Remove worktree
  # Delete branches
  # Clean up tracking doc
}
```

**Add to design:** "Error Recovery Protocol" subsection with rollback semantics.

---

## 3. Feedback Cycle (Lines 814-1113)

### Assessment: APPROVED - Orchestration is sound

The 4-phase cycle (Sync -> Pull Comments -> Examine -> Draft Fixes) is well-structured with appropriate human gates.

### Strength: Agent Delegation Pattern

The fix workflow correctly delegates:
1. Architect drafts fix approach (outputs manifest)
2. User approves manifest
3. Coding agent implements (in correct worktree/branch)
4. Script pushes

This maintains the agent/script boundary established earlier.

### Strength: Human Gates at Correct Points

| Gate | When | Purpose |
|------|------|---------|
| None | Sync/pull comments | Read-only, safe |
| User requests `/gitlab-stack fix` | Before drafting | Explicit intent |
| User approves fix manifest | Before implementing | Control over changes |
| Optional review | Before push | Final check |

### Minor Observation: Integration with Existing Skills

The design correctly notes that `/gitlab-pull-comments` becomes `/gitlab-stack comments`. Ensure the existing skill is deprecated or redirects to avoid confusion.

---

## 4. MR Description Generation (Lines 1115-1416)

### Assessment: NEEDS REVISION - Pipeline overhead concern

The 3-agent pipeline (Spelunk -> Product -> Architect) for each MR description is thorough but potentially excessive.

### Issue 4.1: Pipeline Overhead for Small MRs

**Problem:** For a stack of 5 leaf MRs, this spawns:
- 5 Spelunk tasks (Code agent)
- 5 Product tasks
- 5 Architect tasks
- = 15 agent invocations just for descriptions

**Cost analysis:**
- Token overhead: Each task spawn has context overhead
- Latency: Sequential dependencies (Spelunk -> Product -> Architect)
- User experience: Long wait before MRs appear

**Recommendation:** Tiered approach based on MR size:

| MR Size | Description Pipeline |
|---------|---------------------|
| < 50 lines | Single-agent: Code spelunk + template fill |
| 50-200 lines | Two-agent: Spelunk + Architect |
| > 200 lines | Full pipeline: Spelunk + Product + Architect |

**Implementation:**

```python
def generate_mr_description(stack_name, leaf_id):
    commit = git_log_1(f"stack/{stack_name}/{leaf_id}")
    stats = git_diff_stat(commit)
    lines_changed = parse_lines_from_stat(stats)

    if lines_changed < 50:
        # Fast path: single agent
        return quick_description(commit)
    elif lines_changed < 200:
        # Medium path: technical focus
        code = spelunk(commit)
        arch = architect_perspective(code)
        return craft_description(code, None, arch)
    else:
        # Full path: all perspectives
        code = spelunk(commit)
        product = product_perspective(code)
        arch = architect_perspective(code)
        return craft_description(code, product, arch)
```

### Issue 4.2: Ephemeral Spelunk Risks Inconsistency

**Problem:** The design states "Spelunk (No Doc Saved)" - analysis is ephemeral. If the MR description needs regeneration later (after edits), the spelunk output may differ.

**Scenarios:**
1. User requests `regenerate` after editing description
2. MR updated with new commits, description refresh needed
3. Stack sync pulls updated file list, descriptions stale

**Recommendation:** Cache spelunk output in tracking doc:

```markdown
## MR Descriptions Cache

### !101 - Auth Middleware

**Spelunk (generated 2026-01-11T10:30:00Z, commit abc1234):**
- Files: auth.ts (85 lines), types.ts (23 lines)
- Exports: AuthMiddleware, AuthConfig, withAuth
- Dependencies: jsonwebtoken, zod
```

This allows description regeneration to use cached analysis (with staleness check) rather than re-spelunking.

---

## 5. Integration Analysis

### Compatibility with Epic-Worktree System

The design correctly uses `.worktrees/{stack-name}/` which **parallels but does not conflict with** the existing `.worktrees/{epic-id}/` from epic-worktree integration.

**Namespace analysis:**

| System | Worktree Path | Branch Pattern |
|--------|---------------|----------------|
| Beads/Epic | `.worktrees/bd-XXXX/` | `epic/bd-XXXX/*` |
| GitLab Stack | `.worktrees/{stack-name}/` | `stack/{stack-name}/*` |

**No collision** as long as:
1. Stack names don't start with `bd-`
2. Branch prefixes are distinct (`epic/` vs `stack/`)

**Recommendation:** Add explicit validation in script:

```bash
validate_stack_name() {
  local name="$1"
  if [[ "$name" == bd-* ]]; then
    echo "ERROR: Stack name cannot start with 'bd-' (reserved for beads)"
    exit 1
  fi
}
```

### Race Condition Analysis

**Race 1: Concurrent stack creation on same branch**

Two users run `/gitlab-stack` on the same feature branch simultaneously.

- **Manifestation:** Both create `stack/{name}` branch, second `git branch` fails
- **Current handling:** None specified
- **Mitigation:** Add lock file or branch existence check before creation

```bash
create_stack_branch() {
  local stack_name="$1"
  if git rev-parse --verify "stack/${stack_name}" >/dev/null 2>&1; then
    echo "ERROR: Stack branch already exists. Use a different name or run 'sync'."
    exit 1
  fi
}
```

**Race 2: Parallel rollup while leaf still being updated**

User A runs `/gitlab-stack rollup` while User B is pushing to a leaf MR.

- **Manifestation:** Rollup cherry-picks stale commit, B's changes orphaned
- **Current handling:** None specified
- **Mitigation:** Lock tracking doc during rollup, verify all leaves are merged state

```bash
rollup_commits() {
  local stack_name="$1"

  # Verify all leaves are MERGED (not just recently)
  for mr in $(get_leaf_mrs "$stack_name"); do
    state=$(glab api "projects/:fullpath/merge_requests/${mr}" | jq -r '.state')
    if [[ "$state" != "merged" ]]; then
      echo "ERROR: MR !${mr} is not merged (state: ${state})"
      exit 1
    fi
  done

  # Proceed with cherry-pick
}
```

---

## 6. Summary of Recommended Changes

### Must Fix (Before Implementation)

| Issue | Section | Fix |
|-------|---------|-----|
| Binary file handling | File Integrity | Add binary detection protocol |
| Script rollback | Script Architecture | Add transaction semantics |
| MR pipeline tiering | MR Description | Tier based on size |
| Race condition: concurrent stack creation | Integration | Add branch existence check |
| Race condition: parallel rollup | Integration | Verify all leaves merged |

### Should Fix (Soon After)

| Issue | Section | Fix |
|-------|---------|-----|
| File split validation | File Integrity | Agent validates line boundaries pre-manifest |
| Manifest commit messages | Script Architecture | Add commit_message field |
| Spelunk caching | MR Description | Cache in tracking doc for regeneration |
| Stack name validation | Integration | Block `bd-*` prefix |

### Nice to Have

| Issue | Section | Fix |
|-------|---------|-----|
| CRLF handling in splits | File Integrity | Normalize line endings |
| glab auth pre-check | Script Architecture | Validate before any operations |

---

## 7. Conclusion

The GitLab stack design is **architecturally coherent** with a well-defined boundary between agent intelligence (analysis, breakdown, MR description crafting) and script execution (git operations, file copying, MR creation).

The key insight - "Agent thinks, script acts" - is consistently applied throughout.

**Primary strength:** File Content Integrity constraint prevents hallucination in code copying.

**Primary concern:** MR Description pipeline may be over-engineered for small changes.

**Recommendation:** Address the 5 "Must Fix" items before implementation, particularly the race conditions which could cause data loss or orphaned changes.

---

*Review performed by Architecture Agent*
*Self-review mode: Identifying issues before implementation*
