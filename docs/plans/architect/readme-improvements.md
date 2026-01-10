# README Improvements Design

**Product brief:** No product brief (documentation update task)
**Date:** 2026-01-10
**Status:** DRAFT

## Goal

Fix 5 documentation gaps identified by Product Agent review: human validation gates, GitLab command syntax, agent layer constraints, dashboard startup, and Node.js version requirement.

## Background

The Product Agent examined the codebase via spelunking and identified README gaps where documented behavior doesn't match actual implementation or where important features lack documentation.

**Reference:** `docs/spelunk/flows/codebase-overview.md`

## Approach

Make targeted edits to `/Users/chrismck/tasks/claude_stuff/README.md` to address each gap. Organize changes to maintain README flow and readability.

## Fixes

### Fix 1: Human Validation Gates (HIGH PRIORITY)

**Problem:** README documents the workflow but doesn't mention the 3 mandatory approval points that prevent agents from auto-proceeding.

**Location:** Add new section after "Typical Workflow" section (after line 146)

**Content to add:**
```markdown
### Human Validation Gates

The workflow includes 3 mandatory approval points where agents pause for human confirmation:

| Gate | When | Agent Says |
|------|------|------------|
| **Design Review** | After architect writes design doc | "Design draft complete. Review and approve/revise/discuss." |
| **Pre-Implementation** | After decompose creates task tree | "Task tree created. Want me to spawn N Coding Agents?" |
| **Pre-Commit** | After implementation complete | "Ready to commit?" |

**Rules:**
- Agents never skip mandatory gates
- Silence is not approval - agents wait for explicit response
- Human can always request changes or discussion at any gate
```

### Fix 2: GitLab Command Syntax (HIGH PRIORITY)

**Problem:** README line 333-338 shows space-separated syntax (`/gitlab pull-comments`) but actual commands use hyphens (`/gitlab-pull-comments`).

**Location:** Lines 333-338 in GitLab Integration section

**Current (incorrect):**
```bash
/gitlab pull-comments        # Fetch MR comments for current branch
/gitlab pull-comments 123    # Fetch comments for MR #123
/gitlab push-mr              # Create MR for current branch
/gitlab push-mr update       # Update existing MR description
```

**Correct:**
```bash
/gitlab-pull-comments        # Fetch MR comments for current branch
/gitlab-pull-comments 123    # Fetch comments for MR #123
/gitlab-push-mr              # Create MR for current branch
/gitlab-push-mr --update     # Update existing MR description
```

### Fix 3: Agent Layer Constraints (HIGH PRIORITY)

**Problem:** README doesn't explain that Product and Architect agents cannot read source code - they must delegate to spelunk.

**Location:** Add new subsection under "Architecture" section (after Agent Responsibilities table, around line 187)

**Content to add:**
```markdown
### Agent Layer Constraints

Agents operate at different abstraction layers with different access rights:

**Documentation-layer agents:** Architecture, Product, QA
- Read from `docs/`, `README.md`, config files
- Cannot read source code directly (`src/**`, `lib/**`, `*.ts`, `*.py`)
- Delegate to Coding Agent via spelunk when needing codebase info

**Code-layer agents:** Coding, Security
- Full access to source code
- Write findings to `docs/spelunk/` for documentation-layer agents

This separation ensures:
- Correct abstraction level for each agent's role
- Accumulated knowledge via spelunk docs
- Efficient context usage (no raw code in design discussions)
```

### Fix 4: Dashboard Startup (MEDIUM PRIORITY)

**Problem:** README mentions dashboard at localhost:3847 but doesn't explain how to start it.

**Location:** Add to existing Dashboard bullet under Overview (around line 13), AND add a Dashboard section after GitLab Integration (around line 358)

**Content to add (in overview):**
Keep existing line, just a clarification that startup is automatic via `/dashboard` command.

**Content to add (new section):**
```markdown
## Dashboard

The web dashboard provides task visualization and git diff viewing at `http://localhost:3847`.

### Starting the Dashboard

```bash
/dashboard                   # Start dashboard (opens in browser)
```

The dashboard displays:
- **Task Tree** - All beads tasks with status (ready/blocked/complete)
- **Git Diff** - Changes against main branch
- **Repository Status** - Branch info, uncommitted changes

The dashboard is built with Express/TypeScript and runs as a background process.
```

### Fix 5: Node.js Version (MEDIUM PRIORITY)

**Problem:** TypeScript/Express codebase but no Node.js version requirement documented.

**Location:** Add to Dependencies section (around line 359-364)

**Content to add:**
```markdown
- Node.js 18+ (required for dashboard and TypeScript tooling)
```

## Task Breakdown

| Task | Blocks | Description | Est. Lines |
|------|--------|-------------|------------|
| 1. Fix GitLab syntax | none | Correct `/gitlab pull-comments` to `/gitlab-pull-comments` | 4 |
| 2. Add Human Validation Gates section | none | New section after Typical Workflow | 18 |
| 3. Add Agent Layer Constraints section | none | New subsection under Architecture | 16 |
| 4. Add Dashboard section | none | New section with startup instructions | 15 |
| 5. Add Node.js dependency | none | One line addition to Dependencies | 1 |

**Total:** ~54 lines modified/added

## Success Criteria

- [ ] GitLab commands match actual implementation (hyphenated)
- [ ] Human validation gates are documented with clear table
- [ ] Agent layer constraints explain doc-layer vs code-layer
- [ ] Dashboard startup instructions are present
- [ ] Node.js version requirement is listed in dependencies

---

**Next:** Awaiting human review before implementation
