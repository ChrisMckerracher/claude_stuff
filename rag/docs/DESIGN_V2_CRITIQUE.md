# RAG v2 Design Critique

## Executive Summary

The design is **75% phone-vibe-ready**. Strong foundations, but several gaps that will cause debugging pain mid-implementation. Key issues:

1. **Missing error contracts** - protocols say what to return, not when to throw
2. **Ambiguous "confidence" scoring** - no defined scale or usage
3. **Dagster asset return types inconsistent** - some return paths, some return data
4. **ServiceCall missing fields** - `method` and `url_path` used in linker but not defined
5. **No retry/idempotency strategy** - what happens on partial failures?

**Verdict:** 3-4 hours of spec work saves 10+ hours of debugging.

---

## 1. Ambiguity Issues

### 1.1 ServiceCall Missing Fields (CRITICAL)

**Location:** `PHASING_STRATEGY.md:101-107` vs `PHASING_STRATEGY.md:393-403`

```python
# Defined in base.py:
@dataclass
class ServiceCall:
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float

# But linker.py uses:
if call.method and call.method != route.method:  # ← method not defined!
    return False
return re.match(f"^{pattern}$", call.url_path)    # ← url_path not defined!
```

**Fix:** Add missing fields to ServiceCall:

```python
@dataclass
class ServiceCall:
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float
    # ADD THESE:
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] | None = None
    url_path: str | None = None  # /api/users/{id}
    target_host: str | None = None  # For resolving service name
```

### 1.2 Confidence Score Undefined (MEDIUM)

**Location:** `PHASING_STRATEGY.md:107`

`confidence: float  # 0.0-1.0, based on pattern certainty`

**Problems:**
- What makes something 0.5 vs 0.8?
- How is it used downstream? (Not referenced anywhere)
- Should low-confidence calls be filtered?

**Fix:** Define confidence tiers:

```python
class Confidence(Enum):
    """Confidence levels for extracted relationships."""
    HIGH = 0.9    # Exact URL match: requests.get("http://user-service/api/users")
    MEDIUM = 0.7  # Service name in URL: requests.get(f"{USER_SERVICE_URL}/users")
    LOW = 0.5     # Inferred from variable: requests.get(service_url)
    GUESS = 0.3   # Heuristic match: requests.get(url)  # comment says "user service"

# Usage in linker:
MIN_LINK_CONFIDENCE = Confidence.MEDIUM.value
```

### 1.3 Dagster Asset Return Types Inconsistent (MEDIUM)

**Location:** `PHASING_STRATEGY.md:712-778`

```python
# route_registry returns a path string:
def route_registry(...) -> str:  # DB path
    return db_path

# service_relations returns actual data:
def service_relations(...) -> list[ServiceRelation]:
    return relations
```

**Problem:** Mixing path strings and data types breaks Dagster's type checking and makes testing harder.

**Fix:** Standardize on asset outputs:

```python
@dataclass
class RouteRegistryOutput:
    """Output of route_registry asset."""
    db_path: str
    service_count: int
    route_count: int

@asset
def route_registry(...) -> RouteRegistryOutput:
    ...
    return RouteRegistryOutput(
        db_path=db_path,
        service_count=len(raw_code_files),
        route_count=sum(len(r) for r in routes_by_service.values()),
    )
```

### 1.4 "Episode" Terminology Confusion (LOW)

**Location:** Multiple places

Graphiti uses "episode" for text ingestion, but the design uses it inconsistently:
- Sometimes for individual chunks
- Sometimes for extracted relationships
- Sometimes for entire files

**Fix:** Define when to call `add_episode`:

```python
# RULE: One episode = one semantic unit
# - For code: one relationship fact (e.g., "auth-service calls user-service")
# - For conversations: one complete thread
# - For docs: one section

# NOT: raw chunk text → this creates noise in entity extraction
```

---

## 2. Interface Gaps

### 2.1 No Error Handling Contracts

**Location:** All Protocol definitions in `PHASING_STRATEGY.md:906-1035`

**Problem:** Protocols define happy-path signatures but not failure modes.

```python
class VectorStore(Protocol):
    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id."""
        ...
```

**Questions unanswered:**
- What if storage is full?
- What if embedding dimension mismatches?
- What if duplicate ID with different content?

**Fix:** Add error specifications:

```python
class VectorStore(Protocol):
    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id.

        Raises:
            StorageError: Storage backend unavailable or full
            DimensionMismatch: Vector dimension != store's configured dimension
            DuplicateContent: Same ID exists with different content hash

        Idempotency:
            - Same ID + same content hash → no-op, returns None
            - Same ID + different content hash → raises DuplicateContent
        """
        ...
```

### 2.2 RouteRegistry.find_route Path Matching Ambiguity

**Location:** `PHASING_STRATEGY.md:515-527`

```python
def find_route(
    self,
    service: str,
    method: str,
    path: str  # Is this the PATTERN or the ACTUAL path?
) -> RouteDefinition | None:
```

**Problem:** Unclear if `path` is:
- The route pattern (`/api/users/{user_id}`)
- The actual request path (`/api/users/123`)

The docstring says "Path matching handles parameterized routes" but the signature doesn't clarify which input format to use.

**Fix:** Rename for clarity:

```python
def find_route_by_request(
    self,
    service: str,
    method: str,
    request_path: str,  # Actual path: /api/users/123
) -> RouteDefinition | None:
    """Find route that matches this request.

    Args:
        service: Target service name
        method: HTTP method (GET, POST, etc.)
        request_path: Actual request path (e.g., /api/users/123)

    Returns:
        RouteDefinition if matched, None otherwise

    Matching rules:
        - /api/users/123 matches /api/users/{user_id}
        - /api/orders/456/items matches /api/orders/{id}/items
        - Exact matches take priority over parameterized
    """
```

### 2.3 Scrubber Protocol Missing Batch Error Handling

**Location:** `PHASING_STRATEGY.md:1000-1010`

```python
class Scrubber(Protocol):
    def scrub_batch(self, chunks: list[RawChunk]) -> list[CleanChunk]:
        """Batch scrubbing for efficiency."""
        ...
```

**Problem:** What if one chunk fails? Does the whole batch fail? Are successful chunks returned?

**Fix:**

```python
@dataclass
class ScrubResult:
    """Result of scrubbing, whether successful or not."""
    chunk_id: ChunkID
    clean_chunk: CleanChunk | None  # None if failed
    error: ScrubError | None  # None if successful

class Scrubber(Protocol):
    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing. Never raises - errors in individual results.

        Returns results in same order as input chunks.
        Check result.error for failures.
        """
        ...
```

---

## 3. Control Flow Issues

### 3.1 Route Extraction → Call Linking Order Not Enforced in Code

**Location:** `PHASING_STRATEGY.md:666-697`

The Dagster dependency graph is correct, but the asset code doesn't enforce it:

```python
@asset
def service_relations(
    raw_code_files: dict[str, list[Path]],
    route_registry: str  # Just a string - nothing prevents passing wrong path
) -> list[ServiceRelation]:
```

**Problem:** If someone runs `service_relations` directly with wrong DB path, silent failures.

**Fix:** Type-safe asset dependencies:

```python
@dataclass
class RouteRegistryAsset:
    """Typed wrapper for route_registry output."""
    db_path: str

    def load(self) -> SQLiteRegistry:
        """Load the registry. Raises if DB doesn't exist or is corrupted."""
        if not Path(self.db_path).exists():
            raise AssetNotMaterialized("route_registry must run first")
        return SQLiteRegistry(self.db_path)

@asset
def service_relations(
    raw_code_files: dict[str, list[Path]],
    route_registry: RouteRegistryAsset,  # Type-safe
) -> list[ServiceRelation]:
    registry = route_registry.load()  # Fails fast if not ready
    ...
```

### 3.2 Graph Ingestion Async/Sync Mismatch

**Location:** `PHASING_STRATEGY.md:781-816`

```python
@asset
def knowledge_graph(service_relations: list[ServiceRelation]) -> str:
    """Write service relations to Graphiti."""
    graph = GraphitiStore(...)

    for rel in service_relations:
        source_entity = await graph.add_entity(...)  # ← await in non-async function!
```

**Problem:** The asset function is sync but calls async methods.

**Fix:** Either make asset async or use sync wrappers:

```python
# Option 1: Async asset (Dagster supports this)
@asset
async def knowledge_graph(service_relations: list[ServiceRelation]) -> str:
    async with GraphitiStore(...) as graph:
        for rel in service_relations:
            await graph.add_entity(...)

# Option 2: Sync wrapper
@asset
def knowledge_graph(service_relations: list[ServiceRelation]) -> str:
    async def _ingest():
        graph = GraphitiStore(...)
        for rel in service_relations:
            await graph.add_entity(...)

    asyncio.run(_ingest())
```

### 3.3 Missing Incremental Update Strategy

**Location:** Entire design

**Problem:** The design assumes full reindex every time. No discussion of:
- What happens when one file changes?
- How to detect changed files?
- How to update graph without full rebuild?

**This will bite you when the pipeline takes 30+ minutes on real data.**

**Fix:** Add incremental update section:

```python
@dataclass
class FileChange:
    path: str
    change_type: Literal["added", "modified", "deleted"]
    old_hash: str | None
    new_hash: str | None

@asset
def changed_files(raw_code_files: dict, previous_manifest: Manifest) -> list[FileChange]:
    """Detect files that changed since last run."""
    ...

@asset
def incremental_chunks(changed_files: list[FileChange], code_chunks: ...) -> ...:
    """Only re-chunk changed files."""
    for change in changed_files:
        if change.change_type == "deleted":
            yield DeleteChunk(change.path)
        else:
            yield from chunk_file(change.path)
```

---

## 4. Testability Gaps

### 4.1 Pattern Matchers Have No Test Contracts

**Location:** `PHASING_STRATEGY.md:122-161`

```python
class HttpCallPattern(PatternMatcher):
    """Matches HTTP client calls across languages."""

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~20 lines: check node type, extract URL, infer service name
        ...
```

**Problem:** No examples of what should match. When you implement this, you'll guess and get it wrong.

**Fix:** Add test vectors to docstrings:

```python
class HttpCallPattern(PatternMatcher):
    """Matches HTTP client calls across languages.

    Test vectors (MUST all match):

    Python:
        requests.get("http://user-service/api/users")
        → ServiceCall(target="user-service", method="GET", path="/api/users")

        httpx.post(f"http://{SERVICE}/users", json=data)
        → ServiceCall(target=SERVICE, method="POST", path="/users", confidence=0.7)

        async with aiohttp.ClientSession() as s:
            await s.get(url)
        → ServiceCall(target=<from_url>, confidence=0.5)

    Go:
        http.Get("http://user-service/api/users")
        resp, _ := client.Do(req)  // where req has URL set
        → ServiceCall(...)

    Must NOT match:
        requests.get(local_file_path)  # No http://
        urllib.parse.urlparse(...)     # Parsing, not calling
    """
```

### 4.2 MockGraphStore Doesn't Test Entity Extraction

**Location:** `PHASING_STRATEGY.md:1647-1665`

```python
async def add_episode(self, text: str, ...) -> list[Entity]:
    """Mock: extract entities using simple regex patterns."""
    # Simple service detection (mock)
    service_pattern = r'\b(\w+-service|\w+-api)\b'
```

**Problem:** The mock extracts entities differently than Graphiti (LLM-based). Tests will pass with mock but fail with real Graphiti.

**Fix:** Create test fixtures that work with both:

```python
# test_fixtures.py
EPISODE_TEST_CASES = [
    # (input_text, expected_entities, expected_relationships)
    (
        "The auth-service calls user-service for login validation.",
        [("auth-service", EntityType.SERVICE), ("user-service", EntityType.SERVICE)],
        [(("auth-service", "user-service"), RelationType.CALLS)],
    ),
    (
        "Alice from platform-team owns the payment-api.",
        [("Alice", EntityType.PERSON), ("platform-team", EntityType.TEAM), ("payment-api", EntityType.SERVICE)],
        [(("Alice", "payment-api"), RelationType.OWNS)],
    ),
]

# Mock must pass these. Real Graphiti must also pass these.
@pytest.mark.parametrize("text,expected_entities,expected_rels", EPISODE_TEST_CASES)
async def test_episode_extraction(graph_store, text, expected_entities, expected_rels):
    entities = await graph_store.add_episode(text, source="test")
    # Verify expected entities found (may have extras - that's ok)
    for name, etype in expected_entities:
        assert any(e.name == name and e.type == etype for e in entities)
```

### 4.3 No Integration Test Boundary

**Location:** Entire design

**Problem:** Unclear what can be tested offline vs needs Neo4j/LLM.

**Fix:** Add test tier annotations:

```python
# conftest.py
import pytest

# Tier 1: Pure unit tests - no I/O
@pytest.fixture
def unit_test():
    """Marker for tests that need no external dependencies."""
    pass

# Tier 2: Local integration - file system, SQLite
@pytest.fixture
def local_test(tmp_path):
    """Marker for tests that use local resources only."""
    return tmp_path

# Tier 3: External integration - Neo4j, LLM APIs
@pytest.fixture
def integration_test():
    """Marker for tests requiring external services.

    Skip in CI unless INTEGRATION_TESTS=1
    """
    if not os.environ.get("INTEGRATION_TESTS"):
        pytest.skip("Set INTEGRATION_TESTS=1 to run")
```

---

## 5. Milestone Deliverable Gaps

### 5.1 Phase 4 is Too Big

**Location:** `PHASING_STRATEGY.md:59`

```
Phase 4: Service Extractor + Route Linker | ~750 lines
```

**Problem:** 750 lines is 3-4 hours of vibe coding. If something breaks at line 600, you've lost context.

**Fix:** Split Phase 4:

```
Phase 4a: Service Call Extraction (~360 lines)
  - base.py, patterns.py, extractor.py
  - languages/python.py only (most common)
  - Deliverable: Extract calls from Python files
  - Test: Unit tests with fixture Python files

Phase 4b: Multi-language Support (~150 lines)
  - languages/go.py, typescript.py, csharp.py
  - Deliverable: Extract calls from all languages
  - Test: One fixture file per language

Phase 4c: Route Extraction (~80 lines)
  - routes.py + one framework (FastAPI)
  - Deliverable: Extract routes from FastAPI apps
  - Test: Fixture FastAPI app

Phase 4d: Route Registry + Linking (~160 lines)
  - registry.py, sqlite_registry.py, linker.py
  - Deliverable: Full call → handler linking
  - Test: End-to-end with two mock services
```

### 5.2 No Smoke Test Per Phase

**Location:** Phase verification checklists

**Problem:** Checklists are detailed but don't have a single "it works" command.

**Fix:** Add smoke test command per phase:

```markdown
### Phase 2 Smoke Test

```bash
# One command to verify phase works
python -c "
from rag.crawlers.code import CodeCrawler
from rag.extractors.extractor import ServiceExtractor

crawler = CodeCrawler()
extractor = ServiceExtractor()

# Should find calls in this repo
for result in crawler.crawl(CrawlSource(type='directory', path='.')):
    calls = extractor.extract_from_file(result.source_uri, result.content)
    if calls:
        print(f'{result.source_uri}: {len(calls)} calls')
        break
else:
    raise AssertionError('No service calls found - check patterns')
"
```

### 5.3 Missing "Done" Criteria

**Location:** Phase Overview tables

```
| 7 | Hybrid Retriever | ~100 lines | End-to-end test |
```

**Problem:** "End-to-end test" is vague. What query? What expected result?

**Fix:** Concrete acceptance tests:

```markdown
### Phase 7 Acceptance Test

```python
async def test_hybrid_retrieval_finds_related_code():
    """MUST PASS for Phase 7 to be complete."""
    # Setup: index two related services
    await ingest("fixtures/auth-service/")  # calls user-service
    await ingest("fixtures/user-service/")  # has /api/users endpoint

    # Query about auth
    results = await retriever.search("user authentication")

    # MUST find both services
    files = {r.chunk.source_uri for r in results}
    assert any("auth-service" in f for f in files), "Should find auth code"
    assert any("user-service" in f for f in files), "Should find related user code via graph"

    # MUST rank auth higher (direct match)
    auth_rank = next(i for i, r in enumerate(results) if "auth" in r.chunk.source_uri)
    user_rank = next(i for i, r in enumerate(results) if "user" in r.chunk.source_uri)
    assert auth_rank < user_rank, "Direct match should rank higher than graph expansion"
```

---

## 6. Phone-Vibe-Coding Specific Issues

### 6.1 Too Many Files to Create

**Current structure requires creating 20+ files:**
```
rag/
├── core/
│   ├── types.py
│   ├── protocols.py
│   ├── schema.py
│   └── errors.py
├── chunking/
│   ├── ast_chunker.py
│   ├── md_chunker.py
│   ├── thread_chunker.py
│   └── token_counter.py
├── extractors/
│   ├── base.py
│   ├── patterns.py
│   ├── extractor.py
│   ├── routes.py
│   ├── linker.py
│   ├── registry.py
│   └── languages/
│       ├── python.py
│       ├── go.py
│       ├── typescript.py
│       └── csharp.py
... (15 more)
```

**Problem:** On phone, switching files is painful. You lose context.

**Fix:** Consolidate for phase-by-phase implementation:

```
rag/
├── types.py           # ALL types, protocols, schema, errors (~200 lines)
├── extractors.py      # ALL extraction code (~750 lines, but one file)
├── stores.py          # LanceStore + MockGraphStore + GraphitiStore
├── retrieval.py       # HybridRetriever + Reranker
├── pipeline.py        # Orchestrator + Dagster assets
└── tests/
    └── test_all.py    # All tests in one file for easy running
```

**Later, split into submodules when stable.**

### 6.2 No Copy-Paste Blocks

**Problem:** The spec shows interfaces but not complete implementations. On phone, you can't easily synthesize code from descriptions.

**Fix:** Provide complete copy-paste implementations for critical paths:

```python
# COPY THIS ENTIRE BLOCK TO extractors.py

import re
from dataclasses import dataclass
from typing import Iterator, Literal, Protocol
from pathlib import Path
import tree_sitter
import tree_sitter_python

@dataclass
class ServiceCall:
    """Detected inter-service communication."""
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float
    method: str | None = None
    url_path: str | None = None

class HttpCallPattern:
    """Matches HTTP client calls in Python."""

    URL_REGEX = re.compile(r'https?://([^/:]+)')
    PATH_REGEX = re.compile(r'https?://[^/]+(/[^"\')\s]+)')

    PYTHON_HTTP_FUNCS = {
        "requests": {"get", "post", "put", "delete", "patch", "head", "options"},
        "httpx": {"get", "post", "put", "delete", "patch", "head", "options"},
        "aiohttp": {"get", "post", "put", "delete", "patch", "head", "options"},
    }

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        calls = []
        if node.type != "call":
            return calls

        text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

        # Check if it's an HTTP client call
        for lib, methods in self.PYTHON_HTTP_FUNCS.items():
            for method in methods:
                if f"{lib}.{method}" in text or f".{method}(" in text:
                    # Extract URL
                    url_match = self.URL_REGEX.search(text)
                    if url_match:
                        target = url_match.group(1)
                        path_match = self.PATH_REGEX.search(text)
                        calls.append(ServiceCall(
                            source_file="",  # Filled by caller
                            target_service=target,
                            call_type="http",
                            line_number=node.start_point[0] + 1,
                            confidence=0.9 if "://" in text else 0.7,
                            method=method.upper(),
                            url_path=path_match.group(1) if path_match else None,
                        ))
        return calls

# ... (complete implementation continues)
```

### 6.3 Missing "Checkpoint" Comments

**Problem:** When coding on phone with interruptions, you lose your place.

**Fix:** Add checkpoint markers:

```python
# === CHECKPOINT: ServiceExtractor base complete ===
# If you stopped here, run: pytest tests/test_extractor.py::test_base
# Next: Add Python patterns

class PythonExtractor:
    ...

# === CHECKPOINT: Python extraction complete ===
# Run: pytest tests/test_extractor.py::test_python
# Next: Add Go patterns
```

---

## 7. Recommended Changes Summary

### Must Fix Before Implementation

| Issue | Location | Impact | Fix Time |
|-------|----------|--------|----------|
| ServiceCall missing fields | base.py | Linker won't work | 5 min |
| Async/sync mismatch in Dagster | assets.py | Won't run | 10 min |
| Phase 4 too big | PHASING_STRATEGY | Lost context | 20 min |

### Should Fix

| Issue | Location | Impact | Fix Time |
|-------|----------|--------|----------|
| Error contracts | protocols.py | Debugging pain | 30 min |
| Test vectors for patterns | patterns.py | Wrong implementations | 20 min |
| Consolidate files | File structure | Phone friction | 15 min |

### Nice to Have

| Issue | Location | Impact | Fix Time |
|-------|----------|--------|----------|
| Incremental update strategy | New section | Long reindex times | 1 hr |
| Confidence tiers | base.py | Cleaner data | 15 min |
| Checkpoint comments | All files | Resume points | 30 min |

---

## 8. Proposed Phase 4 Split

Given Phase 4 is the riskiest, here's a detailed breakdown:

### Phase 4a: Python HTTP Call Extraction (2 hrs)

**Files:** `extractors.py` (partial)

**Deliverable:**
```python
extractor = ServiceExtractor()
calls = extractor.extract_from_file("auth/login.py", code)
assert calls[0].target_service == "user-service"
```

**Smoke test:**
```bash
python -c "from rag.extractors import ServiceExtractor; print(ServiceExtractor())"
```

### Phase 4b: Route Registry (1 hr)

**Files:** `extractors.py` (add RouteRegistry, SQLiteRegistry)

**Deliverable:**
```python
registry = SQLiteRegistry("./data/routes.db")
registry.add_routes("user-service", [...])
route = registry.find_route_by_request("user-service", "GET", "/api/users/123")
assert route.handler_function == "get_user"
```

### Phase 4c: FastAPI Route Extraction (1 hr)

**Files:** `extractors.py` (add FastAPIPattern)

**Deliverable:**
```python
extractor = RouteExtractor()
routes = extractor.extract_from_file("routes.py", fastapi_code, "user-service")
assert routes[0].path == "/api/users/{user_id}"
```

### Phase 4d: Call Linker Integration (1 hr)

**Files:** `extractors.py` (add CallLinker)

**Deliverable:**
```python
linker = CallLinker(registry)
relation = linker.link(call)
assert relation.target_file == "user-service/src/controllers/user_controller.py"
```

### Phase 4e: Other Languages (2 hrs)

**Files:** `extractors.py` (add Go, TS, C# patterns)

**Test per language, one at a time.**

---

## 9. Conclusion

The design is solid architecturally. The issues are all at the "seams" - where modules connect. Fixing these before coding will save significant debugging time.

**Priority order:**
1. Fix ServiceCall dataclass (blocks linker)
2. Split Phase 4 (reduces risk)
3. Add error contracts (reduces debugging)
4. Consolidate files (improves phone workflow)
5. Add test vectors (ensures correct patterns)

**Estimated time to fix spec:** 2-3 hours

**Risk reduction:** High - avoids 10+ hours of mid-implementation debugging

---

*Critique generated: 2026-01-30*
