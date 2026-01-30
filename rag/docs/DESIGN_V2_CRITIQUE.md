# RAG Design v2 Critique: One-Shot Vibe Coding Readiness

**Goal:** Ensure the design is unambiguous enough for phone-based vibe coding with Claude.

**Verdict:** **NOT READY.** Multiple conflicting specifications, unclear which document is authoritative, and several interfaces that will cause confusion mid-implementation.

---

## Critical Blockers (Fix Before Coding)

### 1. Two Conflicting Architectures

**Problem:** DESIGN.md Section 15.1 explicitly rejects Dagster:
> "**Decision: No framework.** The complexity in our pipeline is in the individual stages... The orchestration between stages is a typed for-loop"

But PHASING_STRATEGY.md builds everything on Dagster:
> "**Orchestration:** Dagster — Asset lineage, retries, observability UI"

**Impact:** You'll get halfway through Phase 1 and not know whether to write `@asset` decorators or a `for` loop.

**Fix:** Pick ONE. Delete the other from docs. Recommendation: Keep Dagster, delete Section 15 of DESIGN.md. Dagster gives you free observability.

---

### 2. Embedding Model Disagreement

| Document | Model |
|----------|-------|
| DESIGN.md | `nomic-ai/CodeRankEmbed` (768-dim) |
| PHASING_STRATEGY config | `jinaai/jina-embeddings-v3` (768-dim) |
| DESIGN_V2.md | `CodeRankEmbed` (768-dim) |

**Impact:** You'll download the wrong model, dimensions will match so tests pass, but quality will differ. Silent failure.

**Fix:** Single source of truth in `rag/config.py`:
```python
EMBEDDING_MODEL = "nomic-ai/CodeRankEmbed"  # Explicitly chosen
EMBEDDING_DIM = 768
```
Delete all other hardcoded model names.

---

### 3. Token Limit Inconsistency

| Location | max_tokens |
|----------|------------|
| PHASING_STRATEGY config | 512 |
| DESIGN.md Section 4.1 | 2048 |
| DESIGN.md Section 4.3 | 2048 |

**Impact:** Chunks will either be too small (wasted context) or too large (truncation). Tests will pass with one value, production uses another.

**Fix:** Add to `rag/config.py`:
```python
MAX_CHUNK_TOKENS = 512       # Aggressive for denser retrieval
MAX_CHUNK_TOKENS_CODE = 1024 # Functions can be larger
```
And reference ONLY from config in all chunker implementations.

---

### 4. BM25 Status Unclear

**DESIGN_V2.md says:**
> "BM25Store — Replaced by Graphiti built-in search"

**DESIGN.md says:**
> Section 5.2: Detailed BM25 via bm25s implementation
> Section 7.2: BM25 search in retrieval pipeline

**PHASING_STRATEGY says:**
> No mention of BM25 in asset graph

**Impact:** You'll either implement BM25 (wasted effort if V2 is right) or skip it (broken retrieval if DESIGN.md is right).

**Fix:** DESIGN_V2.md is the authoritative source (per task description). Add explicit deprecation notice to DESIGN.md Section 5.2:
```markdown
> **DEPRECATED:** BM25 removed in v2. See DESIGN_V2.md. Graphiti provides keyword search.
```

---

## Interface Weaknesses (Will Cause Debugging Pain)

### 5. ChunkID Generation Inconsistent

**DESIGN.md:**
```python
id: str  # deterministic hash: sha256(source_uri + byte_range)
```

**PHASING_STRATEGY:**
```python
@staticmethod
def from_content(source_uri: str, start: int, end: int) -> "ChunkID":
    """Create ChunkID from source location.
    Returns: ChunkID(SHA256(f"{source_uri}:{start}:{end}"))
    """
```

Note the colon separators in PHASING_STRATEGY vs implicit concatenation in DESIGN.md.

**Impact:** Same chunk will have different IDs depending on which code path created it. Deduplication breaks.

**Fix:** Single implementation with exact format:
```python
# rag/core/chunk_id.py
import hashlib

def make_chunk_id(source_uri: str, start: int, end: int) -> str:
    """Canonical chunk ID. NEVER construct manually elsewhere.

    Format: SHA256("{source_uri}|{start}|{end}")
    Pipe separator chosen because it's invalid in file paths.
    """
    raw = f"{source_uri}|{start}|{end}"
    return hashlib.sha256(raw.encode()).hexdigest()
```

---

### 6. RawChunk/CleanChunk Field Explosion

Both dataclasses have 20+ fields, many duplicated:
```python
@dataclass
class RawChunk:
    language: str | None = None
    symbol_name: str | None = None
    symbol_kind: str | None = None
    # ... 15 more optional fields

@dataclass
class CleanChunk:
    language: str | None = None  # Same 15 fields again
    symbol_name: str | None = None
    # ...
```

**Impact:** When adding a new metadata field, you'll forget to add it to one class. Silent data loss.

**Fix:** Extract common fields:
```python
@dataclass
class ChunkMetadata:
    """Shared metadata fields. Single definition."""
    language: str | None = None
    symbol_name: str | None = None
    # ... all 15 fields

@dataclass
class RawChunk:
    id: str
    text: str
    source_type: SourceTypeDef
    metadata: ChunkMetadata

@dataclass
class CleanChunk:
    id: str
    text: str  # scrubbed
    source_type: SourceTypeDef
    metadata: ChunkMetadata  # same object, no duplication
    audit: ScrubAuditEntry | None
```

---

### 7. Path Matching Regex Duplicated

`InMemoryRegistry._path_matches()` and `SQLiteRegistry._path_matches()` have identical implementations copy-pasted. Also duplicated in `CallLinker._path_matches()`.

**Impact:** Bug fix in one place won't propagate. Subtle differences will emerge.

**Fix:** Extract to shared function:
```python
# rag/extractors/path_matching.py

def route_path_matches(pattern: str, request_path: str) -> bool:
    """Match route pattern against request. Single implementation.

    /api/users/{id} matches /api/users/123
    /api/users/{id}/orders matches /api/users/123/orders
    """
    import re
    path = request_path.split("?")[0].rstrip("/")
    pattern = pattern.rstrip("/")
    regex = re.sub(r'\{[^}]+\}', r'[^/]+', pattern)
    return re.match(f"^{regex}$", path) is not None
```

Note: Also fixed the regex — original allows trailing segments which may not be intended.

---

### 8. Protocol Methods Missing Return Specs for Edge Cases

```python
class RouteRegistry(Protocol):
    def get_routes(self, service: str) -> list[RouteDefinition]:
        """Get all routes for a service.
        Returns: List of routes, or empty list if service unknown.
        """
```

What about:
- Service exists but has zero routes? (Same as unknown?)
- Service name has different casing? (`User-Service` vs `user-service`)

**Fix:** Add explicit edge case handling:
```python
def get_routes(self, service: str) -> list[RouteDefinition]:
    """Get all routes for a service.

    Args:
        service: Service name (case-insensitive, normalized to lowercase)

    Returns:
        List of routes. Empty if service unknown OR service has no routes.
        Caller cannot distinguish these cases (by design - both mean "no routes").
    """
```

---

## Control Flow Gaps

### 9. Route Extraction Ordering Not Explicit in V2

DESIGN_V2.md shows the flow:
```
Code Ingestion → PHI Scrubbing → LanceDB + Graphiti
```

But doesn't show that routes must be extracted from ALL services BEFORE calls can be linked. PHASING_STRATEGY covers this, but V2 doesn't reference it.

**Impact:** Someone reading only V2 will process services sequentially and wonder why auth-service calls to user-service don't link.

**Fix:** Add to DESIGN_V2.md Data Flow section:
```markdown
### Dependency: Routes Before Calls

Route extraction must complete for ALL services before call linking:

1. **Pass 1:** Extract routes from all services → RouteRegistry
2. **Pass 2:** Extract calls, link using RouteRegistry → ServiceRelations
3. **Pass 3:** Write to Graphiti

This is why PHASING_STRATEGY uses Dagster asset dependencies:
route_registry → service_relations → knowledge_graph
```

---

### 10. PHI Scrubbing Position Varies

**DESIGN.md Section 15.8:**
```
Crawl → Scrub Gate → Embed → Index
```

**DESIGN_V2.md:**
```
Crawl → PHI Scrubbing → LanceDB + Graphiti (parallel)
```

**PHASING_STRATEGY Dagster assets:**
```
raw_code_files → route_registry → service_relations → knowledge_graph
                → code_chunks → clean_chunks → vector_index
```

These are three different orderings.

**Impact:** You'll implement one, tests pass, then realize the graph doesn't have scrubbed text because scrubbing happens after graph ingestion.

**Fix:** Make scrubbing position explicit in V2:
```markdown
### Scrubbing Position (CRITICAL)

PHI scrubbing happens BEFORE any storage:

Source → Chunks → **SCRUB** → [LanceDB, Graphiti, RouteRegistry]

Never write RawChunk to any store. Type system enforces this:
- LanceStore.insert() accepts EmbeddedChunk (contains CleanChunk)
- GraphStore.add_episode() accepts scrubbed text only
```

---

## Testability Issues

### 11. Checkpoint Commands Reference Non-Existent CLI

PHASING_STRATEGY shows:
```bash
python -m rag.extractors --checkpoint python_http
```

But no CLI spec defines `--checkpoint`. The crawl CLI in DESIGN.md Section 8.1 doesn't have this flag.

**Fix:** Either:
1. Add checkpoint support to CLI spec, OR
2. Change checkpoints to pytest markers:
```bash
pytest rag/extractors.py -k "checkpoint_python_http"
```

---

### 12. MockGraphStore Parity Tests Insufficient

Only 5 test cases, all happy-path:
```python
PARITY_TEST_CASES = [
    ("The auth-service calls user-service...", [EntityType.SERVICE], 2, ...),
    # ... 4 more
]
```

Missing:
- Empty input
- Input with no entities
- Unicode/emoji in service names
- Very long service names
- Service names that look like people names

**Fix:** Add edge cases:
```python
PARITY_TEST_CASES = [
    # ... existing ...
    ("", [], 0, "Empty input returns no entities"),
    ("The quick brown fox", [], 0, "No service patterns"),
    ("The auth-service-v2-beta calls api", [EntityType.SERVICE], 1, "Complex service name"),
    ("Paul's api calls Paul-service", [EntityType.SERVICE], 1, "Name collision"),
]
```

---

### 13. No Failure Injection Points

Protocols define error types:
```python
class StorageError(RAGError):
    retryable: bool = False
```

But no way to trigger these in tests. How do you test retry logic?

**Fix:** Add test hooks to stores:
```python
class LanceStore:
    _fail_next_insert: bool = False  # Test hook

    async def insert(self, chunk: EmbeddedChunk) -> None:
        if self._fail_next_insert:
            self._fail_next_insert = False
            raise StorageError("Simulated failure", retryable=True)
        # ... real implementation
```

Or use dependency injection with a `FailingStore` wrapper.

---

## Milestone Issues

### 14. Phase 0 Has No Verifiable Deliverable

> **Deliverable:** All interfaces, types, and contracts defined. Zero implementation.
> **Verification:** Type checker passes

"Type checker passes" on zero implementation means nothing. Empty files pass.

**Fix:** Phase 0 deliverable should be:
```markdown
**Phase 0 Deliverable:**
1. `rag/core/types.py` - All dataclasses with example instantiation in docstrings
2. `rag/core/protocols.py` - All Protocol classes
3. `tests/test_types.py` - Smoke test that instantiates each type
4. `mypy rag/` passes with `--strict`

**Verification Script:**
```bash
# verify_phase0.sh
set -e
mypy rag/ --strict
python -c "from rag.core.types import *; print('Types importable')"
pytest tests/test_types.py -v
echo "Phase 0 VERIFIED"
```
```

---

### 15. Line Counts Don't Add Up

PHASING_STRATEGY claims:
> Service Extractor: 360 lines
> Route Extractor + Linker: 290 lines
> Grand Total: 650 lines

But then adds RouteRegistry:
> registry.py: 50 lines
> sqlite_registry.py: 50 lines
> **Grand Total: 750 lines**

And the Dagster assets add another ~200 lines not counted.

**Impact:** You'll think "750 lines, I can do this in a day" and be wrong.

**Fix:** Honest line count table:
```markdown
| Component | Lines | Cumulative |
|-----------|-------|------------|
| types.py | 200 | 200 |
| extractors/ | 360 | 560 |
| routes/ | 290 | 850 |
| registry/ | 100 | 950 |
| stores.py | 300 | 1250 |
| dagster/assets.py | 200 | 1450 |
| retrieval.py | 150 | 1600 |
| tests/ | 500 | 2100 |
| **TOTAL** | **2100** | |
```

---

### 16. No Integration Milestone

Phases are:
1. Chunking
2. PHI Scrubbing
3. LanceDB
4. Graph Store
5. (various)

Missing: "Wire everything together and run end-to-end"

**Fix:** Add Phase 7: Integration
```markdown
## Phase 7: End-to-End Integration

**Deliverable:** Single command ingests a test repo and answers a query.

**Tasks:**
1. Wire all components in `rag/pipeline.py`
2. Create test fixture repo (3 services, 10 files each)
3. Run full ingest
4. Execute 5 test queries, verify results

**Smoke Test:**
```bash
./scripts/integration_test.sh
# Creates fixture repo
# Runs: python -m rag.crawl --repo-path ./fixtures/test-repo
# Runs: python -m rag.query "What calls auth-service?"
# Asserts: Results contain user-service
```

**Verification:** Query returns expected service relationships.
```

---

## Summary: Required Fixes for One-Shot Viability

### Must Fix (Blocking)

| # | Issue | Owner Action |
|---|-------|--------------|
| 1 | Dagster vs No-Framework conflict | Delete DESIGN.md Section 15 |
| 2 | Embedding model disagreement | Single source in config.py |
| 3 | Token limit inconsistency | Single source in config.py |
| 4 | BM25 status unclear | Add deprecation notice to DESIGN.md |

### Should Fix (Reduce Debugging)

| # | Issue | Owner Action |
|---|-------|--------------|
| 5 | ChunkID format inconsistent | Single function in chunk_id.py |
| 6 | Field duplication in dataclasses | Extract ChunkMetadata |
| 7 | Path matching duplicated | Extract to shared module |
| 9 | Route ordering not in V2 | Add dependency diagram |
| 10 | PHI scrubbing position varies | Explicit position statement |

### Nice to Have (Quality)

| # | Issue | Owner Action |
|---|-------|--------------|
| 11 | Checkpoint CLI missing | Add pytest markers instead |
| 12 | Parity tests insufficient | Add edge cases |
| 14 | Phase 0 not verifiable | Add verification script |
| 15 | Line counts wrong | Honest table |
| 16 | No integration milestone | Add Phase 7 |

---

## Recommended Reading Order for Implementation

After fixes applied:

1. **DESIGN_V2.md** — Authoritative architecture
2. **rag/config.py** — All magic numbers (create this first)
3. **PHASING_STRATEGY.md Phases 0-3** — Types, chunking, scrubbing, LanceDB
4. **PHASING_STRATEGY.md Phases 4a-4f** — Extraction (split phases)
5. **PHASING_STRATEGY.md Phase 5-6** — Vector + Graph stores
6. **PHASING_STRATEGY.md Phase 7** — Integration (add this)

Skip DESIGN.md except for Section 3 (Corpus Types) and Section 12 (Design Decisions).
