# Design Challenge: Verify Cycle Skill

**Date:** 2026-01-15
**Challenger:** Architecture Agent (self-review)
**Design Document:** `docs/plans/architect/verify-cycle-skill.md`

---

## Challenge Questions

### 1. Is the integration truly as simple as claimed?

**Claim:** "Only changes to Review Agent, Coder unchanged"

**Challenge:** This is **misleading**. The spelunk revealed:

| Hidden Complexity | Reality |
|-------------------|----------|
| **No standard file discovery** | Need to create `verify-discover.sh` which establishes a NEW contract that didn't exist before |
| **Review agent doesn't actually know how to get files** | Current agent says "identify changed files" but doesn't specify HOW. We're adding NEW behavior, not enhancing existing |
| **Bash utility dependencies** | `yj` (YAML-to-JSON) required for parsing frontmatter. Is this installed everywhere? |
| **Glob matching not native** | Bash `extglob` must be enabled. Need `shopt -s extglob` in every script or assume it's set |

**Revised Claim:** The integration requires:
1. NEW file discovery contract (not documented before)
2. NEW bash utilities for cycle discovery and execution
3. ENHANCED review agent (new behaviors, not just additions)
4. POTENTIAL new dependency (`yj` or similar YAML parser)

**Verdict:** Integration is **moderately complex**, not simple. The claim of "single agent change" hides the utility layer that must be built first.

---

### 2. What edge cases in cycle discovery did we miss?

**Edge cases covered:**
- No changed files ✓
- Multiple matching cycles ✓
- Malformed cycle files ✓
- Script not found ✓
- Manual cycles in CI ✓

**Edge cases MISSED:**

| Missed Case | Impact | Mitigation |
|-------------|--------|------------|
| **File rename in git** | `git diff --name-only` shows deleted + added. Cycle may trigger twice on same logical change | Track file renames via `git diff --name-status` |
| **Submodule changes** | Changed file path doesn't match project patterns | Skip submodule paths, add to docs |
| **Cycle file edited during review** | Race condition if cycle changes between discovery and execution | Load cycle content once at discovery |
| **Symlinked files** | Glob may match symlink but file lives elsewhere | Resolve symlinks before matching |
| **Binary files** | Some cycles shouldn't run on binary changes (images, fonts) | Add `exclude` field to cycle schema |
| **Large diffs** | Changed file list exceeds bash argument limit | Use file-based passing, not command line |
| **Whitespace pattern edge cases** | Glob `src/*.ts` doesn't match nested files | Document glob behavior clearly |
| **Case-sensitive filesystems** | `src/File.ts` vs `src/file.ts` on Linux vs macOS | Match case-insensitively or document expectation |

**Additional edge case:** The `files` array supports globs but what about:
- `**/*.ts` in a monorepo - should it match `packages/a/file.ts` AND `packages/b/file.ts`?
- How to exclude files? `!**/*.test.ts` isn't standard bash glob.

**Verdict:** Discovery algorithm is more complex than designed. Need:
1. Git rename detection
2. Binary file filtering
3. Explicit exclude patterns
4. Large diff handling

---

### 3. Are there any hidden complexities in glob matching against git diffs?

**Claim:** "Use bash `extglob` with `find` for pattern matching"

**Challenge:** This is **technically incorrect**.

| Issue | Reality |
|-------|----------|
| **Glob vs Regex confusion** | The design converts globs to regex (`**/*.ts` → `^.*\.ts$`) but `**` (recursive) isn't standard bash glob |
| **`{a,b}` brace expansion** | `*.{ts,tsx}` works in bash for filename expansion but NOT in pattern matching |
| **`**` recursive glob** | Bash doesn't natively support `**` (requires `globstar` option, added in bash 4.0) |
| **Frontmatter array format** | `files: ["src/**/*.ts"]` is YAML. Need YAML parser. `yj` is not standard. |

**Hidden complexities:**

1. **YAML parsing requirement:**
   - Cycle files use YAML frontmatter
   - Need to parse `files` array
   - Options: `yj`, `yq`, Python, Node
   - **None are guaranteed to be installed**

2. **Glob dialect mismatch:**
   - Product validation shows: `src/**/*.{ts,tsx}`
   - This is `minimatch` (Node.js glob) syntax, not bash
   - Bash `extglob` ≠ Node `minimatch`
   - **Conversion is lossy and error-prone**

3. **Recursive glob `**`:**
   - Bash 4.0+ supports `**` with `globstar` option
   - Need to check bash version: `${BASH_VERSION%%.*}`
   - Fallback to `find` if bash < 4.0

**Revised approach:**

**Option A:** Use Node.js for glob matching (already in ecosystem via dashboard)
```bash
node -e "
  const minimatch = require('minimatch');
  const files = require('./.claude/verify-cycles/extract.js');
  // Use minimatch for accurate matching
"
```

**Option B:** Simplify glob syntax to bash-compatible patterns
- Disallow `**`, use explicit `find`
- Disallow brace expansion, require separate patterns
- Simpler but less ergonomic

**Option C:** Hybrid approach
```bash
# Use find for recursive patterns
find src -name "*.ts" -o -name "*.tsx"
# Pipe to grep for exclusions
```

**Verdict:** Glob matching is **significantly more complex** than claimed. The design assumes Node.js minimatch syntax but proposes bash implementation.

**Recommendation:** Use Node.js for cycle discovery (consistent with dashboard dependency), not bash utilities.

---

## Additional Challenges

### 4. The "Changed Files" Contract Doesn't Exist

**Spelunk finding:** Review agent says "identify changed files" but doesn't specify how.

**Design solution:** Create new contract.

**Challenge:** This changes the review agent's fundamental behavior. Currently:
- Different modes use different git commands
- No standard output format
- Each invocation context (epic, PR, working dir) is different

**Reality:** We're not "enhancing" the review agent. We're **defining** its file discovery behavior for the first time. This is a **new feature**, not an enhancement.

### 5. Manual Cycle Integration is Undefined

**Design says:** Review agent shows checklist to human for manual cycles.

**Challenge:** How does the review agent pause and wait for human input?

**Current reality:** Agents don't have a "wait for human" primitive. They:
1. Run to completion
2. Return output to parent agent
3. Parent agent continues

**Problem:** If review agent is spawned by coding agent:
```
Coding Agent → Task("agent-ecosystem:code-review", "...")
                ↓
            Review Agent encounters manual cycle
                ↓
            ??? How to pause for human ???
                ↓
            Review Agent returns verdict to Coding Agent
```

**Options:**
1. **Return `WAITING_FOR_HUMAN` status** - Coding agent pauses, shows to human
2. **Skip manual cycles in spawned reviews** - Only run in manual `/review` invocation
3. **Return `ESCALATE:MANUAL_CHECK`** - Requires human to re-run review interactively

**None of these are documented in current agent handoff patterns.**

---

## Revised Assessment

### Simplicity: **FALSE**

The integration is **moderately complex**:
- New file discovery contract (not just enhancement)
- New bash/Node utilities for cycle handling
- YAML parsing dependency (not standard)
- Glob matching complexity (bash vs Node dialect)
- Manual cycle pause mechanism (undefined)

### Edge Cases: **INCOMPLETE**

Missed:
- Git renames
- Submodule changes
- Binary files
- Symlinks
- Large diffs
- Case sensitivity

### Glob Matching: **OVERSIMPLIFIED**

The design confuses:
- Node.js minimatch syntax (proposed format)
- bash extglob capabilities (proposed implementation)
- Requires dependency resolution or syntax simplification

---

## Recommendations for Design Revision

1. **Clarify the "newness" of file discovery contract** - This is a new feature, not an enhancement
2. **Choose Node.js for cycle utilities** - Already in ecosystem, proper glob support
3. **Define manual cycle protocol** - How does review agent pause?
4. **Simplify glob syntax or document minimatch requirement** - Don't mix dialects
5. **Add explicit exclude field** - Don't rely on negation glob patterns
6. **Handle git rename detection** - Use `git diff --name-status`
7. **Document binary file handling** - Skip or allow explicit inclusion

---

## Status

**CHALLENGED** - Design needs revision before Code Review Agent review.

**Critical issues:**
1. Manual cycle pause mechanism undefined
2. Glob matching implementation misaligned with proposed syntax
3. YAML parsing dependency not addressed
4. File discovery contract is new, not enhancement

---

**Next:** Revise design addressing these challenges, then spawn Code Review Agent for feasibility review.
