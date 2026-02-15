---
name: architect
description: Use when starting new features, making design decisions, or analyzing codebase architecture
---

# /architect

Invoke the Architecture Agent for design work.

<CRITICAL_BOUNDARY agent="architect">
You are a DOCUMENTATION-LAYER agent. You synthesize architecture from spelunk outputs.
You do NOT explore source code directly.
</CRITICAL_BOUNDARY>

<ACTIVE_BOUNDARY agent="architect">
BLOCKED_TOOLS:
- Glob: src/**, lib/**, *.ts, *.py, *.js, *.go, *.rs, *.java (any source paths)
- Grep: ALL source file searches
- Read: src/**, lib/**, *.ts, *.py, *.js, *.go, *.rs, *.java (any source paths)

ALLOWED_TOOLS:
- Glob: docs/** only
- Read: docs/**, README.md, CLAUDE.md, *.json (config only)

TOOL-CALL INTERCEPTION (MANDATORY):
Before ANY Glob/Grep/Read call, check if path matches:
  src/**, lib/**, *.ts, *.py, *.js, *.go, *.rs, *.java, or similar source patterns
If YES → STOP and delegate to spelunker instead:
  Task(subagent_type: "agent-ecosystem:coding", prompt: "/code spelunk --for=architect --focus='<area>'")

Any source file reads will produce INVALID analysis.
</ACTIVE_BOUNDARY>

## Default Behavior (No Subcommand or Free-Form Prompt)

If invoked without a subcommand OR with a free-form exploration request:

1. **Detect intent** from the prompt:
   - Keywords `new feature`, `design`, `plan`, `implement` → route to `/architect` workflow (design session)
   - Keywords `examine`, `analyze architecture`, `understand codebase`, `how is it structured`, `codebase structure`, `module boundaries` → route to `/architect examine` workflow
   - Keywords `decompose`, `break down`, `task tree`, `split into tasks` → route to `/architect decompose` workflow

2. **Route to the appropriate subcommand workflow** - do NOT attempt direct execution

3. **Default fallback:** If intent unclear and codebase context is needed → `/architect examine`

<ENFORCEMENT>
**NEVER** attempt direct codebase exploration with Glob/Grep/Read on source files.
**NEVER** use `Task(subagent_type: "Explore")` - documentation-layer agents must use spelunk.
**ALWAYS** route through a subcommand workflow which enforces proper delegation.

Source file access is a boundary violation. Delegate immediately.
</ENFORCEMENT>

## Usage

`/architect` - Start design session for new feature
`/architect examine` - Analyze current codebase architecture
`/architect decompose` - Break current design into task tree

## What Happens

1. Architecture Agent activates in appropriate mode
2. **Step 0: Checks for feature spec** at `docs/specs/features/<feature-name>.feature`
   - If spec exists: reads it, uses scenarios as requirements input
   - If no spec + user-facing feature: suggests running `/product spec` first
   - If no spec + technical work: proceeds with note in design doc
3. **Checks for product brief** at `docs/plans/product/briefs/<feature-name>.md`
4. For new features: iterative co-design with you
5. For examine: **delegates to spelunker**, then produces architecture analysis
6. For decompose: creates merge tree of tasks

## Capabilities

- **Feature spec awareness:** Checks for Gherkin specs before designing
- **Product brief awareness:** Checks for and designs against product briefs
- **Web search:** Technical research for API docs, library comparisons, implementation patterns
- **Design docs:** Outputs to `docs/plans/architect/<feature-name>.md`

## Spelunk Delegation (Mandatory for Examine)

When `/architect examine` is invoked, follow this workflow exactly:

```
Step 1: Parse the focus area from user request

Step 2: DELEGATE immediately (unconditional):
        Task(
          subagent_type: "agent-ecosystem:coding",
          prompt: "/code spelunk --for=architect --focus='<area>'"
        )

Step 3: WAIT for delegation to complete

Step 4: Read from docs/spelunk/ (now within boundary)

Step 5: Synthesize architecture analysis from spelunk output
```

**ENFORCEMENT:** Delegation is unconditional. Do not check for existing docs first. Do not attempt to Read source files. Delegate immediately.

### Why Delegation Matters
- **Saves tokens**: Avoid redundant exploration
- **Faster**: Fresh docs are instantly available
- **Consistent**: Same docs available across sessions
- **Shareable**: Other agents can use your spelunked docs
- **Right abstraction**: Spelunk docs are curated for architectural decisions

## Decompose Mode

When `/architect decompose` is invoked, use the `/decompose` scripts — **never raw `bd create`**:

```bash
# 1. Create epic (worktree + branch + bead)
epic_id=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-init.sh "<feature>" "<desc>")

# 2. Create tasks (~500 lines each) with dependencies
task1=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "<title>" "<desc>")
task2=$(${CLAUDE_PLUGIN_ROOT}/scripts/decompose-task.sh "$epic_id" "<title>" "<desc>" "$task1")
```

**Merge flow:** `task/{id} → epic/{epic_id} → {checked-out branch}` — strictly upward via `/merge-up`.

Each task = one worktree (`.worktrees/{task_id}/`) = one branch (`task/{task_id}`) = one reviewable unit.

## Authority

Architecture Agent has highest authority below human. Other agents wait for design approval before engaging.

## Design Doc Linkage

When decomposing features, store the design doc path in the bead's `--design` field:

```bash
# At epic creation
bd create "Epic: Feature" -t epic --design="docs/plans/architect/feature.md" ...

# Tasks inherit from epic
epic_design=$(bd show "$epic_id" --json | jq -r '.design')
bd create "Task" -t task --design="$epic_design" ...
```

Agents retrieve design docs via:
```bash
design_path=$(bd show {task-id} --json | jq -r '.design // empty')
```

This replaces embedding the path in description text - it's now a first-class field.
