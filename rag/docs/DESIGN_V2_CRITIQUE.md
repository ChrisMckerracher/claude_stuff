# RAG v2 Design Critique

**Goal:** Make this near one-shot vibe-codeable on phone. Every ambiguity is a context switch. Every missing spec is a debugging session.

---

## Executive Summary: What's Good

The PHASING_STRATEGY.md is already quite strong for vibe coding:
- Phone-optimized file structure (consolidated files)
- Executable checkpoint markers
- Test vectors in docstrings
- "STUCK?" debug checklists
- Parity test cases for mock↔production

**The v2 design is 80% there.** This critique focuses on the remaining 20% that will cause pain.

---

## Critical Issues (Fix Before Coding)

### 1. Missing I/O Specs on Key Functions

**Problem:** Several functions have docstrings but no explicit input/output types or edge case handling.

**Affected:**

| Function | Missing |
|----------|---------|
| `HttpCallPattern.match()` | What does empty string URL return? |
| `_path_matches()` | Does `/api/users` match `/api/users/123/orders`? (Yes per doc, but not obvious) |
| `RouteExtractor.extract_from_repo()` | What if repo doesn't exist? Empty list or raise? |
| `CallLinker.link()` | What if `call.url_path` is None? |

**Fix:** Add explicit edge case table to each function:

```python
def match(self, node, source) -> list[ServiceCall]:
    """
    Edge Cases:
        | Input | Output |
        |-------|--------|
        | URL is empty string | [] |
        | URL has no http:// prefix | [] |
        | URL is in f-string | ServiceCall with MEDIUM confidence |
        | Multiple URLs in one call | First URL only (document why) |
    """
```

### 2. Ambiguous Confidence Thresholds

**Problem:** `ConfidenceThresholds` defined in config but usage is scattered:

```python
class ConfidenceThresholds:
    MIN_FOR_GRAPH = 0.5       # Don't add GUESS-level to graph
    MIN_FOR_LINKING = 0.7     # Need MEDIUM+ for call linking
    SHOW_TO_USER = 0.5        # Hide LOW/GUESS from search results
```

But then in `Confidence`:
```python
class Confidence:
    HIGH = 0.9
    MEDIUM = 0.7
    LOW = 0.5
    GUESS = 0.3
```

**Ambiguity:** Does "MIN_FOR_GRAPH = 0.5" mean `>=` or `>`? Is LOW included or excluded?

**Fix:** Make it explicit:

```python
class ConfidenceThresholds:
    """Threshold comparisons are always >=.

    MIN_FOR_GRAPH = 0.5 means confidence >= 0.5 (LOW and above, excludes GUESS)
    """
    MIN_FOR_GRAPH = 0.5       # >= LOW
    MIN_FOR_LINKING = 0.7     # >= MEDIUM (excludes LOW)
    SHOW_TO_USER = 0.5        # >= LOW
```

### 3. Silent Failures in Batch Operations

**Problem:** `scrub_batch()` returns `list[ScrubResult]` where some may have `error` set. But who checks this?

From Phase 7 orchestrator:
```python
# Scrub
clean_chunks = [self._scrubber.scrub(c) for c in chunks]
stats.chunks_scrubbed += len(clean_chunks)
```

This uses `.scrub()` not `.scrub_batch()`, and silently ignores failed scrubs.

**Fix:** Make failure handling explicit in orchestrator:

```python
# Option A: Fail fast (recommended for MVP)
clean_chunks = [self._scrubber.scrub(c) for c in chunks]  # raises on error

# Option B: Collect failures
results = self._scrubber.scrub_batch(chunks)
clean_chunks = [r.clean_chunk for r in results if r.success]
stats.scrub_failures.extend([r for r in results if not r.success])
```

### 4. Dagster Asset Return Types Inconsistent

**Problem:** Some assets return dataclasses, some return raw values:

```python
@asset
def raw_code_files(...) -> RawCodeFilesOutput:  # Good - typed

@asset
def knowledge_graph(...) -> KnowledgeGraphOutput:  # Good - typed

# But then in Phase 3:
@asset
def code_chunks(...) -> ???  # Not specified
```

**Fix:** Add explicit typed outputs for ALL assets:

```python
@dataclass
class CodeChunksOutput:
    chunks_by_service: dict[str, list[RawChunk]]
    total_chunks: int
    files_with_no_chunks: list[str]  # Files that failed to parse
```

---

## Moderate Issues (Will Slow You Down)

### 5. MockGraphStore Parity Gap

**Problem:** Mock uses regex patterns, production uses LLM extraction. The parity tests are good but don't cover:

| Production Behavior | Mock Behavior |
|---------------------|---------------|
| "auth service is having issues" | Extracts "auth-service" |
| "the auth thing" | Might extract "auth" as service |
| Context-dependent: "John deployed auth" | PERSON + SERVICE + relationship |

**Risk:** Tests pass with mock but behavior differs in production.

**Fix:** Add explicit parity gap documentation:

```python
# PARITY GAPS - Known divergences between mock and Graphiti LLM
# Run test_graphiti_parity when Neo4j is available to verify
KNOWN_DIVERGENCES = [
    ("the auth thing", "Mock may not extract 'auth' without 'service' suffix"),
    ("John deployed auth", "Mock won't create DEPLOYED relationship"),
]
```

### 6. Missing Retry/Backoff Specs

**Problem:** `StorageError` has `retryable` and `retry_after_seconds` but no guidance on:
- Max retries?
- Backoff multiplier?
- Circuit breaker?

**Fix:** Add retry policy to config:

```python
# rag/config.py
class RetryPolicy:
    """Retry policy for storage operations."""
    MAX_RETRIES = 3
    BASE_DELAY_SECONDS = 1.0
    BACKOFF_MULTIPLIER = 2.0
    MAX_DELAY_SECONDS = 30.0

    @staticmethod
    def should_retry(attempt: int, error: StorageError) -> tuple[bool, float]:
        """Returns (should_retry, delay_seconds)."""
        if not error.retryable or attempt >= RetryPolicy.MAX_RETRIES:
            return (False, 0)
        delay = min(
            RetryPolicy.BASE_DELAY_SECONDS * (RetryPolicy.BACKOFF_MULTIPLIER ** attempt),
            RetryPolicy.MAX_DELAY_SECONDS
        )
        return (True, delay)
```

### 7. Route Pattern Collision

**Problem:** What if two routes match the same request?

```python
# Service A
@router.get("/api/users/{id}")      # Pattern: /api/users/[^/]+

# Request: GET /api/users/me
# Should this match /api/users/{id} or a hypothetical /api/users/me ?
```

**Fix:** Document matching priority:

```python
def find_route_by_request(...) -> RouteDefinition | None:
    """
    Matching Priority:
    1. Exact match (no parameters) wins over parameterized
    2. More specific pattern wins (more path segments)
    3. First registered wins if tie

    Example:
        /api/users/me     → exact match (priority 1)
        /api/users/{id}   → parameterized (priority 2)
    """
```

### 8. Chunk ID Collision Handling

**Problem:** ChunkID is `SHA256(source_uri + byte_range)`. If file moves but content same, different ID. If file stays but byte range shifts (new imports added), different ID.

**Risk:** Re-indexing same content creates duplicates.

**Fix:** Consider content-based dedup:

```python
@dataclass(frozen=True)
class ChunkID:
    location_id: str   # SHA256(source_uri + byte_range) - for updates
    content_hash: str  # SHA256(text) - for dedup

    def __eq__(self, other):
        # Two chunks are "same" if content matches
        return self.content_hash == other.content_hash
```

Or document the duplicate strategy explicitly:
```python
# Strategy: Allow duplicates from different locations
# Rationale: Same code in two places is valuable context
# Dedup happens at search time via reranker
```

---

## Minor Issues (Nice to Have)

### 9. Test Fixture Structure Not Specified

**Problem:** Acceptance tests reference fixtures but don't define them:

```python
await ingest("fixtures/auth-service/")  # What's in this?
await ingest("fixtures/user-service/")
```

**Fix:** Add fixture spec:

```
fixtures/
├── auth-service/
│   ├── src/
│   │   └── auth/
│   │       └── login.py      # Contains: httpx.get("http://user-service/api/users/{id}")
│   └── pyproject.toml
└── user-service/
    ├── src/
    │   └── controllers/
    │       └── user_controller.py  # Contains: @router.get("/api/users/{user_id}")
    └── pyproject.toml
```

### 10. No Logging/Observability Spec

**Problem:** Debugging vibe code requires good logs. No logging strategy defined.

**Fix:** Add structured logging pattern:

```python
import structlog

log = structlog.get_logger()

def extract(self, source: bytes) -> list[ServiceCall]:
    log.debug("extracting_calls", source_len=len(source), language=self.language)
    calls = self._do_extract(source)
    log.info("extracted_calls", count=len(calls),
             high_conf=sum(1 for c in calls if c.confidence >= 0.9))
    return calls
```

### 11. No Version/Migration Story

**Problem:** What happens when schema changes? No versioning for:
- RouteRegistry SQLite schema
- LanceDB vector schema
- Graphiti entity types

**Fix:** Add version tracking:

```python
# rag/config.py
SCHEMA_VERSION = "1.0.0"

# In SQLite registry init:
def _init_db(self):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS _metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.execute(
        "INSERT OR REPLACE INTO _metadata VALUES ('schema_version', ?)",
        (SCHEMA_VERSION,)
    )
```

---

## Milestone Clarity

### Current State (Good)

The phasing is well-structured with:
- Line count estimates
- Checkpoint markers
- Quick checks
- Acceptance tests

### Improvements for Vibe Coding

**Add "Done" definition per phase:**

```markdown
### Phase 4a: Python Call Extraction

**You Are Done When:**
1. Quick check passes: `python -m rag.extractors --checkpoint python_http`
2. All 10 acceptance tests pass: `pytest tests/test_phase4a_python.py`
3. Can run on `rag/` directory with 0 false positives
4. Git commit created with passing tests

**You Are NOT Done If:**
- Any acceptance test fails
- Quick check errors
- You "plan to fix it later"
```

**Add dependency warnings:**

```markdown
### Phase 4e: Call Linker

**REQUIRES:** Phase 4c (Route Registry) must be complete
**REQUIRES:** Phase 4a (Python Extraction) must be complete

**If 4c tests are failing:** DO NOT START 4e. Fix registry first.
```

---

## Recommended Changes Summary

### Must Fix (Blocks one-shot coding):

| Issue | Location | Fix |
|-------|----------|-----|
| Edge case tables | All pattern matchers | Add explicit I/O tables |
| Confidence threshold semantics | `config.py` | Document `>=` vs `>` |
| Asset return types | All Dagster assets | Add typed dataclasses |
| Fixture structure | `fixtures/` | Create actual fixture files |

### Should Fix (Reduces debugging):

| Issue | Location | Fix |
|-------|----------|-----|
| Mock parity gaps | `MockGraphStore` | Document divergences |
| Retry policy | `config.py` | Add `RetryPolicy` class |
| Route collision | `registry.py` | Document priority rules |
| Chunk ID semantics | `types.py` | Document dedup strategy |

### Nice to Have:

| Issue | Location | Fix |
|-------|----------|-----|
| Structured logging | All modules | Add structlog pattern |
| Schema versioning | Storage modules | Add version tracking |
| Done definitions | `PHASING_STRATEGY.md` | Add per-phase checklist |

---

## Control Flow Verification

### Ingestion Flow - Verified Clear

```
CrawlSource → Crawler → Chunker → Scrubber → Embedder → VectorStore
                                      ↓
                                 GraphStore
```

**No ambiguity** - each arrow is one function call, one return type.

### Retrieval Flow - One Ambiguity

```
Query → Embedder → VectorStore.search()
    ↓               ↓
GraphStore.search() → get_neighbors() → ???
                                         ↓
                                    Merge → Rerank → Results
```

**Ambiguity:** How do graph results become chunk results? The doc says:

```python
# 4. Fetch chunks for expanded entities
related_chunks = await lance_store.search_by_metadata(
    filters={"service_name": [e.name for e in related]}
)
```

But `search_by_metadata` isn't defined in `VectorStore` protocol. It uses `search()` with filters.

**Fix:** Clarify in protocol:

```python
async def search(
    self,
    query_vector: list[float],
    *,
    limit: int = 10,
    filters: dict[str, Any] | None = None,  # {"field": value} or {"field": [values]}
) -> list[SearchResult]:
    """
    Filter Semantics:
        - Single value: exact match (field == value)
        - List value: any match (field IN values)
        - Multiple filters: AND (all must match)
    """
```

### Route Linking Flow - Verified Clear

```
raw_code_files
      ↓
route_registry (extract routes from ALL services)
      ↓
service_relations (extract calls, link using registry)
      ↓
knowledge_graph
```

**No ambiguity** - Dagster enforces order via dependencies.

---

## Final Verdict

**Ready for vibe coding?** Almost.

**Estimated prep work:** 2-3 hours to:
1. Add edge case tables to pattern matchers
2. Create fixture files
3. Add typed outputs to all assets
4. Document confidence threshold semantics

**After prep:** Should be one-shot for each phase with the checkpoint system.

**Biggest remaining risk:** MockGraphStore parity with production Graphiti. Plan to spend 1-2 hours validating when Neo4j is available.
