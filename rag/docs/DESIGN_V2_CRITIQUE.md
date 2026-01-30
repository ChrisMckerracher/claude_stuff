# RAG v2 Design Critique: Vibe-Coding Readiness Assessment

## Executive Summary

**Overall Grade: B+**

The design is significantly more vibe-code ready than typical specs. Key strengths:
- Interface-first approach with protocols
- Checkpoint markers for phone-based development
- Mock implementations enabling offline verification
- Dagster asset model provides natural boundaries

**Critical gaps preventing one-shot execution:**
1. Missing concrete test fixtures inline
2. Several "~X lines" placeholders without actual code
3. Control flow for error recovery is underspecified
4. Config isn't centralized despite claiming it is

---

## Category 1: Ambiguity Issues

### 1.1 CRITICAL: "~X lines" Placeholders

**Problem:** Throughout the spec, you have code blocks with `# ~30 lines` or `...` placeholders.

```python
# From patterns.py spec
def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
    # ~30 lines: check node type, extract URL, infer service name
    ...
```

**Why this kills vibe coding:** When you're on your phone, you hit this and have no idea what to write. You lose flow.

**Fix:** Replace ALL placeholders with actual implementation OR at minimum provide pseudocode steps:

```python
def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
    # 1. Bail early if not a call node
    if node.type not in ("call", "call_expression"):
        return []

    # 2. Get the full call text
    call_text = source[node.start_byte:node.end_byte].decode('utf-8', errors='replace')

    # 3. Try to extract URL from string literal children
    url = self._find_url_in_children(node, source)
    if not url:
        return []

    # 4. Parse service name from URL host
    match = self.URL_REGEX.search(url)
    if not match:
        return []
    service_name = match.group(1)

    # 5. Parse path
    path_match = self.PATH_REGEX.search(url)
    url_path = path_match.group(1) if path_match else None

    # 6. Determine confidence based on how we found the URL
    confidence = Confidence.HIGH if '"http' in call_text else Confidence.MEDIUM

    return [ServiceCall(
        source_file="<filled by caller>",
        target_service=service_name,
        call_type="http",
        line_number=node.start_point[0],
        confidence=confidence,
        method=self._infer_method(node, source),
        url_path=url_path,
        target_host=service_name,
    )]
```

**Location:** PHASING_STRATEGY.md lines 232-234, 261-263, 290-293, 311-313

### 1.2 HIGH: Inconsistent Import Paths

**Problem:** The spec mixes import styles:

```python
# Sometimes this:
from rag.extractors import PythonExtractor

# Sometimes this:
from rag.extractors.extractor import ServiceExtractor

# And sometimes this:
from rag.extractors.base import ServiceCall
```

**Why this matters:** On phone, you'll constantly guess wrong and get ImportErrors.

**Fix:** Add explicit `__init__.py` exports to the spec:

```python
# rag/extractors/__init__.py
from .base import ServiceCall, Confidence, PatternMatcher, LanguageExtractor
from .patterns import HttpCallPattern, GrpcCallPattern, QueuePublishPattern
from .extractor import ServiceExtractor
from .languages.python import PythonExtractor
from .languages.go import GoExtractor
from .languages.typescript import TypeScriptExtractor
from .languages.csharp import CSharpExtractor
from .routes import RouteDefinition, RouteExtractor
from .registry import RouteRegistry, InMemoryRegistry
from .sqlite_registry import SQLiteRegistry
from .linker import CallLinker, LinkResult, ServiceRelation

__all__ = [
    "ServiceCall", "Confidence", "PatternMatcher", "LanguageExtractor",
    "HttpCallPattern", "GrpcCallPattern", "QueuePublishPattern",
    "ServiceExtractor",
    "PythonExtractor", "GoExtractor", "TypeScriptExtractor", "CSharpExtractor",
    "RouteDefinition", "RouteExtractor",
    "RouteRegistry", "InMemoryRegistry", "SQLiteRegistry",
    "CallLinker", "LinkResult", "ServiceRelation",
]
```

### 1.3 MEDIUM: "Phone-Optimized File Structure" vs "File Structure"

**Problem:** The doc shows TWO different file structures:

1. Lines 118-131: Multi-file structure (`rag/extractors/base.py`, etc.)
2. Lines 407-441: Consolidated structure (`rag/types.py`, `rag/extractors.py`)

**Which one do I use?** Not clear.

**Fix:** Be explicit about the transition:

```markdown
## File Structure

### Phase 1-4: Consolidated (Phone-Optimized)

During initial development, use consolidated files to minimize context switching:

- `rag/types.py` - ALL types, protocols, errors
- `rag/extractors.py` - ALL extraction code
- `rag/stores.py` - ALL storage implementations

### Post-MVP: Split Structure

After MVP is stable, refactor into submodules:

- `rag/extractors/base.py`
- `rag/extractors/patterns.py`
- etc.

**DECISION: Start consolidated, split after Phase 7 acceptance tests pass.**
```

### 1.4 MEDIUM: Missing Type Stubs for External Dependencies

**Problem:** The spec references external types without showing stubs:

```python
import tree_sitter
from graphiti_core import Graphiti
from lancedb import Table
```

**Why this matters:** On phone, you can't easily look up what `tree_sitter.Node` has.

**Fix:** Add type stub comments inline:

```python
# tree_sitter.Node has:
#   .type: str                    # e.g., "call", "function_definition"
#   .start_byte: int              # Position in source
#   .end_byte: int
#   .start_point: tuple[int, int] # (row, col)
#   .children: list[Node]
#   .named_children: list[Node]   # Only named children, skips punctuation
#   .child_by_field_name(name: str) -> Node | None

# graphiti_core.Graphiti has:
#   async def add_episode(name: str, episode_body: str, source_description: str,
#                         reference_time: datetime = None) -> GraphitiResult
#   async def search(query: str, num_results: int = 10) -> list[SearchResult]
```

---

## Category 2: Interface Contract Issues

### 2.1 CRITICAL: VectorStore Protocol Missing Content Hash

**Problem:** The `insert` method claims idempotency but doesn't specify how:

```python
async def insert(self, chunk: EmbeddedChunk) -> None:
    """Insert chunk. Idempotent on chunk.id.

    Idempotency:
        - Same ID + same content hash → no-op
        - Same ID + different content → raises DuplicateChunkError
    """
```

But `EmbeddedChunk` doesn't have a `content_hash` field!

**Fix:** Add content hash to the type:

```python
@dataclass
class EmbeddedChunk:
    """Chunk with vector embedding."""
    chunk: CleanChunk
    vector: list[float]
    content_hash: str  # SHA256(chunk.text) - for idempotency check

    @staticmethod
    def from_clean(chunk: CleanChunk, vector: list[float]) -> "EmbeddedChunk":
        return EmbeddedChunk(
            chunk=chunk,
            vector=vector,
            content_hash=hashlib.sha256(chunk.text.encode()).hexdigest()
        )
```

### 2.2 HIGH: RouteRegistry Protocol Missing `all_routes()` Method

**Problem:** The Dagster asset `service_relations` iterates over all files, but `RouteRegistry` only has `get_routes(service: str)`. How do you iterate all routes?

**Current spec (line 858):**
```python
def all_services(self) -> list[str]:
    """List all services with registered routes."""
```

**Missing:** Method to get total route count for logging/stats.

**Fix:**

```python
class RouteRegistry(Protocol):
    # ... existing methods ...

    def route_count(self) -> int:
        """Total routes across all services."""
        ...

    def all_routes(self) -> Iterator[RouteDefinition]:
        """Iterate all routes (for debugging/export)."""
        ...
```

### 2.3 HIGH: GraphStore Protocol `add_entity` Has Conflicting Upsert Semantics

**Problem (lines 1451-1459):**

```python
async def add_entity(self, entity: Entity) -> EntityID:
    """Add or update entity. Returns ID.

    Upsert Behavior:
        - If entity with same (type, name) exists → update properties
        - Otherwise → create new entity
    """
```

But `Entity` has an `id` field! So:
- Do I pass an ID when creating?
- Is the ID deterministic from (type, name)?
- If I pass an ID that conflicts with existing (type, name), what happens?

**Fix:** Make ID generation explicit:

```python
@dataclass
class Entity:
    type: EntityType
    name: str
    properties: dict[str, Any]
    source_refs: list[str]

    @property
    def id(self) -> EntityID:
        """ID is deterministic from (type, name)."""
        return EntityID(f"{self.type.value.lower()}:{self.name}")

# Or if IDs are opaque/generated:
async def add_entity(self, entity: Entity) -> Entity:
    """Returns entity with ID populated."""
```

### 2.4 MEDIUM: `Scrubber.scrub_batch` Never Raises But No Error Accumulation Pattern

**Problem (lines 1607-1619):**

```python
def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
    """Batch scrubbing for efficiency. Never raises.

    Returns:
        List of ScrubResult in same order as input chunks.
    """
```

But how do I handle partial failures downstream? The orchestrator shows:

```python
clean_chunks = [self._scrubber.scrub(c) for c in chunks]
```

This uses `scrub()` not `scrub_batch()`. Inconsistent.

**Fix:** Show the batch error handling pattern:

```python
# In orchestrator
results = self._scrubber.scrub_batch(chunks)
clean_chunks = []
scrub_errors = []

for result in results:
    if result.success:
        clean_chunks.append(result.clean_chunk)
    else:
        scrub_errors.append((result.chunk_id, result.error))

if scrub_errors:
    stats.scrub_errors.extend(scrub_errors)
    # Continue with successful chunks, don't fail entire batch
```

---

## Category 3: Control Flow Issues

### 3.1 HIGH: Dagster Asset Dependencies Don't Show Data Flow

**Problem:** The asset dependency graph shows boxes and arrows but not WHAT data flows between them:

```
raw_code_files
      │
      ├──────────────────────────────────┐
      │                                  │
      ▼                                  ▼
route_registry                     code_chunks
```

**What exactly does `raw_code_files` return?** The spec says `RawCodeFilesOutput` but you have to scroll way up to find its definition.

**Fix:** Annotate the diagram with types:

```
raw_code_files: RawCodeFilesOutput
      │
      │  .files_by_service: dict[str, list[Path]]
      │  .total_files: int
      │
      ├──────────────────────────────────┐
      │                                  │
      ▼                                  ▼
route_registry: RouteRegistryOutput    code_chunks: list[RawChunk]
      │
      │  .db_path: str
      │  .load() → SQLiteRegistry
```

### 3.2 MEDIUM: MockGraphStore Episode Extraction Is Different From Production

**Problem (lines 2295-2343):** MockGraphStore uses regex patterns, Graphiti uses LLM extraction. The parity tests only check "did we get entities", not "are they the same entities".

```python
PARITY_TEST_CASES = [
    ("The auth-service calls user-service", [EntityType.SERVICE], 2, "...")
]
```

This doesn't catch:
- Mock extracts "auth-service", Graphiti might extract "auth service" or "authentication service"
- Mock creates entity ID `service:auth-service`, Graphiti might use a UUID
- Relationship extraction is completely absent from mock

**Fix:** Either:

A) Make mock behavior explicit as "NOT production equivalent":
```python
class MockGraphStore:
    """In-memory GraphStore for UNIT TESTS ONLY.

    WARNING: This mock uses regex extraction, NOT LLM extraction.
    - Entity names may differ from production
    - Relationships are NOT extracted (call add_relationship directly)
    - Use for testing control flow, not extraction quality
    """
```

B) Or add a mock configuration that mimics Graphiti more closely:
```python
class MockGraphStore:
    def __init__(self, extraction_mode: Literal["regex", "llm_simulator"] = "regex"):
        self._mode = extraction_mode

    async def add_episode(self, text: str, ...) -> list[Entity]:
        if self._mode == "llm_simulator":
            # Use a local small model or deterministic rules
            # that approximate Graphiti's behavior
            ...
```

### 3.3 MEDIUM: Chunking → Scrubbing → Embedding Pipeline Not Shown As One Flow

**Problem:** The individual components are well-defined but how they compose isn't crystal clear. You have:

- Phase 1: Chunking (separate section)
- Phase 2: PHI Scrubbing (separate section)
- Phase 3: LanceDB Store (separate section)

But Phase 7 Orchestrator shows them composed with NEW logic not in those phases:

```python
# This pattern appears in Phase 7 but not in Phase 1-3
texts = [c.text for c in clean_chunks]
vectors = self._embedder.embed_batch(texts)
embedded = [
    EmbeddedChunk(chunk=c, vector=v)
    for c, v in zip(clean_chunks, vectors)
]
```

**Fix:** Show the composition earlier, maybe as a sequence diagram:

```
┌─────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌───────────┐
│ Crawler │──▶│ Chunker │──▶│ Scrubber │──▶│ Embedder │──▶│VectorStore│
└─────────┘   └─────────┘   └──────────┘   └──────────┘   └───────────┘
     │                                           │               │
     │  CrawlResult                              │  list[float]  │  void
     │  .content: bytes                          │  (768-dim)    │
     │  .source_uri: str                         │               │
     │                                           │               │
     └──────────────────────────────────────────▶│               │
                                                 │               │
                          CleanChunk + vector = EmbeddedChunk ──▶│
```

---

## Category 4: Testability Issues

### 4.1 CRITICAL: Test Fixtures Not Provided

**Problem:** The acceptance tests reference fixtures that don't exist:

```python
async def indexed_services():
    """Index auth-service and user-service fixtures."""
    await ingest("fixtures/auth-service/")  # WHERE IS THIS?
    await ingest("fixtures/user-service/")  # WHERE IS THIS?
```

**Fix:** Include minimal fixtures in the spec:

```python
# fixtures/auth-service/login.py
import httpx

async def login(username: str, password: str) -> dict:
    """Authenticate user via user-service."""
    resp = await httpx.AsyncClient().post(
        "http://user-service/api/users/authenticate",
        json={"username": username, "password": password}
    )
    return resp.json()

# fixtures/user-service/routes.py
from fastapi import FastAPI, APIRouter

app = FastAPI()
router = APIRouter()

@router.post("/api/users/authenticate")
async def authenticate(username: str, password: str):
    """Authenticate a user."""
    return {"user_id": "123", "token": "abc"}

@router.get("/api/users/{user_id}")
async def get_user(user_id: str):
    """Get user by ID."""
    return {"id": user_id, "name": "Test User"}

app.include_router(router)
```

### 4.2 HIGH: Checkpoint Commands Assume Module Runnable

**Problem (lines 454-489):**

```bash
python -m rag.extractors --checkpoint python_http
```

But `rag/extractors.py` (consolidated file) isn't a package with `__main__.py`.

**Fix:** Make the checkpoint code actually work:

```python
# rag/checkpoints.py - Standalone script
"""
Usage: python rag/checkpoints.py <checkpoint_name>

Checkpoints verify each phase works before moving on.
"""
import sys

def run_checkpoint(name: str) -> None:
    if name == "python_http":
        from rag.extractors import PythonExtractor
        code = b'requests.get("http://user-service/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1, f"Expected 1 call, got {len(calls)}"
        assert calls[0].target_service == "user-service"
        print("PASSED: python_http")

    elif name == "registry_crud":
        import tempfile
        import os
        from rag.extractors import SQLiteRegistry, RouteDefinition
        with tempfile.TemporaryDirectory() as d:
            r = SQLiteRegistry(os.path.join(d, "test.db"))
            r.add_routes("svc", [
                RouteDefinition("svc", "GET", "/api/{id}", "h.py", "get", 1)
            ])
            found = r.find_route_by_request("svc", "GET", "/api/123")
            assert found is not None, "Route not found"
            r.clear("svc")
            assert r.get_routes("svc") == [], "Routes not cleared"
        print("PASSED: registry_crud")

    # ... more checkpoints ...

    else:
        print(f"Unknown checkpoint: {name}")
        print("Available: python_http, registry_crud, call_linker, ...")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python rag/checkpoints.py <checkpoint_name>")
        sys.exit(1)
    run_checkpoint(sys.argv[1])
```

### 4.3 MEDIUM: Quick Checks Use Features Not Yet Built

**Problem:** Phase 2's quick check uses `Config` and `raw_code_files`:

```bash
python -c "
from rag.pipeline import raw_code_files, Config
result = raw_code_files(Config(repos=[{'name': 'test', 'path': '.'}]))
"
```

But those aren't defined until you BUILD Phase 2. So this check can't run BEFORE implementing it.

**Fix:** Quick checks should test INPUTS to the phase, not OUTPUTS:

```bash
# Phase 2 PREREQUISITE check (runs BEFORE implementing Phase 2)
python -c "
# Verify dependencies are installed
import tree_sitter_python
import dagster
print('PREREQ PASSED: Phase 2 dependencies installed')
"

# Phase 2 COMPLETION check (runs AFTER implementing Phase 2)
python -c "
from rag.pipeline import raw_code_files, Config
...
"
```

---

## Category 5: Milestone Deliverable Issues

### 5.1 CRITICAL: No Definition of "Done" for MVP

**Problem:** The MVP is described as:

> **MVP Deliverable:** Working multi-repo code search with graph expansion + Dagster UI.

But what exactly does "working" mean? There's no acceptance criteria.

**Fix:** Add explicit MVP acceptance test:

```python
# tests/test_mvp_acceptance.py
"""
MVP is DONE when ALL of these pass.
Run: pytest tests/test_mvp_acceptance.py -v
"""

@pytest.mark.mvp
async def test_mvp_1_dagster_ui_loads():
    """Dagster dev server starts and shows assets."""
    # Start dagster dev, hit http://localhost:3000
    # Assert: All 5 assets visible (raw_code_files, route_registry,
    #         code_chunks, service_relations, vector_index)
    ...

@pytest.mark.mvp
async def test_mvp_2_can_index_two_services():
    """Can ingest two services that call each other."""
    await materialize_assets(["auth-service", "user-service"])
    # Assert: No errors in Dagster run
    ...

@pytest.mark.mvp
async def test_mvp_3_vector_search_returns_code():
    """Vector search finds relevant code."""
    results = await search("user authentication")
    assert len(results) >= 1
    assert any("auth" in r.source_uri for r in results)

@pytest.mark.mvp
async def test_mvp_4_graph_expansion_works():
    """Graph expansion finds related services."""
    results = await search("authentication", expand_graph=True)
    # Auth-service calls user-service, so both should appear
    sources = {r.source_uri for r in results}
    assert any("auth" in s for s in sources), "Direct match"
    assert any("user" in s for s in sources), "Graph expansion"

@pytest.mark.mvp
async def test_mvp_5_latency_acceptable():
    """Search completes in reasonable time."""
    import time
    start = time.monotonic()
    await search("authentication")
    elapsed = time.monotonic() - start
    assert elapsed < 5.0, f"Search took {elapsed}s, want < 5s"
```

### 5.2 HIGH: Phase 4 Sub-phases Have No Clear Handoff

**Problem:** Phase 4 is split into 4a-4f but there's no explicit handoff between them:

> **Why Split Phase 4?** The original 750-line Phase 4 is 3-4 hours of vibe coding.

But how do I know when 4a is done and 4b should start?

**Fix:** Add explicit completion criteria:

```markdown
### Phase 4a: Python Call Extraction

**ENTRY CRITERIA:**
- Phase 3 complete (code_chunks asset works)

**DONE CRITERIA:**
- [ ] `python -m rag.checkpoints python_http` passes
- [ ] All 10 acceptance tests in test_phase4a_python.py pass
- [ ] Can run extractor on rag/ directory with 0 false positives

**EXIT ARTIFACT:**
- Commit with message: "feat(rag): python HTTP call extraction"
- Git tag: `phase-4a-complete`

---

### Phase 4b: Multi-language Extraction

**ENTRY CRITERIA:**
- Git tag `phase-4a-complete` exists
- PythonExtractor tests passing
```

### 5.3 MEDIUM: No Time Estimates (Good!) But No Complexity Indicators Either

**Problem:** The doc correctly avoids time estimates but provides no indication of relative complexity.

**Fix:** Add complexity ratings:

```markdown
| Phase | Deliverable | Lines | Complexity | Notes |
|-------|-------------|-------|------------|-------|
| 4a | Python Extraction | ~200 | MEDIUM | Familiar patterns |
| 4b | Multi-language | ~160 | MEDIUM | Copy Python, adapt |
| 4c | Route Registry | ~100 | LOW | Standard CRUD |
| 4d | FastAPI Routes | ~80 | LOW | Single decorator |
| 4e | Call Linker | ~60 | MEDIUM | Path matching logic |
| 4f | Other Frameworks | ~150 | HIGH | Multiple unfamiliar patterns |

Complexity:
- LOW: Straightforward, unlikely to need debugging
- MEDIUM: May need some debugging, 1-2 tricky bits
- HIGH: Multiple unknowns, expect iteration
```

---

## Category 6: Config & Constants Issues

### 6.1 HIGH: Config Claims Centralization But Isn't

**Problem (lines 39-66):** The spec says:

> **Central Configuration (Single Source of Truth):**
> ```python
> # rag/config.py - ALL magic numbers live here
> EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"
> ```

But then TokenCounter hardcodes it:

```python
class TokenCounter:
    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
```

And Embedder also:

```python
class CodeRankEmbedder:
    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
```

These should import from config!

**Fix:**

```python
# rag/config.py
EMBEDDING_MODEL = "jinaai/jina-embeddings-v3"

# rag/chunking/token_counter.py
from rag.config import EMBEDDING_MODEL

class TokenCounter:
    def __init__(self, model_name: str = EMBEDDING_MODEL):
        ...

# rag/indexing/embedder.py
from rag.config import EMBEDDING_MODEL

class CodeRankEmbedder:
    def __init__(self, model_name: str = EMBEDDING_MODEL):
        ...
```

### 6.2 MEDIUM: SQLite DB Path Hardcoded in Multiple Places

**Problem:**

```python
# In SQLiteRegistry
def __init__(self, db_path: str = "./data/routes.db"):

# In Dagster asset
db_path = "./data/routes.db"
registry = SQLiteRegistry(db_path)
```

**Fix:** Centralize:

```python
# rag/config.py
from pathlib import Path

DATA_DIR = Path("./data")
ROUTES_DB_PATH = DATA_DIR / "routes.db"
LANCE_DB_PATH = DATA_DIR / "lance"

# Ensure data dir exists on import
DATA_DIR.mkdir(exist_ok=True)
```

---

## Summary: Changes Required for One-Shot Vibe Coding

### Must Fix (Blocks one-shot execution)

1. **Replace all `...` and `# ~X lines` with actual code or detailed pseudocode**
2. **Add inline test fixtures** (auth-service/user-service minimal examples)
3. **Add checkpoint.py as standalone script** (not module)
4. **Add explicit MVP acceptance test suite**
5. **Add content_hash to EmbeddedChunk**

### Should Fix (High friction without)

6. Add explicit `__init__.py` exports
7. Annotate Dagster asset graph with types
8. Centralize ALL config (embedding model, DB paths)
9. Add phase completion criteria with git tags

### Nice to Have (Improves experience)

10. Add complexity ratings to phases
11. Add type stubs for external deps inline
12. Add composition diagram showing full pipeline
13. Document mock vs production behavioral differences

---

## Recommended Reading Order for Implementation

1. **First:** Read Phase 0 (types/protocols) completely
2. **Second:** Read the "Phone-Optimized File Structure" section
3. **Third:** Read Phase 4a-4e in sequence (the core extraction logic)
4. **Fourth:** Read Phase 7 (orchestrator) to see how pieces compose
5. **Skip until needed:** Phase 8-9 (post-MVP)

---

## Appendix: Quick Reference Card

Print this for phone coding sessions:

```
TYPES
-----
ChunkID(value: str)
RawChunk(id, text, source_uri, corpus_type, byte_range, metadata)
CleanChunk(id, text, source_uri, corpus_type, context_prefix, metadata, scrub_log)
EmbeddedChunk(chunk: CleanChunk, vector: list[float])
ServiceCall(source_file, target_service, call_type, line_number, confidence, method?, url_path?, target_host?)
RouteDefinition(service, method, path, handler_file, handler_function, line_number)
ServiceRelation(source_file, source_line, target_file, target_function, target_line, relation_type, route_path?)
LinkResult(relation?, unlinked_call?, miss_reason?)

CONFIDENCE
----------
HIGH = 0.9    # Literal URL: requests.get("http://x/api")
MEDIUM = 0.7  # F-string: requests.get(f"http://{X}/api")
LOW = 0.5     # Variable: requests.get(url)
GUESS = 0.3   # Comment hint only

PROTOCOLS
---------
VectorStore: insert(EmbeddedChunk), search(vector, limit, filters) -> SearchResult[]
GraphStore: add_entity(Entity), add_relationship(...), search_entities(query), get_neighbors(id)
RouteRegistry: add_routes(service, routes), get_routes(service), find_route_by_request(service, method, path)

CHECKPOINTS
-----------
python rag/checkpoints.py python_http
python rag/checkpoints.py registry_crud
python rag/checkpoints.py call_linker

IMPORTS (Consolidated Structure)
--------------------------------
from rag.types import ChunkID, RawChunk, CleanChunk, EmbeddedChunk, ServiceCall, ...
from rag.extractors import PythonExtractor, ServiceExtractor, SQLiteRegistry, CallLinker
from rag.stores import LanceStore, MockGraphStore
from rag.retrieval import HybridRetriever
```
