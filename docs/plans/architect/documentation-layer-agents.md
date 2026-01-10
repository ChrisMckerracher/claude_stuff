# Documentation Layer Agents

**Status:** DRAFT
**Author:** Architecture Agent
**Date:** 2026-01-10

## Problem

Architect and Product agents currently may read source code directly when examining codebases. This creates several issues:

1. **Duplicated exploration**: Multiple agents re-reading the same code
2. **Wrong abstraction level**: These agents get implementation details they don't need
3. **Spelunking underutilized**: The spelunking system exists to provide curated views, but isn't being used
4. **Context bloat**: Agents consume context on raw code instead of distilled documentation

The original bug: User explicitly asked Product Agent to use spelunking, but it didn't route there because agents default to direct code reading.

## Design Principle

**Two types of agents: Documentation-layer and Code-layer.**

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCUMENTATION LAYER                       │
│                                                              │
│   Architect Agent          Product Agent          QA Agent   │
│        │                        │                     │      │
│        ▼                        ▼                     ▼      │
│   ┌─────────┐              ┌─────────┐          ┌─────────┐  │
│   │ docs/   │              │ docs/   │          │ docs/   │  │
│   │ plans/  │              │ spelunk/│          │ spelunk/│  │
│   │         │              │ flows/  │          │contracts│  │
│   └─────────┘              └─────────┘          └─────────┘  │
│        │                        │                     │      │
│        └────────────────────────┼─────────────────────┘      │
│                                 ▼                            │
│                  "Need codebase info?"                       │
│                                 │                            │
│                                 ▼                            │
│              ┌────────────────────────┐                      │
│              │ Delegate to Code Layer │                      │
│              └────────────────────────┘                      │
│                                 │                            │
└─────────────────────────────────┼────────────────────────────┘
                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                      CODE LAYER                              │
│                                                              │
│   Coding Agent                    Security Agent             │
│   (implementation + spelunk)      (security-focused audit)   │
│        │                               │                     │
│        ▼                               ▼                     │
│   ┌─────────────────────────────────────────────────────┐    │
│   │ src/**  lib/**  plugin/**  (full code access)       │    │
│   └─────────────────────────────────────────────────────┘    │
│        │                               │                     │
│        ▼                               ▼                     │
│   Writes to docs/spelunk/         Writes to docs/spelunk/    │
│   {lens}/{focus}.md               trust-zones/{focus}.md     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Documentation-layer agents:** Architect, Product, QA
- Read from `docs/`, not source code directly
- Delegate to code-layer agents when needing codebase info

**Code-layer agents:** Coding, Security
- Full access to source code
- Security Agent is a specialized code reader focused on vulnerabilities
- Write findings to `docs/spelunk/` for documentation-layer agents

## What Each Agent Can Read

### Documentation-Layer Agents

| Agent | Can Read | Cannot Read | When Needs Code Info |
|-------|----------|-------------|---------------------|
| Architect | `docs/plans/**`, `docs/spelunk/contracts/**`, `docs/spelunk/boundaries/**`, `README.md`, `CLAUDE.md` | `src/**`, `lib/**`, `plugin/**/*.ts` | Delegate to `/code spelunk --for=architect` |
| Product | `docs/plans/**`, `docs/spelunk/flows/**`, `README.md`, user-facing docs | `src/**`, `lib/**`, `plugin/**/*.ts` | Delegate to `/code spelunk --for=product` |
| QA | `docs/plans/**`, `docs/spelunk/contracts/**`, test files | Implementation code (reads tests, not impl) | Delegate to `/code spelunk --for=qa` |

### Code-Layer Agents

| Agent | Can Read | Writes To |
|-------|----------|-----------|
| Coding | Everything (`src/**`, `lib/**`, `plugin/**`, all code) | `docs/spelunk/{lens}/{focus}.md` |
| Security | Everything (`src/**`, `lib/**`, `plugin/**`, all code) | `docs/spelunk/trust-zones/{focus}.md` |

**Note:** Security Agent has full code access because security audits require examining actual implementation for vulnerabilities, injection points, auth boundaries, etc. It's a code-layer agent with a security lens, not a documentation-layer agent that delegates.

## Changes Required

### 1. Architect Agent (`plugin/agents/architect.md`)

Add at top of file:

```markdown
## Documentation Layer Constraint

You operate at the documentation layer. You may read:
- `docs/plans/**` - Design documents
- `docs/spelunk/contracts/**` - Interface definitions (from spelunking)
- `docs/spelunk/boundaries/**` - Module boundaries (from spelunking)
- `README.md`, `CLAUDE.md` - Project documentation

You may NOT read source code files directly (`src/**`, `lib/**`, `*.ts`, `*.py`, etc.).

**When you need codebase information:**
1. Check if `docs/spelunk/` has what you need (may be fresh)
2. If missing or stale, delegate:
   ```
   Task(
     subagent_type: "agent-ecosystem:code",
     prompt: "/code spelunk --for=architect --focus='<what you need>'"
   )
   ```
3. Read the resulting doc from `docs/spelunk/`

This ensures you get the right abstraction level and leverages cached knowledge.
```

### 2. Product Agent (`plugin/agents/product.md`)

Add at top of file:

```markdown
## Documentation Layer Constraint

You operate at the documentation layer. You may read:
- `docs/plans/**` - Design and product documents
- `docs/spelunk/flows/**` - User flows (from spelunking)
- `README.md` - Project documentation
- User-facing documentation

You may NOT read source code files directly (`src/**`, `lib/**`, `*.ts`, `*.py`, etc.).

**When you need codebase information:**
1. Check if `docs/spelunk/flows/` has what you need
2. If missing or stale, delegate:
   ```
   Task(
     subagent_type: "agent-ecosystem:code",
     prompt: "/code spelunk --for=product --focus='<what you need>'"
   )
   ```
3. Read the resulting doc from `docs/spelunk/`

This ensures you understand user-facing behavior without getting lost in implementation.
```

### 3. Update Examine Mode (Both Agents)

For **Architect** examine mode:
```markdown
### Examine Mode

Analyze codebase architecture through documentation layer:

1. Read `docs/spelunk/contracts/` and `docs/spelunk/boundaries/`
2. If docs missing or stale for your focus area:
   - Delegate: `/code spelunk --for=architect --focus="<area>"`
3. Read `docs/plans/` for existing design decisions
4. Synthesize architectural understanding from docs

**Output:** Architecture analysis based on spelunk docs, not raw code.
```

For **Product** examine mode:
```markdown
### Examine Mode

Understand what the codebase does through documentation layer:

1. Read `docs/spelunk/flows/` for existing flow documentation
2. If docs missing or stale for your focus area:
   - Delegate: `/code spelunk --for=product --focus="<area>"`
3. Read `README.md` and user-facing docs
4. Compare documented vs actual (from spelunk docs)

**Output:** Product analysis based on spelunk docs, not raw code.
```

### 4. Orchestrator Awareness

Add to `plugin/agents/orchestrator.md`:

```markdown
## Documentation Layer Principle

Architect and Product agents operate at the documentation layer:
- They read from `docs/plans/`, `docs/spelunk/`, `README.md`
- They do NOT read source code directly
- When they need codebase info, they delegate to Coding Agent via spelunking

This means:
- "Examine codebase" tasks still go to Architect/Product
- Those agents will automatically delegate to spelunker as needed
- Spelunk docs accumulate, reducing future exploration needs
```

## Files to Modify

| File | Change | Lines Added |
|------|--------|-------------|
| `plugin/agents/architect.md` | Add Documentation Layer Constraint + update Examine Mode | ~30 |
| `plugin/agents/product.md` | Add Documentation Layer Constraint + update Examine Mode | ~30 |
| `plugin/agents/qa.md` | Add Documentation Layer Constraint | ~20 |
| `plugin/agents/orchestrator.md` | Add Documentation Layer Principle section | ~15 |

**Total:** ~95 lines

**Note:** Security Agent (`plugin/agents/security.md`) does NOT need changes - it's already a code-layer agent with full code access. It just needs to ensure it writes findings to `docs/spelunk/trust-zones/` for other agents.

## Benefits

1. **Correct abstraction**: Agents get curated information at their level
2. **Accumulated knowledge**: Spelunk docs persist and get reused
3. **Reduced context**: No raw code bloating agent context
4. **Clear boundaries**: Each agent knows exactly what it can/cannot read
5. **Forced delegation**: Agents must use spelunking, can't bypass it

## Edge Cases

### "But I just need to see one file..."

No. The constraint is absolute. Even for "quick looks":
1. Check spelunk docs first
2. If needed, request spelunk for that specific focus
3. Read from spelunk output

This prevents the slippery slope of "just this once" becoming default behavior.

### Human explicitly grants code access

If human says "read src/auth/handler.ts directly", agent may comply. Human authority overrides documentation layer constraint. But agent should note this is an exception.

### Config files (package.json, tsconfig.json, etc.)

These are metadata, not implementation code. Agents may read config files directly as they inform architecture/product decisions without implementation details.

## Success Criteria

### Documentation-Layer Agents (Architect, Product, QA)
- [ ] Never use Read/Glob on `src/**`, `lib/**` without human override
- [ ] Delegate to code-layer agents (Coding or Security) when needing codebase info
- [ ] Read from `docs/spelunk/` docs, not raw code

### Code-Layer Agents (Coding, Security)
- [ ] Have full code access for their specialized tasks
- [ ] Write findings to `docs/spelunk/` for documentation-layer agents to consume
- [ ] Security Agent focuses on trust-zones, auth boundaries, vulnerabilities

### System-Wide
- [ ] Spelunk docs accumulate in `docs/spelunk/`
- [ ] Cross-agent knowledge sharing works via spelunk docs

---

**Next:** Product Agent validation, then implementation
