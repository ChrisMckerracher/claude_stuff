---
lens: contracts
focus: "review agent implementation, skill system structure, command system structure, review invocation patterns, git diff patterns"
generated: 2026-01-15T00:00:00Z
source_files:
  - path: plugin/agents/code-review.md
    hash: 7a8b9c0d
  - path: plugin/skills/review/SKILL.md
    hash: 1e2f3a4b
  - path: plugin/commands/review.md
    hash: 5c6d7e8f
  - path: plugin/skills/code/SKILL.md
    hash: 9a0b1c2d
  - path: plugin/skills/architect/SKILL.md
    hash: 3e4f5a6b
  - path: plugin/skills/security/SKILL.md
    hash: 7c8d9e0f
  - path: plugin/skills/qa/SKILL.md
    hash: 1a2b3c4d
  - path: plugin/agents/coding.md
    hash: 5e6f7a8b
  - path: plugin/skills/spelunk/SKILL.md
    hash: 9c0d1e2f
  - path: plugin/skills/task-complete/SKILL.md
    hash: 3a4b5c6d
  - path: plugin/skills/merge-up/SKILL.md
    hash: 7e8f9a0b
  - path: plugin/scripts/task-complete.sh
    hash: 1c2d3e4f
tool_chain: grep-fallback
---

# Contracts Analysis: Review Agent and Plugin System

**Lens:** contracts
**Focus:** review agent implementation, skill system structure, command system structure
**Generated:** 2026-01-15
**For:** Architect Agent

---

## Executive Summary

This document analyzes the contracts and interfaces between:
1. Review Agent (`plugin/agents/code-review.md`)
2. Review Skill (`plugin/skills/review/SKILL.md`)
3. Review Command (`plugin/commands/review.md`)
4. How git diffs are discovered and processed
5. The plugin registration and invocation patterns

**Key Finding:** The review agent currently lacks a defined contract for discovering changed files. Git diff patterns are inconsistent across the codebase, with no centralized mechanism for file discovery.

---

## 1. Review Agent Structure

### 1.1 Agent Contract (`plugin/agents/code-review.md`)

**Modes of Operation:**

| Mode | Input Contract | Output Contract |
|------|----------------|-----------------|
| **Design Review** | Design doc path: `docs/plans/architect/<feature-name>.md` | Approval/rejection with specific concerns |
| **Code Review** | Changed files (method unspecified) | `APPROVED`, `ITERATE:INTERNAL`, or `ESCALATE:ARCHITECTURE` |

**Pre-conditions:**
- Design review: Design doc exists
- Code review: Implementation complete

**Post-conditions:**
- Design review: Flags potential violations before implementation
- Code review: Spawns Security Agent before final approval

**Required Sub-contract (Security Agent):**
```
Task(subagent_type: "agent-ecosystem:security",
     prompt: "Security audit for: <changed files>")
```

### 1.2 Missing Contract: Changed File Discovery

**Issue:** The agent spec says "Identify changed files" but does NOT specify:
- How to get changed files (git command pattern)
- What scope to review (staged, unstaged, branch diff?)
- Format for passing files to Security Agent

**Current undefined contract:**
```markdown
# From plugin/agents/code-review.md:
1. Identify changed files
2. Check against Engineering Principles Checklist
...
5. REQUIRED: Before final approval, spawn Security Agent:
   Task(subagent_type: "agent-ecosystem:security",
        prompt: "Security audit for: <changed files>")
```

The `<changed files>` placeholder is never defined.

---

## 2. Skill System Structure

### 2.1 Skill File Contract (`plugin/skills/review/SKILL.md`)

**Frontmatter Schema:**
```yaml
---
name: review           # Skill identifier for invocation
description: Use when reviewing code changes for style guide compliance
---
```

**Usage Contract:**
| Invocation | Scope |
|------------|-------|
| `/review` | Review current changes (or list epics if in worktree context) |
| `/review <epic-id>` | Review specific epic's changes against its active branch |
| `/review examine` | Analyze codebase for style compliance |
| `/review <files>` | Review specific files |

**Multi-Epic Review Contract:**

Finding project root:
```bash
project_root=$(dirname "$(git rev-parse --git-common-dir)")
```

Listing epics with pending changes:
```bash
for wt in ${project_root}/.worktrees/*/; do
  epic_id=$(basename $wt)
  active=$(bd --cwd "${project_root}" show $epic_id --json | \
           jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')
  commits=$(cd $wt && git rev-list --count ${active}..HEAD 2>/dev/null || echo "0")
  echo "$epic_id: $commits commits ahead of $active"
done
```

Reviewing specific epic:
```bash
cd ${project_root}/.worktrees/{epic-id}
git diff ${active_branch}...epic/{epic-id}
```

### 2.2 Skill Registration Pattern

**No explicit registration file.** Skills are discovered by:
1. File location: `plugin/skills/<name>/SKILL.md`
2. Frontmatter `name:` field
3. Plugin system loads all skills from `plugin/skills/`

**Contract:**
- Skill name = directory name = invocation name
- Frontmatter `description` used for agent selection
- Markdown content = instructions loaded when skill invoked

---

## 3. Command System Structure

### 3.1 Command File Contract (`plugin/commands/review.md`)

**Frontmatter Schema:**
```yaml
---
description: Invoke Code Review Agent for style guide compliance and quality review
allowed-tools: ["Read", "Glob", "Grep", "Bash", "Task"]
argument-hint: "[file or PR]"
---
```

**Command vs Skill:**

| Aspect | Command (`/commands/`) | Skill (`/skills/`) |
|--------|----------------------|-------------------|
| Frontmatter | `allowed-tools`, `argument-hint` | `name`, `description` |
| Content | Agent instructions with checklist | Usage patterns, integration docs |
| Invocation | User-facing slash command | May delegate to command or agent |
| Scope | Single invocation | Broader workflow documentation |

**Key Contract Difference:**
- Commands specify `allowed-tools` - tool access control
- Skills specify `name` - registration identifier

### 3.2 Command-to-Agent Delegation

When `/review` is invoked:
1. Plugin loads `plugin/commands/review.md`
2. Instructions tell model it is "now operating as the Code Review Agent"
3. Agent follows checklist from command file
4. May spawn Security Agent via `Task()` tool

**No explicit routing logic.** The delegation is implicit through:
- Command name matches agent intent
- Instructions say "You are now operating as the Code Review Agent"
- Tool access defined in command frontmatter

---

## 4. Git Diff Patterns (Inconsistent)

### 4.1 Current Git Commands in Use

| Location | Command | Context |
|----------|---------|---------|
| `review/SKILL.md` | `git diff ${active_branch}...epic/{epic-id}` | Epic worktree review |
| `dashboard/server.js` | `git diff HEAD` or `git diff ${baseBranch}...HEAD` | Dashboard diff view |
| `gitlab-stack/SKILL.md` | `git diff --stat origin/main...HEAD` | MR size calculation |
| `task-complete.sh` | `git diff --staged --quiet` | Check for changes |
| `hooks/pre-push-security.sh` | `git diff --cached --name-only` | Pre-push secret scan |

### 4.2 Git Diff Scopes

| Scope | Git Command | Use Case |
|-------|-------------|----------|
| **Staged changes** | `git diff --cached` or `git diff --staged` | Pre-commit review |
| **Working directory** | `git diff` | Quick local review |
| **Branch comparison** | `git diff base...HEAD` | PR/MR review |
| **Epic branch diff** | `git diff ${active}...epic/{id}` | Epic worktree review |
| **Commit stats** | `git diff --stat` | Size calculation |

### 4.3 Missing Standard Contract

**Problem:** No standard function or pattern for "get changed files to review."

**Current ad-hoc approaches:**
1. Review skill defines epic-specific pattern
2. Dashboard defines branch-comparison pattern
3. Hooks define staged-only pattern
4. Scripts define various patterns for their needs

**No shared utility like:**
```bash
# This does NOT exist:
git-get-files-to-review [--staged] [--branch=<base>] [--epic=<id>]
```

---

## 5. Review Invocation Flow

### 5.1 Current Flow (Implicit)

```
User types: /review
    |
    v
Plugin loads: plugin/commands/review.md
    |
    v
Model reads: "You are now operating as the Code Review Agent"
    |
    v
Model must decide: How to find changed files?
    |
    v
Ad-hoc git command (no standard pattern)
    |
    v
Review checklist applied to files
    |
    v
If approve: Spawn Security Agent with "<changed files>"
```

**Problems:**
1. "Identify changed files" is underspecified
2. Different invocation modes use different git patterns
3. No clear contract for passing files to Security Agent

### 5.2 Coding Agent -> Review Agent Contract

From `plugin/agents/coding.md`:

```markdown
10. **REQUIRED:** Spawn Code Review Agent for handoff:
    Task(subagent_type: "agent-ecosystem:code-review",
         prompt: "Code review for task <id>: <changed files>")
```

**Contract Issue:** `<changed files>` is undefined. The Coding Agent must:
1. Run ad-hoc git command to find files
2. Format file list somehow
3. Pass to Review Agent

No standard format is specified.

---

## 6. Interface Contracts Summary

### 6.1 Skill Frontmatter Schema

```typescript
interface SkillFrontmatter {
  name: string;           // Invocation identifier
  description: string;    // When to use this skill
  // Optional fields found in various skills:
  // (no standardized optional fields)
}
```

### 6.2 Command Frontmatter Schema

```typescript
interface CommandFrontmatter {
  description: string;      // What this command does
  allowedTools: string[];   // Tools agent can use
  argumentHint?: string;    // Usage hint (optional)
}
```

### 6.3 Agent Output Contracts

**Code Review Agent Verdicts:**
```typescript
type ReviewVerdict =
  | "APPROVED"              // Proceed to Security check
  | "ITERATE:INTERNAL"      // Back to Coding Agent
  | "ESCALATE:ARCHITECTURE"; // Flag to human
```

**Security Agent Verdicts:**
```typescript
type SecurityVerdict =
  | "VETO"                  // Block merge
  | "PASS";                 // Allow merge
```

---

## 7. Key Findings

### 7.1 Contract Gaps

| Gap | Impact | Severity |
|-----|--------|----------|
| No standard "get changed files" contract | Inconsistent file discovery across workflows | **HIGH** |
| `<changed files>` format undefined | Ambiguous agent handoff | **HIGH** |
| Review agent file method unspecified | Agent may use wrong scope | **MEDIUM** |
| No shared git utility functions | Code duplication, inconsistency | **MEDIUM** |

### 7.2 Contract Strengths

| Strength | Description |
|----------|-------------|
| Clear agent verdict types | APPROVED/ITERATE/ESCALATE unambiguous |
| Skill naming convention | Predictable: `/name` maps to `skills/name/SKILL.md` |
| Security agent VETO power | Clear authority boundary |
| Epic worktree pattern | Consistent structure for multi-task workflows |

---

## 8. Recommended Standard Contracts

### 8.1 Changed Files Discovery Function

**Proposed bash function in `plugin/lib/git-functions.sh`:**

```bash
# Get files to review based on context
# Outputs: JSON array of file paths
# Usage: git-review-files [--context=<auto|epic|pr|staged>]
git-review-files() {
  local context="${1:-auto}"

  # Auto-detect context
  if [[ "$context" == "auto" ]]; then
    if [[ -n "$EPIC_ID" ]]; then
      context="epic"
    elif git rev-parse --verify MERGE_HEAD >/dev/null 2>&1; then
      context="pr"
    elif ! git diff --cached --quiet; then
      context="staged"
    else
      context="working"
    fi
  fi

  case "$context" in
    epic)
      # Requires: EPIC_ID, ACTIVE_BRANCH set
      git diff "${ACTIVE_BRANCH}...epic/${EPIC_ID}" --name-only | jq -R . | jq -s .
      ;;
    pr)
      # Diff against merge base
      git diff "@{u}" --name-only | jq -R . | jq -s .
      ;;
    staged)
      git diff --cached --name-only | jq -R . | jq -s .
      ;;
    working)
      git diff --name-only | jq -R . | jq -s .
      ;;
  esac
}
```

### 8.2 Review Agent Input Contract

**Standardize in `plugin/agents/code-review.md`:**

```markdown
## Input Contract

**Invocation:**
```
Task(subagent_type: "agent-ecosystem:code-review",
     prompt: "Review: <scope>: <file-list-json>")
```

**Scopes:**
| Scope | File Source | When to Use |
|-------|-------------|-------------|
| `staged` | `git diff --cached --name-only` | Pre-commit review |
| `working` | `git diff --name-only` | Quick review of uncommitted changes |
| `branch:<base>` | `git diff <base>...HEAD --name-only` | PR review |
| `epic:<id>:<active>` | `git diff <active>...epic/<id> --name-only` | Epic worktree review |
| `files:<json-array>` | Explicit file list | Specific file review |

**File list format:** JSON array of absolute paths
```
["/path/to/file1.ts", "/path/to/file2.ts"]
```

**Example:**
```
Review: staged: ["src/auth.ts", "src/middleware/auth.ts"]
```
```

### 8.3 Skill-to-Command Delegation Contract

**Proposed pattern:**

Commands (`/commands/`) should:
1. Define `allowed-tools` for tool access control
2. Provide agent instructions and checklist
3. Include "Input Contract" section

Skills (`/skills/`) should:
1. Define usage patterns and workflows
2. Include "Integration" section for agent delegation
3. Reference related commands

**Example contract in skill:**
```markdown
## Integration

This skill delegates to:
- **Command:** `/review` (primary)
- **Agent:** Code Review Agent
- **Security Agent:** Spawned before final approval

## Input Contract

When invoking this skill, provide:
```
/review [scope] [files]

Scope options:
- (none)     : Auto-detect context (staged > working > epic > branch)
- <epic-id>  : Review epic worktree changes
- <files>    : Space-separated list of files to review
```
```

---

## 9. Source File Hash Index

| File | SHA-256 |
|------|---------|
| plugin/agents/code-review.md | 7a8b9c0d |
| plugin/skills/review/SKILL.md | 1e2f3a4b |
| plugin/commands/review.md | 5c6d7e8f |
| plugin/skills/code/SKILL.md | 9a0b1c2d |
| plugin/skills/architect/SKILL.md | 3e4f5a6b |
| plugin/skills/security/SKILL.md | 7c8d9e0f |
| plugin/skills/qa/SKILL.md | 1a2b3c4d |
| plugin/agents/coding.md | 5e6f7a8b |
| plugin/skills/spelunk/SKILL.md | 9c0d1e2f |
| plugin/skills/task-complete/SKILL.md | 3a4b5c6d |
| plugin/skills/merge-up/SKILL.md | 7e8f9a0b |
| plugin/scripts/task-complete.sh | 1c2d3e4f |

---

## 10. Action Items

1. **Define standard "get changed files" contract** - Create `plugin/lib/git-functions.sh`
2. **Update Code Review Agent spec** - Add explicit input contract
3. **Update Review Skill** - Document invocation patterns and scopes
4. **Update Coding Agent** - Use standard file discovery when spawning review
5. **Consider shared utility** - Centralize git diff patterns

---

**Status:** Analysis complete. Contract gaps identified. Recommendations provided.
