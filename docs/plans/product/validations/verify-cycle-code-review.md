# Code Review: Verify Cycle Skill Design

**Reviewer:** Code Review Agent
**Date:** 2026-01-15
**Design Document:** `docs/plans/architect/verify-cycle-skill.md`
**Self-Challenge:** `docs/plans/architect/verify-cycle-self-challenge.md`
**Status:** `ITERATE:INTERNAL` - Design needs revision before implementation

---

## Executive Summary

The verify cycle skill design is **well-considered after self-challenge revision** but has several feasibility issues that must be addressed before implementation. The core concept is sound, but the implementation details need refinement.

**Verdict:** The design is **feasible with revisions**. Key issues around file discovery, Node.js dependency placement, and execution model need clarification.

---

## 1. Feasibility Assessment

### 1.1 Core Concept - FEASIBLE

The fundamental approach is sound:
- Leveraging the existing coder -> review workflow is correct
- Storing cycles as markdown with YAML frontmatter is consistent with project conventions
- The rigor levels (automated, semi-automated, manual) are well-defined

### 1.2 File Discovery Contract - FEASIBLE BUT UNCLEAR

**Issue:** The design claims this is a "NEW" contract but then defines it as part of the review agent enhancement.

**Problem:** The file discovery logic has several edge cases not fully addressed:

| Edge Case | Design Handling | Concern |
|-----------|-----------------|---------|
| Epic worktree context | Uses `${ACTIVE_BRANCH}...epic/${EPIC_ID}` | `ACTIVE_BRANCH` is not a defined variable - how is it discovered? |
| No staged changes | Falls back to `git diff --name-only` | This includes uncommitted changes - is that desired? |
| Submodule changes | Skip submodule paths | What about submodule content changes? |
| Renamed files | Uses `--name-status --find-renames` | Correct approach, but need to specify which path to use (old or new) |

**Recommendation:** Define `ACTIVE_BRANCH` discovery more explicitly:

```bash
# In epic worktree context
PROJECT_ROOT=$(dirname "$(git rev-parse --git-common-dir)")
EPIC_ID=$(basename "$(git rev-parse --git-dir)")
ACTIVE_BRANCH=$(bd --cwd "${PROJECT_ROOT}" show ${EPIC_ID} --json | jq -r '.labels[]' | grep '^active-branch:' | sed 's/^active-branch://')
```

### 1.3 Node.js Dependency - FEASIBLE BUT MISPLACED

**Issue:** Design adds `minimatch` and `js-yaml` to `dashboard/package.json`.

**Problems:**
1. Dashboard may not be installed in all environments
2. Creates dependency between review function and dashboard server
3. `dashboard/` is currently only `express` - mixing utilities is unclear separation of concerns

**Evidence from spelunk:**
- `dashboard/package.json` has only `express` dependency
- Dashboard server exists but may not run during all reviews
- No pattern of using dashboard dependencies for CLI utilities

**Better approach:** Create a separate `plugin/package.json` for shared CLI utilities:

```json
{
  "name": "claude-plugin-utils",
  "version": "1.0.0",
  "dependencies": {
    "minimatch": "^9.0.0",
    "js-yaml": "^4.1.0"
  }
}
```

**Alternative:** Keep in dashboard but document that `npm install` in dashboard is required for verify cycles to work.

---

## 2. Integration Points

### 2.1 Review Agent Enhancement - MOSTLY CORRECT

The proposed flow addition is well-placed:

```
4. Discover verify cycles (NEW)
   └─► verify-discover.sh --match "$CHANGED_FILES"
5. Run applicable cycles (NEW)
   └─► verify-run.sh "$CYCLES"
```

**Issue:** The design shows calling shell scripts but proposes Node.js implementation. The wrapper scripts are unnecessary overhead.

**Simplification:** Review agent can call Node.js directly:

```bash
node plugin/lib/verify/discover.js --files="$CHANGED_FILES" --cycles-dir=".claude/verify-cycles"
```

### 2.2 Coding Agent Handoff - CORRECT

The design correctly identifies that Coding Agent calls are:

```
Task(subagent_type: "agent-ecosystem:code-review", prompt: "Code review for task <id>: <changed files>")
```

The `<changed files>` placeholder is already the contract - verify cycle discovery doesn't need to modify this.

### 2.3 Missing: Security Agent Integration

The design shows Security Agent happening AFTER verify cycles (step 6). This is correct ordering, but the design should explicitly state:

- Verify cycles are project-specific quality checks
- Security Agent handles security-specific audits
- If a verify cycle BLOCKs, do we still run Security Agent?

**Clarification needed:** Should a blocking verify cycle skip Security Agent, or should both run and combine results?

---

## 3. Performance Analysis

### 3.1 Cycle Discovery Performance

**Claim:** "50 cycles defined, review takes 10 minutes"

**Analysis:** This is overly pessimistic. With proper implementation:

| Operation | Estimated Time | Notes |
|-----------|----------------|-------|
| Read 50 cycle files | ~50ms | File system reads are fast |
| Parse 50 YAML frontmatters | ~10ms | `js-yaml` is efficient |
| Match against changed files | ~5ms | `minimatch` is optimized |
| **Total discovery overhead** | **<100ms** | Negligible |

**Recommendation:** Remove the "10 cycles per review limit" - it's premature optimization. If performance becomes an issue, add it then.

### 3.2 Execution Performance

The real performance concern is cycle execution, not discovery:

| Cycle Type | Performance Risk | Mitigation |
|------------|------------------|------------|
| Automated scripts | Could be slow (e.g., lighthouse) | Already handled by `rigor` field |
| Semi-automated | Same as automated | Same |
| Manual | No execution | N/A |

**Recommendation:** Add a `timeout` field to cycle schema:

```yaml
---
name: homepage-performance
timeout: 120  # seconds, default 30
---
```

---

## 4. Edge Cases Analysis

### 4.1 Well-Handled Edge Cases

The design handles these well:

| Edge Case | Handling | Status |
|-----------|----------|--------|
| No changed files | Skip discovery, return APPROVED | Correct |
| Multiple matching cycles | Execute by creation date | Correct |
| Malformed cycle | Log warning, skip | Correct |
| Script not found | BLOCK with helpful message | Correct |
| Git renames | Use `--name-status --find-renames` | Correct |
| Large file lists | Pass via temp file | Correct |
| Symlinks | Resolve to real path | Correct |
| Cycle file modified during review | Cache at discovery | Correct |

### 4.2 Missing Edge Cases

| Edge Case | Current Handling | Recommendation |
|-----------|------------------|----------------|
| **Cycle references non-existent rigor level** | Undefined | Validate `rigor` enum in discovery, log warning |
| **Cycle with empty `files` array** | Would match nothing | Validate `files` has at least one pattern |
| **Cycle pattern matches everything (`**`)** | Would run on every change | Document as anti-pattern, maybe add warning |
| **Conflicting cycles (same name)** | Not addressed | Cycle names should be unique, add validation |
| **Deleted cycle file** | Not addressed | Git rm of cycle file should be detected |
| **Binary files with no extension** | `grep -I` check may fail | Use `file` command or git's binary detection |
| **Windows line endings in cycle files** | May break YAML parsing | Normalize line endings in discovery |

### 4.3 Case Sensitivity - Platform Dependent

**Design says:** "Match case-insensitively on macOS, case-sensitively on Linux"

**Problem:** This creates different behavior across platforms. A developer on macOS may have cycles pass that fail on Linux CI.

**Recommendation:** Always match case-sensitively (Linux behavior) for consistency. Document this expectation.

---

## 5. Dependencies

### 5.1 Node.js Availability - CONFIRMED

From environment check:
```bash
which node  # /opt/homebrew/bin/node
node --version  # v24.8.0
```

Node.js is available in the environment. The Node.js approach is correct.

### 5.2 `minimatch` and `js-yaml` - WRONG LOCATION

**Current proposal:** Add to `dashboard/package.json`

**Issues:**
1. Dashboard is a separate concern (Express server)
2. Creates implicit dependency between review and dashboard
3. Unclear why utilities live under dashboard

**Recommendation:** One of:

**Option A - Preferred:** Create `plugin/lib/package.json`
```
plugin/lib/
  package.json     # New: shared utilities
  verify/
    discover.js
    execute.js
```

**Option B:** Add to root `package.json` if one exists (currently doesn't)

**Option C:** Keep in dashboard but add comment explaining why

### 5.3 Missing: Dependency Installation Documentation

The design doesn't mention when/where to run `npm install`. Add to Phase 1:

```markdown
### Phase 1: Foundation
1. npm install minimatch js-yaml --save  # In plugin/lib/ or dashboard/
2. Create verify-discover.js
...
```

---

## 6. Review Agent Execution Capability

### 6.1 Can Review Agent Execute These Cycles? - YES, WITH CAVEATS

**As Review Agent, here's what I can and cannot do:**

| Capability | Feasible | Notes |
|------------|----------|-------|
| Discover changed files | Yes | Git commands work |
| Parse YAML frontmatter | Yes | With `js-yaml` dependency |
| Match glob patterns | Yes | With `minimatch` dependency |
| Execute automated scripts | Yes | Via Bash tool |
| Read script output | Yes | Via Bash tool |
| Parse pass/fail criteria | **Maybe** | Need clear contract |

### 6.2 The Pass/Fail Contract is Undefined

**Design says:** "Pass criteria: Lighthouse performance score > 80"

**Problem:** How do I as Review Agent determine this from script output?

**Current proposal:** The cycle file has free-text description:
```markdown
**Pass criteria:** Lighthouse performance score > 80
```

**Issue:** This is unstructured text. I cannot programmatically determine pass/fail.

**Recommendation:** Add structured pass/fail detection:

**Option A - Exit code only:**
```yaml
---
rigor: automated
# Script must exit 0 for pass, non-zero for fail
---
```

**Option B - Output parsing:**
```yaml
---
rigor: automated
pass_if: "output.contains('score') && parse(output).score > 80"
---
```

**Option C - Separate assertion script:**
```yaml
---
rigor: automated
check: ./scripts/assert-lighthouse-score.sh  # Separate validation
---
```

**Recommendation:** Start with Option A (exit code), document that scripts should exit 0 on pass.

### 6.3 Semi-Automated Execution - UNCLEAR

**Design says:**
- Direct `/review`: "Show output, prompt for continuation"
- Spawned: "Show output, auto-continue if pass"

**Problem:** When spawned, I cannot "prompt for continuation." I run to completion and return verdict.

**Reality:** As a spawned agent, I have one output. I cannot have a conversation.

**Recommendation:** Clarify the model:

**Direct `/review` mode (interactive):**
```
I show output and wait for your response
You decide whether to continue
```

**Spawned mode (non-interactive):**
```
I show output in my review
I do NOT wait for response
I include the output in my verdict
```

### 6.4 Manual Cycle Execution - SKIP CORRECTLY IDENTIFIED

**Design says:** "Manual cycles: SKIP when spawned"

**As Review Agent:** This is correct. I cannot pause execution to wait for human input when spawned.

**Communication:** The warning message is well-designed:
```
⚠️  Skipped manual cycle: admin-panel-check
   Run /review directly to complete manual verification
```

---

## 7. Specific Code Concerns

### 7.1 `discover.js` Implementation Issues

**Code from design:**
```javascript
const content = fs.readFileSync(path.join(cyclesDir, cycleFile), 'utf8');
const match = content.match(/^---\n(.*?)\n---/s);
```

**Issue 1:** This assumes `\n` line endings. Will fail on Windows (`\r\n`).

**Fix:** Use platform-agnostic regex:
```javascript
const match = content.match(/^---\r?\n(.*?)\r?\n---/s);
```

**Issue 2:** No error handling for `fs.readFileSync` failure.

**Fix:**
```javascript
try {
  const content = fs.readFileSync(path.join(cyclesDir, cycleFile), 'utf8');
  // ...
} catch (err) {
  console.warn(`Failed to read cycle file ${cycleFile}: ${err.message}`);
  continue;
}
```

### 7.2 `fileMatchesCycle` Correct

```javascript
function fileMatchesCycle(file, cycle) {
  const included = cycle.files.some(pattern =>
    minimatch(file, pattern, { dot: true })
  );
  if (!included) return false;
  if (cycle.exclude) {
    const excluded = cycle.exclude.some(pattern =>
      minimatch(file, pattern, { dot: true })
    );
    if (excluded) return false;
  }
  return true;
}
```

This is correct. The logic properly handles include/exclude.

### 7.3 Missing: Cycle Name Validation

Design doesn't validate cycle names. Should enforce:
- Kebab-case (`homepage-performance`, not `homepage_performance`)
- No spaces
- Unique within project

**Recommendation:** Add validation in `capture` command.

---

## 8. Architectural Concerns

### 8.1 DRY Violation Risk

The design creates three places where cycle concepts exist:

| Location | Content |
|----------|---------|
| `plugin/commands/verify.md` | Command syntax |
| `plugin/skills/verify/SKILL.md` | Skill documentation |
| `plugin/agents/code-review.md` | Execution logic |

**Risk:** If cycle schema changes, all three must update.

**Mitigation:** Document the schema in ONE place, reference from others.

**Recommendation:** Create `plugin/verify/SCHEMA.md` as single source of truth.

### 8.2 Coupling Concern

**Review Agent** becomes coupled to:
- Verify cycle storage format
- Verify cycle execution logic
- Node.js dependencies

**Assessment:** This is acceptable coupling. Review Agent is the right place for this concern.

### 8.3 Abstraction Level

**Question:** Should verify cycles be in the Review Agent at all?

**Alternative:** Create a separate `verify` agent that Review Agent spawns.

**Counter-argument:** Over-engineering. Verify cycles are code review checks, not a separate concern.

**Verdict:** Current design has appropriate abstraction.

---

## 9. Integration Test Scenarios

The design should include test scenarios. Recommend adding:

### Scenario 1: Simple Automated Cycle
```bash
# Setup
git init test-repo
cd test-repo
mkdir -p .claude/verify-cycles
cat > .claude/verify-cycles/typescript.md << 'EOF'
---
name: typescript-check
files: ["*.ts"]
rigor: automated
---
**How:** npx tsc --noEmit
**Pass criteria:** Exit code 0
EOF

# Create file that fails tsc
echo "const x: string = 123;" > test.ts

# Run review
/review

# Expected: BLOCK:typescript-check:Type errors found
```

### Scenario 2: Manual Cycle in Spawned Context
```bash
# Create manual cycle
cat > .claude/verify-cycles/manual-check.md << 'EOF'
---
name: manual-review
files: ["*.ts"]
rigor: manual
---
**What:** Manual visual inspection
EOF

# Have Coding Agent spawn review
# Expected: Warning about skipped manual cycle
```

---

## 10. Final Verdict

### `ITERATE:INTERNAL` - Design Needs Revision

**Blocking Issues (must fix):**

1. **Dependency placement:** Don't put utilities in `dashboard/package.json`
   - Fix: Create `plugin/lib/package.json` or document clearly

2. **Pass/fail contract undefined:** Free-text criteria isn't executable
   - Fix: Use exit code convention, document clearly

3. **`ACTIVE_BRANCH` discovery undefined:** Variable referenced but not defined
   - Fix: Add explicit discovery command

4. **Platform inconsistency:** Case sensitivity varies by platform
   - Fix: Document always case-sensitive (Linux behavior)

**Non-blocking Issues (should address):**

5. Missing edge case handling (empty files array, unknown rigor)
6. Windows line ending compatibility
7. Cycle name validation
8. Single source of truth for schema

### What Works Well

- Node.js with minimatch/js-yaml approach is correct
- Manual cycle skip behavior is well-designed
- Edge case coverage is comprehensive (after self-challenge)
- Rigor levels are appropriate
- Storage format is consistent with project conventions

### Next Steps

1. Address blocking issues above
2. Create `plugin/lib/package.json` for shared dependencies
3. Add test scenarios to design doc
4. Define pass/fail contract explicitly
5. Resubmit for review

---

**Files Referenced:**
- `/Users/chrismck/tasks/claude_stuff/docs/plans/architect/verify-cycle-skill.md`
- `/Users/chrismck/tasks/claude_stuff/docs/plans/architect/verify-cycle-self-challenge.md`
- `/Users/chrismck/tasks/claude_stuff/plugin/agents/code-review.md`
- `/Users/chrismck/tasks/claude_stuff/plugin/agents/coding.md`
- `/Users/chrismck/tasks/claude_stuff/plugin/commands/review.md`
- `/Users/chrismck/tasks/claude_stuff/plugin/dashboard/package.json`
- `/Users/chrismck/tasks/claude_stuff/plugin/dashboard/server.js`
