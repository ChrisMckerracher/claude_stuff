# Working on RAG Phase Tasks

This document explains how Claude agents should work on tasks within the RAG phasing system.

## Phase Structure

Each phase is organized as follows:

```
rag/phases/
├── phase0/          # Core Protocols & Types
│   ├── task.md      # Phase overview and checklist
│   ├── task1.md     # Individual task
│   ├── task2.md
│   └── test.md      # Cucumber-style test scenarios
├── phase1/          # Chunking Pipeline
├── phase2/          # PHI Scrubbing
├── phase3/          # LanceDB Store
├── phase4/          # Service Extraction (largest phase)
├── phase5/          # Retrieval Layer
├── phase6/          # Crawlers
├── phase7/          # Orchestrator
└── phase8/          # Graphiti Integration (Post-MVP)
```

## Environment Management

**We strictly use `uv` for all Python package management.** Do not use `pip` directly.

### Installing Dependencies

```bash
# Add a new dependency
uv add transformers

# Add a dev dependency
uv add --dev pytest

# Install all dependencies from pyproject.toml
uv sync

# Run a command in the virtual environment
uv run python -c "from rag.core.types import RawChunk; print('OK')"

# Run pytest
uv run pytest tests/
```

### Why uv?

- Faster than pip (10-100x)
- Deterministic lockfile (`uv.lock`)
- Handles virtual environments automatically
- Compatible with `pyproject.toml`

### Common Commands

| Task | Command |
|------|---------|
| Add package | `uv add <package>` |
| Add dev package | `uv add --dev <package>` |
| Remove package | `uv remove <package>` |
| Sync environment | `uv sync` |
| Run script | `uv run python script.py` |
| Run pytest | `uv run pytest` |
| Show installed | `uv pip list` |

### Before Starting a Phase

Always ensure dependencies are installed:

```bash
uv sync
uv run python -c "import rag; print('Environment ready')"
```

## Working on a Phase

### Step 1: Read the Phase Overview

Start by reading `task.md` in the phase folder:
- Understand the deliverable
- Review the files to create
- Check prerequisites (previous phases)
- Note the verification checklist

### Step 2: Check Phase Dependencies

Phases must be completed in order:
```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8
```

Do not start a phase until all previous phases are complete.

### Step 3: Work on Individual Tasks

For each task file (`task1.md`, `task2.md`, etc.):

1. **Read the task completely** before writing code
2. **Mark status** as "In Progress" when starting:
   ```markdown
   **Status:** [ ] Not Started  |  [x] In Progress  |  [ ] Complete
   ```
3. **Implement** following the provided code structure
4. **Write tests** as specified in the task
5. **Run acceptance criteria** to verify
6. **Mark complete** when all criteria pass:
   ```markdown
   **Status:** [ ] Not Started  |  [ ] In Progress  |  [x] Complete
   ```

### Step 4: Run Phase Tests

After completing all tasks in a phase:

1. Run the Quick Check from `task.md`
2. Execute all test scenarios from `test.md`
3. Verify all items in the Verification Checklist

### Step 5: Update Phase Checklist

In `task.md`, mark completed items:
```markdown
## Tasks
- [x] [Task 1: Define Core Data Types](task1.md)
- [x] [Task 2: Define Storage Protocols](task2.md)
- [ ] [Task 3: Define Processing Protocols](task3.md)  # Still pending
```

## Task Completion Rules

### What "Complete" Means

A task is complete when:
- All acceptance criteria are checked
- All tests pass
- Quick check runs without errors
- Code is committed to version control

### Marking Tasks Complete

Only mark a task as complete when you have **verified** it works:

```markdown
## Acceptance Criteria

- [x] Implements VectorStore protocol
- [x] Insert validates vector dimension
- [x] Search returns results sorted by similarity
- [ ] Delete returns True if existed  # NOT YET - don't mark complete!
```

### Partial Progress

If you must stop before completing a task:
1. Keep status as "In Progress"
2. Add notes about what's done and what remains
3. Commit work-in-progress code

## Working with Test Scenarios

### Reading Cucumber Scenarios

Each phase has `test.md` with Gherkin-style scenarios:

```gherkin
Feature: Vector Storage
  Scenario: Insert and retrieve single chunk
    Given an embedded chunk with text "hello world"
    When I insert the chunk into LanceStore
    And I search with the same vector
    Then I should get 1 result
```

### Implementing Tests

Convert Cucumber scenarios to pytest tests:

```python
# tests/test_phase3/test_lance_store.py

async def test_insert_and_retrieve_single_chunk(lance_store):
    """Insert and retrieve single chunk."""
    # Given an embedded chunk with text "hello world"
    chunk = make_embedded_chunk("hello world")

    # When I insert the chunk into LanceStore
    await lance_store.insert(chunk)

    # And I search with the same vector
    results = await lance_store.search(chunk.vector, limit=1)

    # Then I should get 1 result
    assert len(results) == 1
    assert results[0].chunk.text == "hello world"
```

### Running Tests

```bash
# Run specific phase tests
uv run pytest tests/test_phase3/ -v

# Run with specific marker
uv run pytest -m "not integration" tests/

# Run quick check
uv run python -c "..." # from task.md
```

## Phase-Specific Guidelines

### Phase 0: Core Types
- No implementation code, only type definitions
- Use `uv run mypy --strict` to verify
- Focus on clear docstrings

### Phase 1-3: Foundation
- Unit tests only, no external dependencies
- Use mocks where needed
- Keep implementations simple

### Phase 4: Service Extraction
- Largest phase - split into sub-phases 4a-4f
- Checkpoint tests at each sub-phase
- Can be paused/resumed at sub-phase boundaries

### Phase 5-7: Integration
- May need previous phase components
- Use fixtures for complex setup
- Test error handling thoroughly

### Phase 8: Production
- Requires external services (Neo4j)
- Mark tests with `@pytest.mark.integration`
- Document environment setup

## Vibe Coding Considerations

This system is designed for "vibe coding on phone" with limited context:

### Session Recovery

If you lose context mid-phase:
1. Check which tasks are marked "Complete"
2. Find the first "In Progress" or "Not Started" task
3. Read that task's full specification
4. Run its quick check to see current state

### Checkpoint Tests

Use checkpoint tests to verify state after breaks:

```bash
# Verify Python extraction works
uv run python -m rag.extractors --checkpoint python_http

# Verify registry works
uv run python -m rag.extractors --checkpoint registry_crud
```

### File Structure

For phone vibe coding, files are consolidated:
- `rag/types.py` - All types in one file
- `rag/extractors.py` - All extractors together
- `rag/stores.py` - All storage implementations

This minimizes file switching on mobile.

## Error Recovery

### If Tests Fail

1. Check the exact assertion that failed
2. Read the "STUCK?" debug checklist in the task
3. Add print statements to understand state
4. Fix the issue and re-run

### If Phase Can't Complete

1. Document what's blocking in the task file
2. Create an issue if it's a design problem
3. Don't mark the phase complete
4. Move to a non-dependent task if possible

## Communication Protocol

### Starting Work

```
Agent: Starting Phase 3, Task 1: LanceDB Store Implementation
Current state: Phase 0-2 complete, Phase 3 not started
```

### Progress Updates

```
Agent: Phase 3, Task 1 - 70% complete
- Insert working ✓
- Search working ✓
- Delete: in progress
```

### Completion

```
Agent: Phase 3 complete
- All 2 tasks done
- Quick check passes
- 5/5 verification checklist items checked
Ready for Phase 4
```

## Summary

1. **Read** the phase overview (`task.md`)
2. **Check** dependencies are complete
3. **Work** on tasks in order, marking status
4. **Test** using Cucumber scenarios as guide
5. **Verify** all checklist items
6. **Report** completion before moving on
