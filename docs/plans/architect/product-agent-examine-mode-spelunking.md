# Product Agent Examine Mode Spelunking

**Status:** DRAFT
**Author:** Architecture Agent
**Date:** 2026-01-10

## Problem

When a user explicitly requests the Product Agent to use spelunking for codebase exploration, the agent doesn't invoke it. This occurred with the query:

> "/agent-ecosystem:orchestrator can you have the product agent route with the spelunker to investigate gaps between our readme and reality of our codebase"

**Root causes identified:**

1. **Orchestrator routing gap**: No routing rule exists for "documentation audit" or "README vs codebase reality" tasks
2. **Product Agent scope limitation**: Spelunking instructions exist only for Execute Mode (design validation), not Examine Mode (codebase exploration)
3. **Task-type ambiguity**: Hybrid tasks (exploration + documentation) don't match existing routing patterns

## Goal

Enable Product Agent to use spelunking in Examine Mode for discovering what a codebase actually does, independent of design validation workflows.

## Approach

### 1. Add Orchestrator Routing Rule

Add explicit routing for documentation/reality audit tasks.

**File:** `plugin/agents/orchestrator.md`

**Location:** After line 36 (after Quality Gates section)

**Addition:**
```markdown
### Documentation Phase (Product explores)
- README/docs audit → spawn Product Agent (examine mode with spelunking)
- Documentation gaps → spawn Product Agent (examine mode)
- "What does this actually do" → spawn Product Agent (examine mode with spelunking)
```

### 2. Extend Product Agent Examine Mode

Add spelunking capability to Examine Mode for ground-truth discovery.

**File:** `plugin/agents/product.md`

**Location:** After line 14 (after Examine Mode output)

**Addition:**
```markdown
### Examine Mode with Spelunking

When investigating what a codebase ACTUALLY does (vs documentation claims):

**Step 1: Identify exploration focus**
- What area needs ground-truth discovery?
- What documentation might be out of sync?

**Step 2: Spelunk for flows**
```
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: "/code spelunk --for=product --focus='<area>'"
)
```

**Step 3: Compare to documentation**
- Read existing docs (README, wiki, comments)
- Note discrepancies between documented and actual behavior
- Identify undocumented features

**Step 4: Output reality report**
```markdown
# Reality Check: [Area]

## Documented Behavior
[What docs/README say]

## Actual Behavior
[What spelunking revealed]

## Gaps
- [ ] Feature X exists but undocumented
- [ ] Feature Y documented but doesn't exist
- [ ] Feature Z behavior differs from docs

## Recommendations
[Specific doc updates needed]
```

**When to use:**
- User asks "what does this codebase actually do?"
- User wants to audit documentation accuracy
- User wants to update README/docs based on reality
- Explicit request to "investigate gaps"
```

### 3. Add Trigger Keywords to Orchestrator

Help orchestrator recognize documentation audit requests.

**File:** `plugin/agents/orchestrator.md`

**Addition to routing logic (conceptual, for agent behavior):**

```markdown
## Routing Trigger Keywords

| Keywords | Route To | Mode |
|----------|----------|------|
| "audit docs", "README accuracy", "documentation gaps" | Product | Examine + Spelunk |
| "what does this actually do", "reality check" | Product | Examine + Spelunk |
| "investigate gaps between docs and code" | Product | Examine + Spelunk |
```

## Files to Modify

| File | Change | Lines Added |
|------|--------|-------------|
| `plugin/agents/orchestrator.md` | Add Documentation Phase routing + trigger keywords | ~20 |
| `plugin/agents/product.md` | Add Examine Mode with Spelunking section | ~45 |

**Total:** ~65 lines

## Non-Goals

- Not changing Execute Mode validation workflow (already works)
- Not modifying spelunking implementation itself
- Not adding new lenses (flows lens is appropriate for Product)

## Testing

1. **Routing test**: Query orchestrator with "audit README against codebase" → should spawn Product Agent
2. **Spelunk invocation test**: Product Agent in examine mode with explicit spelunk request → should call `/code spelunk --for=product`
3. **End-to-end test**: User query about documentation gaps → Product Agent → spelunks → produces reality report

## Alternatives Considered

### A. Create dedicated Documentation Audit Agent
- **Rejected**: Over-engineering. Product Agent already understands "what does this solve" - just needs spelunking access in examine mode.

### B. Route all documentation tasks to Architect
- **Rejected**: Architect focuses on technical design, not product/user-facing documentation reality checks.

### C. Let user invoke spelunking directly
- **Rejected**: Defeats purpose of agent orchestration. Users should express intent, not implementation details.

## Success Criteria

- [ ] User query "investigate gaps between README and codebase" routes to Product Agent
- [ ] Product Agent invokes spelunking when examining codebase reality
- [ ] Output includes comparison of documented vs actual behavior
- [ ] Existing Execute Mode validation workflow unchanged

---

**Next:** Product Agent validation, then implementation via `/decompose`
