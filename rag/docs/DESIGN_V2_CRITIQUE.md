# RAG v2 Design Critique

**Goal:** Identify issues that would cause vibe-coding failures. Each issue has a severity and a fix.

## Executive Summary

The design is **75% vibe-codeable**. The phasing strategy is strong but has critical gaps:

| Category | Score | Blockers |
|----------|-------|----------|
| Interface Clarity | B+ | Missing error handling contracts |
| Control Flow | A- | Graph ingestion timing unclear |
| Testability | B | Mock-to-real transition gaps |
| Milestone Completeness | B- | Acceptance criteria too vague |
| Phone-Coding Readiness | B | Too many small files in early design |

**Top 3 Fixes Required:**
1. Add explicit error contracts to all Protocol methods
2. Define MockGraphStore → GraphitiStore parity tests
3. Add concrete acceptance criteria per phase (not just smoke tests)

---

## Critical Issues (Must Fix)

### C1: Protocol Methods Lack Error Contracts

**Location:** `PHASING_STRATEGY.md` lines 1186-1344 (VectorStore, GraphStore protocols)

**Problem:** Protocols define what methods return on success, but error handling is incomplete:

```python
async def insert(self, chunk: EmbeddedChunk) -> None:
    """Insert chunk. Idempotent on chunk.id.

    Raises:
        StorageError: Storage backend unavailable or full
        DimensionMismatchError: Vector dimension != store's configured dimension
        DuplicateChunkError: Same ID exists with different content hash
    """
```

**Ambiguity:**
- What happens on **partial network failure** mid-batch in `insert_batch`?
- Does `DuplicateChunkError` include the conflicting chunk data?
- Is `StorageError` retryable? After how long?

**Fix:**
```python
class StorageError(RAGError):
    """Storage operation failed."""
    operation: str
    reason: str
    retryable: bool  # ADD THIS
    retry_after_seconds: int | None = None  # ADD THIS

async def insert_batch(self, chunks: list[EmbeddedChunk]) -> BatchResult:
    """Batch insert.

    Returns:
        BatchResult with:
            - inserted_count: int
            - failed_chunks: list[tuple[ChunkID, RAGError]]  # SPECIFIC FAILURES
            - partial_success: bool  # True if some succeeded
    """
```

**Severity:** HIGH - Without this, error recovery during vibe coding becomes guesswork.

---

### C2: MockGraphStore → GraphitiStore Parity Gap

**Location:** `PHASING_STRATEGY.md` lines 1946-2058 (MockGraphStore)

**Problem:** The MockGraphStore uses **regex-based entity extraction**:

```python
async def add_episode(self, text: str, ...) -> list[Entity]:
    """Mock: extract entities using simple regex patterns."""
    service_pattern = r'\b(\w+-service|\w+-api)\b'
```

But GraphitiStore uses **LLM-based extraction**. There's no parity test defined.

**What Will Fail:**
- Code that works with MockGraphStore will break with real Graphiti because entity detection differs
- "auth service" (space) won't match mock's `\w+-service` pattern
- Graphiti extracts relationships MockGraphStore ignores

**Fix:** Add a parity test suite:

```python
# tests/test_graph_store_parity.py

PARITY_TEST_CASES = [
    # (input_text, expected_entity_types, expected_min_count)
    ("The auth-service calls user-service", [EntityType.SERVICE], 2),
    ("John from platform team owns billing-api", [EntityType.SERVICE, EntityType.PERSON], 2),
    ("Payment outage on 2024-01-15 affected checkout", [EntityType.INCIDENT, EntityType.SERVICE], 1),
]

@pytest.mark.parametrize("text,expected_types,min_count", PARITY_TEST_CASES)
async def test_mock_parity(text, expected_types, min_count):
    """MockGraphStore MUST pass these for parity with Graphiti."""
    mock = MockGraphStore()
    entities = await mock.add_episode(text, source="test")

    assert len(entities) >= min_count, f"Expected >= {min_count} entities"
    for etype in expected_types:
        assert any(e.type == etype for e in entities), f"Missing {etype}"
```

**Also:** MockGraphStore needs upgrade from simple regex:

```python
# Improved mock patterns
PATTERNS = {
    EntityType.SERVICE: r'\b(\w+[-_]?(?:service|api|svc))\b',
    EntityType.PERSON: r'\b([A-Z][a-z]+ (?:from |on )?(?:team|platform)?)\b',
    EntityType.INCIDENT: r'\b(outage|incident|failure|issue)\b',
}
```

**Severity:** HIGH - Mock-to-production switch will fail without this.

---

### C3: Phase 4 Acceptance Criteria Are Smoke Tests, Not Acceptance Tests

**Location:** `PHASING_STRATEGY.md` lines 2624-2782

**Problem:** Smoke tests verify "it runs" not "it works correctly":

```bash
# This is the Phase 4a smoke test:
python -c "
calls = extractor.extract_from_file('test.py', code)
assert len(calls) == 1, 'Should find one HTTP call'
"
```

**What's Missing:**
- Edge cases that will fail during real use
- Confidence level verification
- Multi-call-per-file handling
- Variable URL extraction

**Fix:** Add real acceptance tests per phase:

```python
# Phase 4a Acceptance Tests (ALL must pass)

def test_extracts_direct_url():
    """HIGH confidence: literal URL string."""
    code = b'requests.get("http://user-service/api/users")'
    calls = extract(code)
    assert calls[0].confidence >= 0.9
    assert calls[0].target_service == "user-service"
    assert calls[0].url_path == "/api/users"

def test_extracts_fstring_url():
    """MEDIUM confidence: f-string with variable."""
    code = b'requests.get(f"http://{SERVICE}/api/users")'
    calls = extract(code)
    assert 0.5 <= calls[0].confidence < 0.9

def test_extracts_multiple_calls():
    """Multiple calls in one file."""
    code = b'''
    requests.get("http://user-service/users")
    requests.post("http://billing-api/charge")
    '''
    calls = extract(code)
    assert len(calls) == 2
    assert {c.target_service for c in calls} == {"user-service", "billing-api"}

def test_ignores_non_http_strings():
    """Must NOT match docstrings or comments."""
    code = b'''
    """
    Example: http://user-service/api
    """
    # TODO: call http://billing-api later
    '''
    calls = extract(code)
    assert len(calls) == 0

def test_handles_aiohttp_context_manager():
    """Async context manager pattern."""
    code = b'''
    async with aiohttp.ClientSession() as session:
        await session.get("http://user-service/api")
    '''
    calls = extract(code)
    assert len(calls) == 1
```

**Severity:** HIGH - Without these, you'll "pass" Phase 4a but fail on real code.

---

## High Issues (Should Fix)

### H1: Route Registry Path Matching Is Naive

**Location:** `PHASING_STRATEGY.md` lines 778-782

**Problem:**
```python
def _path_matches(self, pattern: str, request_path: str) -> bool:
    regex = re.sub(r'\{[^}]+\}', r'[^/]+', pattern)
    return re.match(f"^{regex}$", request_path) is not None
```

**What Fails:**
- `/api/users/123/orders` does NOT match `/api/users/{id}` (trailing path)
- `/api/users/` (trailing slash) does NOT match `/api/users/{id}`
- Query params: `/api/users/123?include=orders` fails

**Fix:**
```python
def _path_matches(self, pattern: str, request_path: str) -> bool:
    # Strip query params and trailing slash
    path = request_path.split("?")[0].rstrip("/")
    pattern = pattern.rstrip("/")

    # Allow optional trailing path segments
    regex = re.sub(r'\{[^}]+\}', r'[^/]+', pattern)
    return re.match(f"^{regex}(?:/.*)?$", path) is not None
```

---

### H2: CallLinker Returns `<unknown>` Instead of Structured Miss

**Location:** `PHASING_STRATEGY.md` lines 556-566

**Problem:**
```python
# No match found - still record the call but without target file
return ServiceRelation(
    target_file=f"{call.target_service}/<unknown>",
    target_function="<unknown>",
)
```

Returning string `"<unknown>"` mixes data types and makes analysis harder.

**Fix:**
```python
@dataclass
class LinkResult:
    relation: ServiceRelation | None
    unlinked_call: ServiceCall | None  # Original call if no match
    miss_reason: Literal["no_routes", "method_mismatch", "path_mismatch"] | None

def link(self, call: ServiceCall) -> LinkResult:
    routes = self._routes.get(call.target_service)
    if not routes:
        return LinkResult(None, call, "no_routes")
    # ... matching logic ...
    return LinkResult(None, call, "path_mismatch")
```

---

### H3: Dagster Asset Type Safety Is Weak

**Location:** `PHASING_STRATEGY.md` lines 928-1044

**Problem:** Assets pass `Output` dataclasses but:

```python
@asset
def service_relations(
    raw_code_files: RawCodeFilesOutput,
    route_registry: RouteRegistryOutput,  # This is a dataclass, not the actual registry
) -> ServiceRelationsOutput:
    registry = route_registry.load()  # Manual deserialization
```

The `load()` pattern is error-prone:
- File might not exist
- Schema might have changed
- No validation that `db_path` is still valid

**Fix:** Use Dagster's I/O managers or add explicit validation:

```python
@dataclass
class RouteRegistryOutput:
    db_path: str
    schema_version: int  # ADD VERSION

    def load(self) -> SQLiteRegistry:
        if not Path(self.db_path).exists():
            raise AssetMaterializationError(f"Registry DB missing: {self.db_path}")
        registry = SQLiteRegistry(self.db_path)
        if registry.schema_version != self.schema_version:
            raise AssetMaterializationError("Schema version mismatch - rerun route_registry asset")
        return registry
```

---

### H4: No Rollback Story for Failed Ingestion

**Location:** DESIGN_V2.md, PHASING_STRATEGY.md (missing)

**Problem:** If ingestion fails midway:
- LanceDB has partial data
- RouteRegistry has partial routes
- Graphiti has partial entities

No cleanup or rollback mechanism defined.

**Fix:** Add transaction semantics:

```python
@asset
def route_registry(raw_code_files: RawCodeFilesOutput) -> RouteRegistryOutput:
    db_path = "./data/routes.db"
    temp_path = f"./data/routes.{uuid4().hex}.db"  # Write to temp

    try:
        registry = SQLiteRegistry(temp_path)
        # ... extraction ...

        # Atomic swap on success
        if Path(db_path).exists():
            Path(db_path).unlink()
        Path(temp_path).rename(db_path)

    except Exception:
        # Cleanup temp on failure
        Path(temp_path).unlink(missing_ok=True)
        raise
```

---

## Medium Issues (Nice to Fix)

### M1: Confidence Thresholds Not Defined

**Location:** `PHASING_STRATEGY.md` lines 110-122

Confidence levels defined but **usage thresholds** missing:

```python
class Confidence:
    HIGH = 0.9
    MEDIUM = 0.7
    LOW = 0.5
    GUESS = 0.3
```

**Questions:**
- What confidence threshold for graph edges?
- Should LOW confidence calls be stored differently?
- Do we show GUESS results to users?

**Fix:** Add threshold config:

```python
@dataclass
class ExtractionConfig:
    min_confidence_for_graph: float = 0.5  # Don't add GUESS to graph
    min_confidence_for_linking: float = 0.7  # Need MEDIUM+ for call linking
    show_low_confidence_results: bool = False  # Hide LOW/GUESS from users
```

---

### M2: Incremental Update Strategy Is Post-Hoc

**Location:** `PHASING_STRATEGY.md` lines 2786-2893

The incremental strategy is added as an afterthought. This causes issues:

- `Manifest` type not in core types
- `changed_files` asset not in main dependency graph
- No guidance on when to use incremental vs full

**Fix:** Either:
1. Move incremental to Post-MVP Track B (explicit)
2. Or integrate into Phase 7 with clear asset variants

---

### M3: Embedding Model Mismatch Risk

**Location:** DESIGN_V2.md line 65, PHASING_STRATEGY.md line 1536, 1910

Three different model references:
- `CodeRankEmbed` (DESIGN_V2)
- `jinaai/jina-embeddings-v3` (PHASING_STRATEGY TokenCounter)
- `jinaai/jina-embeddings-v3` (PHASING_STRATEGY Embedder)

**Risk:** If someone changes one and not the other, dimensions mismatch.

**Fix:** Single source of truth:

```python
# rag/config.py
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"
EMBEDDING_DIM = 768

# All usages import from here
from rag.config import EMBEDDING_MODEL, EMBEDDING_DIM
```

---

### M4: Graph Traversal Direction Semantics Unclear

**Location:** `PHASING_STRATEGY.md` lines 2000-2031

```python
async def get_neighbors(
    self,
    entity_id: EntityID,
    direction: Literal["in", "out", "both"] = "both",
)
```

For relationship `(A) --CALLS--> (B)`:
- `get_neighbors(A, direction="out")` returns B?
- `get_neighbors(B, direction="in")` returns A?

**Needs clarification in docstring:**

```python
"""
Direction semantics for edge (source)--[rel]->(target):
- "out": Return targets where entity is the source
- "in": Return sources where entity is the target
- "both": Return both directions

Example for A --CALLS--> B:
    get_neighbors(A, "out") → [B]  # A calls B
    get_neighbors(B, "in") → [A]   # B is called by A
"""
```

---

## Low Issues (Optional)

### L1: Test Fixture Strategy Missing

No guidance on creating test fixtures for:
- Multi-repo scenarios
- Cross-service call chains
- Real-world directory structures

**Suggestion:** Add `fixtures/` section to phasing doc with concrete examples.

---

### L2: Logging/Observability Not Addressed

No mention of:
- Structured logging format
- Dagster observability integration
- Metrics (chunks/sec, extraction accuracy)

**Suggestion:** Add to Phase 1 as lightweight logging setup.

---

### L3: Environment Variable Handling

GraphitiStore requires:
```python
neo4j_uri=os.environ["NEO4J_URI"],
neo4j_user=os.environ["NEO4J_USER"],
neo4j_password=os.environ["NEO4J_PASSWORD"],
```

No `.env.example` or validation.

**Fix:** Add config validation in factory:

```python
def create_graph_store(config: Config) -> GraphStore:
    if not config.use_mock_graph:
        required = ["NEO4J_URI", "NEO4J_USER", "NEO4J_PASSWORD"]
        missing = [k for k in required if k not in os.environ]
        if missing:
            raise ConfigError(f"Missing env vars for Graphiti: {missing}")
```

---

## Phone Vibe-Coding Optimizations

### P1: Consolidate Files Earlier

The phasing doc shows final file structure with many small files. For phone coding, the "consolidated" structure should be **default**, not alternative:

```
rag/
├── types.py        # ALL types (do first)
├── extractors.py   # ALL extraction (Phase 4)
├── stores.py       # ALL stores (Phase 3-4)
├── retrieval.py    # Phase 5
├── pipeline.py     # Phase 6-7
└── tests/
    └── test_all.py
```

**Only split after MVP works.**

---

### P2: Add Copy-Paste Checkpoint Markers

The current checkpoint markers are comments:
```python
# === CHECKPOINT: Python HTTP extraction complete ===
```

**Improvement:** Make them executable:

```python
# === CHECKPOINT: Python HTTP extraction ===
if __name__ == "__main__":
    # Quick verification you can run
    code = b'requests.get("http://user-service/api/users")'
    calls = PythonExtractor().extract(code)
    assert len(calls) == 1, f"Expected 1, got {len(calls)}"
    print("CHECKPOINT PASSED: Python HTTP extraction")
```

Now you can verify each checkpoint by running the file.

---

### P3: Add "Stuck?" Recovery Hints

When vibe coding fails, add recovery hints:

```python
class HttpCallPattern:
    """
    STUCK? Debug checklist:
    1. Print node.type - is it 'call' or 'call_expression'?
    2. Print source[node.start_byte:node.end_byte] - actual text
    3. Check tree-sitter playground: https://tree-sitter.github.io/tree-sitter/playground
    4. Common issue: method calls are nested (obj.method vs method)
    """
```

---

## Milestone Deliverable Checklist

Each phase needs explicit "done" criteria. Current state vs. recommended:

### Phase 4a: Python Call Extraction

**Current:** "Unit test with Python fixtures"

**Recommended:**
```
DONE when ALL pass:
[ ] test_extracts_requests_get_literal_url
[ ] test_extracts_requests_post_with_json
[ ] test_extracts_httpx_async
[ ] test_extracts_aiohttp_session
[ ] test_ignores_urllib_parse
[ ] test_ignores_docstring_urls
[ ] test_confidence_levels_correct
[ ] Smoke test runs without error
[ ] Can process rag/ directory and find 0 false positives
```

### Phase 4e: Call Linker

**Current:** "End-to-end linking test"

**Recommended:**
```
DONE when ALL pass:
[ ] test_links_exact_path_match
[ ] test_links_parameterized_path
[ ] test_returns_unlinked_when_no_routes
[ ] test_method_mismatch_returns_unlinked
[ ] test_links_multiple_calls_same_file
[ ] Integration: auth-service → user-service fixture works
[ ] Linked count > 0 on real codebase
```

### Phase 7: Hybrid Retriever

**Current:** Acceptance test exists but no checklist

**Recommended:**
```
DONE when ALL pass:
[ ] test_vector_only_returns_results
[ ] test_graph_expansion_finds_related
[ ] test_reranker_deduplicates
[ ] test_empty_query_returns_empty
[ ] test_filter_by_corpus_type
[ ] Acceptance test: auth + user-service cross-reference
[ ] Can query "authentication" and get auth-service code
[ ] Can query "user service owner" and get Person entities
```

---

## Summary: Required Changes

| Issue | File | Line | Fix Summary |
|-------|------|------|-------------|
| C1 | PHASING_STRATEGY.md | 1186-1344 | Add error contracts with retryable flag |
| C2 | PHASING_STRATEGY.md | 1946-2058 | Add MockGraphStore parity tests |
| C3 | PHASING_STRATEGY.md | 2624-2782 | Replace smoke tests with acceptance tests |
| H1 | PHASING_STRATEGY.md | 778-782 | Fix path matching edge cases |
| H2 | PHASING_STRATEGY.md | 556-566 | Return structured LinkResult |
| H3 | PHASING_STRATEGY.md | 928-1044 | Add schema versioning to assets |
| H4 | Both | Missing | Add rollback/cleanup on failure |

**Estimated additional work:** 2-3 hours to update docs with these fixes.

**After fixes:** Design is 90%+ vibe-codeable with high confidence.
