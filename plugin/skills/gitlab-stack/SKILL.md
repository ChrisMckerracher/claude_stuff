---
name: gitlab-stack
description: Create and manage stacked MR workflows with agent-assisted breakdown and cherry-pick roll-up
---

# /gitlab-stack

Create and manage stacked MR workflows for GitLab with agent-assisted breakdown.

## Overview

Manages tree-structured MR stacks where leaf MRs target a root branch, enabling parallel review and clean cherry-pick roll-up to main.

**Key concepts:**
- **Stack**: A tree of related MRs sharing a common root branch
- **Root MR**: Final MR that merges to main (contains rolled-up commits)
- **Leaf MRs**: Individual MRs targeting the root branch (parallel review)
- **Worktree**: Git isolation at `.worktrees/{stack-name}/`
- **Tracking doc**: Persistent state at `docs/mr-stacks/{stack-name}.md`

## Commands

### create

Create a new MR stack from a manifest.

```bash
/gitlab-stack create <stack-name> <manifest.json>
```

**Process:**
1. Validate stack name and manifest
2. Check glab authentication
3. Create root branch and worktree
4. Create leaf branches from manifest
5. Copy files per manifest using git (NEVER agent writes)
6. Create MRs via glab
7. Generate tracking doc
8. Push branches to remote

**Human gate:** User must approve breakdown manifest before creation.

### status

Show current stack state with live GitLab data.

```bash
/gitlab-stack status <stack-name>
```

**Output:**
```
Stack: auth-system
Status: 2/3 MRs merged

| MR | State | Pipeline | Approvals | Threads | Title |
|----|-------|----------|-----------|---------|-------|
| !101 | MERGED | passed | 2/2 | 0 | Auth middleware |
| !102 | OPEN | passed | 1/2 | 3 unresolved | User routes |
| !103 | DRAFT | - | 0/2 | 0 | Integration tests |

Root MR !100: Awaiting !102, !103
```

### sync

Update tracking doc from GitLab MR states.

```bash
/gitlab-stack sync <stack-name>
```

Queries GitLab API for each MR and updates:
- State (open, merged, closed)
- Pipeline status
- Approval count
- Unresolved thread count

### rollup

Cherry-pick merged leaf commits to root branch.

```bash
/gitlab-stack rollup <stack-name>
```

**Pre-conditions:**
- All leaf MRs must be in merged state
- Fetches latest from remote before cherry-picking

**Process:**
1. Verify all leaf MRs are merged
2. Fetch latest from remote
3. Cherry-pick each merged commit to root branch
4. Push root branch
5. Update tracking doc

**Result:** Root MR contains exactly N commits (one per leaf).

### abandon

Close MRs, remove worktree, archive tracking doc.

```bash
/gitlab-stack abandon <stack-name> [--force]
```

**Process:**
1. Close all MRs via glab
2. Remove worktree
3. Delete local branches
4. Delete remote branches
5. Archive tracking doc to `docs/mr-stacks/archived/`

**Human gate:** Requires confirmation unless `--force` flag.

### comments

Fetch and display MR review comments.

```bash
/gitlab-stack comments <stack-name> <mr-id>
```

**Output format:**
```markdown
## Review Comments: !102

### Thread 1 (UNRESOLVED) - src/routes/user.ts:45
**@reviewer**: This endpoint should validate the user ID format.

### Thread 2 (RESOLVED)
**@reviewer**: Typo fix
```

### fix

Initiate agent-assisted fix workflow for MR review feedback.

```bash
/gitlab-stack fix <stack-name> <mr-id>
```

See [Fix Workflow](#fix-workflow) section below for complete documentation.

---

## Fix Workflow

The fix workflow handles MR review feedback through structured agent delegation with human approval gates.

### When to Use Fix vs Manual Editing

| Scenario | Use Fix Workflow | Use Manual Edit |
|----------|------------------|-----------------|
| Multiple unresolved comments | Yes | No |
| Architectural concerns raised | Yes | No |
| Simple typo or style issue | No | Yes |
| Single-line change requested | No | Yes |
| Reviewer asks for refactoring | Yes | No |
| Unclear what change is needed | Yes (draft clarification) | No |

**Rule of thumb:** Use `/gitlab-stack fix` when:
- 2+ unresolved threads require code changes
- Changes span multiple files
- You need to reason about the fix approach first

### Fix Workflow Phases

```
+-----------------------------------------------------------+
|                    FIX WORKFLOW                            |
|                                                           |
|  +---------+   +----------+   +---------+   +-----------+ |
|  | Fetch   |-->| Analyze  |-->|  Draft  |-->| Implement | |
|  | Comments|   | Feedback |   |   Fix   |   |    Fix    | |
|  +---------+   +----------+   +---------+   +-----------+ |
|       |                            |              |        |
|       |                      Human Gate      Human Gate   |
|       v                            v              v        |
|  (read-only)                 (approve plan) (approve commit)|
+-----------------------------------------------------------+
```

### Phase 1: Fetch Comments (Structured Extraction)

Retrieve all MR discussions from GitLab using the `comments` command:

```bash
gitlab-stack.sh comments <stack-name> <mr-id>
```

**Output format (structured for agent analysis):**

```markdown
## Review Comments: !102

### Thread 1 (UNRESOLVED) - src/routes/user.ts:45
**@reviewer** (2026-01-11 10:15):
> This endpoint should validate the user ID format before querying.

**@author** (2026-01-11 10:30):
> Good point. Should I add validation here or in middleware?

**@reviewer** (2026-01-11 10:45):
> Middleware would be better for reusability.

---

### Thread 2 (UNRESOLVED) - src/controllers/user.ts:78
**@reviewer** (2026-01-11 11:00):
> Missing error handling for user not found. Should return 404.

---

### Thread 3 (RESOLVED) - src/routes/user.ts:12
**@reviewer**: Typo in route path
**Resolution**: Fixed in commit abc1234
```

**Key elements extracted:**
- Thread status (RESOLVED/UNRESOLVED)
- File location and line number
- Conversation history (who said what)
- Resolution info if applicable

### Phase 2: Analyze Feedback

Agent categorizes comments by type and severity:

**Categories:**
- **Blocking** - Must fix before merge (unresolved, actionable)
- **Suggestions** - Nice to have, not blocking (unresolved, optional)
- **Questions** - Need response, may not need code change
- **Resolved** - Already addressed

**Example analysis output:**

```markdown
## Feedback Analysis: !102

### Blocking Issues (must fix)
1. **Missing validation** - src/routes/user.ts:45
   - Action: Add Zod schema validation in middleware
   - Reviewer: @reviewer
   - Discussion conclusion: Use middleware pattern

2. **Missing error handling** - src/controllers/user.ts:78
   - Action: Return 404 for user not found
   - Reviewer: @reviewer

### Suggestions (optional)
- None identified

### Questions (need response only)
- None pending

### Already Resolved
- Typo fix (commit abc1234)

**Recommendation**: 2 blocking issues require fixes before merge.
```

### Phase 3: Draft Fix Approach (Architect Delegation)

Spawn Architect agent to draft fix plan:

```
Task(
  subagent_type: "agent-ecosystem:architect",
  prompt: "Draft fixes for MR !102 feedback:

           Blocking issues:
           1. Add Zod validation in middleware for user ID
           2. Add 404 handling for user not found

           Context:
           - Stack: auth-system
           - Branch: stack/auth-system/2-routes
           - Worktree: .worktrees/auth-system

           Output: JSON fix manifest with file changes.
           DO NOT implement - output descriptions and line ranges only."
)
```

**Architect outputs fix manifest:**

```json
{
  "mr": "102",
  "stack": "auth-system",
  "branch": "stack/auth-system/2-routes",
  "fixes": [
    {
      "issue": "Missing validation",
      "thread_ref": "src/routes/user.ts:45",
      "files": [
        {
          "path": "src/middleware/validation.ts",
          "action": "create",
          "description": "Zod schema for user ID validation",
          "estimated_lines": 25
        },
        {
          "path": "src/routes/user.ts",
          "action": "modify",
          "line_range": "44-50",
          "description": "Add validation middleware to route"
        }
      ]
    },
    {
      "issue": "Missing error handling",
      "thread_ref": "src/controllers/user.ts:78",
      "files": [
        {
          "path": "src/controllers/user.ts",
          "action": "modify",
          "line_range": "75-85",
          "description": "Add null check and 404 response"
        }
      ]
    }
  ],
  "commit_message": "fix: address review feedback for !102"
}
```

### Human Gate: Approve Fix Plan

Present fix manifest to user in human-readable format:

```
## Proposed Fixes for !102

### Fix 1: Missing validation (Thread: src/routes/user.ts:45)
- CREATE src/middleware/validation.ts (~25 lines)
  Zod schema for user ID validation
- MODIFY src/routes/user.ts:44-50
  Add validation middleware to route

### Fix 2: Missing error handling (Thread: src/controllers/user.ts:78)
- MODIFY src/controllers/user.ts:75-85
  Add null check and 404 response

Commit message: "fix: address review feedback for !102"

Approve this fix plan? [y/n/discuss]
```

**CRITICAL:** Wait for explicit user approval. Do not proceed without "y" confirmation.

**User options:**
- `y` - Approve and proceed to implementation
- `n` - Abort fix workflow
- `discuss` - Ask clarifying questions, revise plan

### Phase 4: Implement Fix (Coding Agent Delegation)

On user approval, spawn Coding agent:

```
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: "Implement fixes per manifest for MR !102.

           Work in: .worktrees/auth-system/
           Branch: stack/auth-system/2-routes

           Fixes:
           1. Create src/middleware/validation.ts with Zod schema
           2. Modify src/routes/user.ts:44-50 to use validation
           3. Modify src/controllers/user.ts:75-85 for 404 handling

           Use TDD workflow - write tests first.
           DO NOT commit - stage changes and report for human approval."
)
```

**Coding Agent responsibilities:**
- Navigate to correct worktree
- Checkout correct branch
- Write tests first (TDD)
- Implement minimal code to pass tests
- Stage all changes
- Report completion (do NOT commit)

### Human Gate: Approve Commit

After implementation completes, present changes summary:

```
## Implementation Complete

**Files changed:**
- src/middleware/validation.ts (new, 28 lines)
- src/routes/user.ts (+3, -1)
- src/controllers/user.ts (+8, -2)
- tests/middleware/validation.test.ts (new, 45 lines)
- tests/controllers/user.test.ts (+15, -0)

**Tests:** All passing (5 tests)

Commit message: "fix: address review feedback for !102"

Ready to commit and push?
```

**CRITICAL:** Never auto-commit. Wait for explicit user approval.

### Phase 5: Push and Notify

After commit approval:

```bash
# In worktree, on correct branch
cd .worktrees/auth-system
git checkout stack/auth-system/2-routes

# Commit (after human approval)
git add -A
git commit -m "fix: address review feedback for !102"

# Push to update MR
git push origin stack/auth-system/2-routes

# Optionally reply to threads
glab mr note create 102 --message "Addressed in latest push:
- Added validation middleware (new file)
- Added 404 handling for user not found

Please re-review when ready."
```

### Complete Fix Flow Example

```
User: /gitlab-stack fix auth-system 102

Agent: Fetching comments for MR !102...
       Found 3 threads (2 unresolved, 1 resolved)

       ## Feedback Analysis
       ### Blocking Issues
       1. Missing validation - src/routes/user.ts:45
       2. Missing error handling - src/controllers/user.ts:78

       Spawning Architect to draft fix approach...

[Architect Agent]
       ## Fix Manifest
       {
         "mr": "102",
         "fixes": [...]
       }

Agent: ## Proposed Fixes for !102

       ### Fix 1: Missing validation
       - CREATE src/middleware/validation.ts (~25 lines)
       - MODIFY src/routes/user.ts:44-50

       ### Fix 2: Missing error handling
       - MODIFY src/controllers/user.ts:75-85

       Approve this fix plan? [y/n/discuss]

User: y

Agent: Spawning Coding agent to implement fixes...

[Coding Agent]
       Working in .worktrees/auth-system/
       Branch: stack/auth-system/2-routes

       Writing tests first...
       Implementing fixes...
       All tests passing.

Agent: ## Implementation Complete

       **Files changed:**
       - src/middleware/validation.ts (new, 28 lines)
       - src/routes/user.ts (+3, -1)
       - src/controllers/user.ts (+8, -2)
       - tests/middleware/validation.test.ts (new)

       **Tests:** All passing

       Ready to commit and push?

User: y

Agent: Committed: abc1234 "fix: address review feedback for !102"
       Pushed to origin/stack/auth-system/2-routes

       MR !102 updated. Run `/gitlab-stack sync auth-system` to refresh tracking doc.
```

### Fix Workflow Error Handling

| Error | Recovery |
|-------|----------|
| No unresolved comments | Report "Nothing to fix", skip workflow |
| Architect unclear on approach | Ask user for clarification before manifest |
| Implementation fails tests | Report failure, do not commit, suggest revision |
| Push rejected (conflict) | Report conflict, suggest manual resolution |
| MR already merged | Report "MR merged, fix not needed" |
| Branch not found | Verify worktree exists, suggest sync |

### Human Gates Summary

| Phase | Gate Required | What User Approves |
|-------|---------------|-------------------|
| Fetch comments | No | (read-only) |
| Analyze feedback | No | (analysis only) |
| Draft fix plan | **YES** | Fix manifest from Architect |
| Implement fix | No | (follows approved plan) |
| Commit changes | **YES** | Staged changes summary |
| Push to remote | Included in commit gate | (bundled with commit) |

### Integration with Agent Ecosystem

| Agent | Role in Fix Workflow |
|-------|---------------------|
| **Architect** | Drafts fix manifest (files, line ranges, approach) |
| **Coding** | Implements fixes with TDD in correct worktree/branch |
| **QA** | (optional) Can be invoked to verify test coverage |
| **Review** | (optional) Can run local review before push |

### Tracking Doc Updates

After fixes are pushed, sync the tracking doc:

```bash
gitlab-stack.sh sync <stack-name>
```

This updates `docs/mr-stacks/<stack-name>.md` with:
- New commit SHA
- Updated thread counts (should show fewer unresolved)
- Feedback history entry

**Feedback history section in tracking doc:**

```markdown
## Feedback History

### !102 - User Routes

#### Round 1 (2026-01-11)
- **Pulled**: 3 threads (2 unresolved, 1 resolved)
- **Blocking**: 2 issues identified
- **Fix commit**: abc1234 "fix: address review feedback"
- **Status**: Pushed, awaiting re-review
```

---

## MR Description Generation

MR descriptions are auto-generated using a tiered agent pipeline based on change size.

### describe

Generate or update MR description using tiered agent pipeline.

```bash
/gitlab-stack describe <stack-name> <mr-id>
/gitlab-stack describe <stack-name> --all
```

### Tier Selection

| MR Size | Lines Changed | Pipeline | Agent Invocations |
|---------|---------------|----------|-------------------|
| Small | < 50 lines | Fast | 1 (Code agent spelunk only) |
| Medium | 50-200 lines | Standard | 2 (Code + Architect) |
| Large | > 200 lines | Full | 3 (Code + Product + Architect parallel) |

**Rationale:**
- Small changes (typo fixes, config tweaks) don't need product/architect perspectives
- Medium changes need technical rationale but product value is often obvious
- Large changes benefit from full multi-agent analysis

### Step 1: Determine MR Size Tier

Get the commit stats to determine which tier applies:

```bash
# Get lines changed for MR's commit range
lines_changed=$(git diff --stat origin/main...HEAD | tail -1 | grep -oE '[0-9]+' | head -3 | awk '{sum += $1} END {print sum}')

# Or for a specific commit
lines_changed=$(git show --stat <commit> | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | awk '{sum += $1} END {print sum}')
```

Determine tier:
- `lines_changed < 50` -> SMALL
- `lines_changed >= 50 && lines_changed < 200` -> MEDIUM
- `lines_changed >= 200` -> LARGE

### Step 2: Code Analysis (All Tiers - Required)

**ALWAYS** spawn Code agent for spelunk analysis first. This is ephemeral - no doc is saved.

```
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: """Analyze this commit for MR description (DO NOT save spelunk doc):

  Commit range: <base>...<head>
  Diff:
  <diff-output>

  Output JSON:
  {
    "summary": "One-line summary of changes",
    "files_changed": [{"path": "...", "insertions": N, "deletions": N}],
    "key_constructs": ["functions/classes/interfaces added or changed"],
    "dependencies": ["packages added/removed"],
    "public_api": ["exports, breaking changes if any"],
    "test_coverage": "what tests were added/modified"
  }
  """
)
```

Store result as `code_analysis`.

### Step 3: Tier-Based Additional Analysis

#### SMALL Tier (< 50 lines)

Skip additional agents. Proceed directly to Step 4 with only `code_analysis`.

#### MEDIUM Tier (50-200 lines)

Spawn Architect agent for technical design rationale:

```
Task(
  subagent_type: "agent-ecosystem:architect",
  prompt: """Add technical design rationale to MR description.

  Code analysis: ${JSON.stringify(code_analysis)}

  Output JSON:
  {
    "approach": "Why this design approach was chosen",
    "alternatives": "What alternatives were considered",
    "tradeoffs": "Pros and cons of this approach"
  }
  """
)
```

Store result as `tech_design`.

#### LARGE Tier (> 200 lines)

Spawn Product AND Architect agents **in parallel** (they both only depend on code_analysis):

```
# These run CONCURRENTLY - spawn both before waiting for either
product_task = Task(
  subagent_type: "agent-ecosystem:product",
  prompt: """Add product perspective to MR description.

  Code analysis: ${JSON.stringify(code_analysis)}

  Output JSON:
  {
    "what_enables": "User-facing capabilities this enables",
    "user_impact": "Who benefits and how",
    "product_dependencies": "What this requires or enables for product"
  }
  """
)

architect_task = Task(
  subagent_type: "agent-ecosystem:architect",
  prompt: """Add technical design rationale to MR description.

  Code analysis: ${JSON.stringify(code_analysis)}

  Output JSON:
  {
    "approach": "Why this design approach was chosen",
    "alternatives": "What alternatives were considered",
    "tradeoffs": "Pros and cons of this approach"
  }
  """
)

# Wait for both to complete
product_value = await product_task
tech_design = await architect_task
```

### Step 4: Craft MR Description

Combine agent outputs into structured MR description based on tier.

#### Small MR Template

```markdown
## Summary

${code_analysis.summary}

## Changes

${code_analysis.files_changed.map(f => `- \`${f.path}\` (+${f.insertions}/-${f.deletions})`).join('\n')}

## Key Changes

${code_analysis.key_constructs.map(c => `- ${c}`).join('\n')}

---
*Generated from commit range: ${base}...${head}*
```

#### Medium MR Template

```markdown
## Summary

${code_analysis.summary}

## Design Rationale

**Approach:** ${tech_design.approach}

**Alternatives considered:** ${tech_design.alternatives}

**Tradeoffs:** ${tech_design.tradeoffs}

## Changes

${code_analysis.files_changed.map(f => `- \`${f.path}\` (+${f.insertions}/-${f.deletions})`).join('\n')}

## Key Changes

${code_analysis.key_constructs.map(c => `- ${c}`).join('\n')}

${code_analysis.dependencies.length > 0 ? `## Dependencies\n\n${code_analysis.dependencies.map(d => `- ${d}`).join('\n')}` : ''}

---
*Generated with tiered pipeline (medium)*
```

#### Large MR Template

```markdown
## Summary

${code_analysis.summary}

## Product Impact

**Enables:** ${product_value.what_enables}

**User Impact:** ${product_value.user_impact}

${product_value.product_dependencies ? `**Dependencies:** ${product_value.product_dependencies}` : ''}

## Design Rationale

**Approach:** ${tech_design.approach}

**Alternatives considered:** ${tech_design.alternatives}

**Tradeoffs:** ${tech_design.tradeoffs}

## Changes

${code_analysis.files_changed.map(f => `- \`${f.path}\` (+${f.insertions}/-${f.deletions})`).join('\n')}

## Key Changes

${code_analysis.key_constructs.map(c => `- ${c}`).join('\n')}

${code_analysis.public_api.length > 0 ? `## API Changes\n\n${code_analysis.public_api.map(a => `- ${a}`).join('\n')}` : ''}

${code_analysis.dependencies.length > 0 ? `## Dependencies\n\n${code_analysis.dependencies.map(d => `- ${d}`).join('\n')}` : ''}

## Test Coverage

${code_analysis.test_coverage}

---
*Generated with tiered pipeline (large - parallel Product + Architect)*
```

### Step 5: Update MR

Use glab CLI to update the MR description:

```bash
# Update existing MR
glab mr update <mr-id> --description "$(cat <<'EOF'
<generated-description>
EOF
)"
```

### Pipeline Diagram (Large Changes)

```
                                    +---------------------+
                                    |  Product Agent      |
                    +-------------->|  (value analysis)   |-----+
                    |               +---------------------+     |
+------------------+|                                           |    +-----------+
|   Code Agent     |+                                           +--->|   Craft   |
|   (spelunk)      ||               +---------------------+     |    |    MR     |
+------------------+|               |  Architect Agent    |     |    +-----------+
                    +-------------->|  (design rationale) |-----+
                                    +---------------------+

Sequential: Code spelunk must complete first
Parallel:   Product and Architect run concurrently (LARGE only)
Sequential: Craft waits for all agents to complete
```

### Cost/Latency Comparison

| Tier | Agent Calls | Latency (approx) | Token Cost |
|------|-------------|------------------|------------|
| Small (<50 lines) | 1 | ~5s | Low |
| Medium (50-200 lines) | 2 | ~10s | Medium |
| Large (>200 lines) | 3 (2 parallel) | ~12s | High |

**For a 5-MR stack:**

| Scenario | Previous (sequential) | New (tiered + parallel) |
|----------|----------------------|-------------------------|
| All small | 15 calls | 5 calls |
| Mixed (2S, 2M, 1L) | 15 calls | 9 calls (2 parallel) |
| All large | 15 calls | 15 calls (10 parallel) |

### Complete describe Workflow

```
# User invokes
/gitlab-stack describe auth-system 123

# Agent workflow:
1. Fetch MR info: glab mr view 123 --output json
2. Get diff stats: git diff origin/main...feature-branch --stat
3. Parse lines changed, determine tier
4. Spawn Code agent for analysis (ALWAYS)
5. Based on tier:
   - SMALL: skip to step 6
   - MEDIUM: spawn Architect agent, wait
   - LARGE: spawn Product + Architect in parallel, wait for both
6. Combine outputs into description using tier template
7. Update MR: glab mr update 123 --description "..."
8. Report: "Updated MR !123 description (medium tier - 127 lines changed)"
```

### Error Handling

- If Code agent fails: Report error, do not update MR
- If Architect/Product agent fails in parallel: Use available output, note missing perspective in description
- If glab update fails: Report error with MR URL for manual update

## Manifest JSON Schema

Agent produces this manifest for `create` command:

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

### Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `stack_name` | Yes | Unique identifier (no `/`, no `bd-` prefix) |
| `source_branch` | Yes | Branch containing changes to split |
| `target_branch` | Yes | Final merge target (usually `main`) |
| `leaves` | Yes | Array of leaf MR definitions |
| `leaves[].id` | Yes | Leaf identifier (used in branch name) |
| `leaves[].title` | Yes | MR title |
| `leaves[].files` | Yes | Files to include in this leaf |
| `leaves[].files[].path` | Yes | File or directory path |
| `leaves[].files[].operation` | No | `copy` (default) or `copy_dir` |
| `leaves[].depends_on` | No | Array of leaf IDs this depends on |
| `file_splits` | No | Files to split by line range |

## Script Reference

All mechanical operations are handled by the bash script:

```bash
${CLAUDE_PLUGIN_ROOT}/plugin/scripts/gitlab-stack.sh <command> <stack-name> [options]
```

**Key principle:** Agent thinks, script acts. File contents are NEVER touched by agent tools.

### File Integrity

The script enforces exact file copies:

- **Text files:** `git show` (streaming)
- **Binary files:** `git checkout` (byte-exact)
- **File splits:** `awk` for UTF-8 safety

**Forbidden:** Agent reading and rewriting file contents.

## Integration Points

### With /decompose

Optional linking between MR stacks and beads:

```bash
# In bead, add stack reference
bd update {bead-id} --add-label "mr-stack:auth-system"
```

Benefits:
- Task tracking (beads) + MR tracking (stack) together
- `/visualize` shows both

### With /review

Before root MR merges to main:
1. `/review` runs on root branch (full diff vs main)
2. Human validation gate

### With /security

Before root MR merges:
1. `/security` audits complete change set
2. Flags any OWASP/secrets/CVE issues

### With /gitlab-push-mr

`/gitlab-stack` uses same glab commands but with:
- Specific branch naming (`stack/...`)
- Target branch = parent in tree (not always main)
- Coordinated descriptions linking to stack

### With /merge-up

When all leaf MRs merge:
- `/merge-up` can trigger `/gitlab-stack rollup`
- Cascades completion status

## Branch Naming Convention

```
stack/{stack-name}                  # Root branch (final MR targets main)
stack/{stack-name}/1-{slug}         # Leaf branch (MR targets root)
stack/{stack-name}/2-{slug}         # Leaf branch (MR targets root)
stack/{stack-name}/1-{slug}/a       # Sub-leaf (MR targets parent leaf)
```

## Human Validation Gates

1. **Breakdown Approval:** Before creating branches/MRs, user approves proposed tree
2. **Fix Plan Approval:** Before implementing fixes, user approves Architect's manifest
3. **Pre-Rollup:** Before cherry-pick roll-up, confirm all leaves reviewed
4. **Pre-Main-Merge:** Before root MR merges to main, full review cycle

## Error Recovery

### Rollback on Create Failure

If creation fails mid-process:
1. Close any created MRs
2. Remove worktree
3. Delete local branches
4. Delete remote branches
5. Remove tracking doc

### Conflict During Rollup

If cherry-pick conflicts:
1. Report conflicting files
2. Abort cherry-pick
3. Update tracking doc with conflict status
4. User resolves manually, re-runs rollup

## Prerequisites

- `glab` CLI installed and authenticated
- `GITLAB_TOKEN` environment variable (for API access)
- Git repository with remote configured
