# RAG v2 Phasing Strategy

## Design Constraints

**Vibe Coding Reality:**
- Building via Claude for phone - limited ability to spin up external services
- Can't easily test Graphiti (requires Neo4j + LLM API)
- Need confidence in design BEFORE integration testing

**Pseudo Formal Verification Approach:**
- Interface-first design with explicit contracts
- Type signatures as specifications
- Dependency injection for testability
- Mock implementations for offline verification
- Control flow diagrams for each module

**Framework Decisions**

| Layer | Tool | Why |
|-------|------|-----|
| **Orchestration** | Dagster | Asset lineage, retries, observability UI, testing harness |
| **Chunking** | LlamaIndex CodeSplitter | Tree-sitter AST chunking built-in |
| **Vector Store** | LanceDB | Embedded, no server needed |
| **Graph Store** | Graphiti + Neo4j Aura | Temporal awareness, LLM entity extraction |
| **PHI Scrubbing** | Presidio | Mature, configurable PII detection |

**Architecture:**
```
Dagster Assets (orchestration + observability)
    ├── raw_code_files      → crawl repos
    ├── code_chunks         → LlamaIndex CodeSplitter
    ├── clean_chunks        → Presidio PHI scrubbing
    ├── service_relations   → custom tree-sitter extraction
    ├── vector_index        → LanceDB
    └── knowledge_graph     → Graphiti
```

**What We Build Custom:**
1. `repo_crawler` asset - coordinates multiple git repos (~50 lines)
2. `service_extractor` asset - AST-based relationship detection (~350 lines)
   - Multi-language patterns: Python, Go, TypeScript, C#
   - HTTP client detection, gRPC calls, queue publish/subscribe
3. `phi_scrubber` asset - Presidio wrapper (~50 lines)

---

## Phase Overview

### Track A: Multi-Repo Code Graph RAG (MVP)

| Phase | Deliverable | Custom Code | Verification |
|-------|-------------|-------------|--------------|
| 1 | Project Setup | Dagster + deps config | `dagster dev` runs |
| 2 | Repo Crawler Asset | ~50 lines | Unit test with fixture repos |
| 3 | Code Chunks Asset | ~20 lines (configure CodeSplitter) | Chunks look correct |
| 4 | Service Extractor Asset | ~350 lines (multi-lang AST) | Unit test per language |
| 5 | Vector Index Asset | ~30 lines (configure LanceDB) | Search returns results |
| 6 | Graph Asset | ~50 lines (configure Graphiti) | Graph queries work |
| 7 | Hybrid Retriever | ~100 lines | End-to-end test |

**MVP Deliverable:** Working multi-repo code search with graph expansion + Dagster UI.

**Lines of Custom Code:** ~600 (honest estimate)

### Track B: Compliance & Conversations (Post-MVP)

| Phase | Deliverable | Custom Code | Verification |
|-------|-------------|-------------|--------------|
| 8 | PHI Scrubber Asset | ~50 lines Presidio wrapper | PII removed from output |
| 9 | Conversation Loader Asset | ~80 lines Slack/transcript | Threads parsed correctly |

---

## Service Extractor Module Breakdown

The service extractor is the largest custom component (~360 lines). Here's the full interface spec:

### File Structure
```
rag/extractors/
├── base.py          # ~30 lines - protocols and types
├── patterns.py      # ~80 lines - pattern matchers
├── extractor.py     # ~40 lines - main entry point
└── languages/
    ├── python.py    # ~60 lines
    ├── go.py        # ~50 lines
    ├── typescript.py # ~50 lines
    └── csharp.py    # ~50 lines
```

### `base.py` (~30 lines)
```python
from dataclasses import dataclass
from typing import Protocol, Literal, Iterator
import tree_sitter

@dataclass
class ServiceCall:
    """Detected inter-service communication."""
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float  # 0.0-1.0, based on pattern certainty

class PatternMatcher(Protocol):
    """Matches specific call patterns in AST nodes."""
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]: ...

class LanguageExtractor(Protocol):
    """Extracts service calls from source code in a specific language."""
    language: str
    def extract(self, source: bytes) -> list[ServiceCall]: ...
    def get_patterns(self) -> list[PatternMatcher]: ...
```

### `patterns.py` (~80 lines)
```python
class HttpCallPattern(PatternMatcher):
    """Matches HTTP client calls across languages.

    Python: requests.get/post, httpx.get, aiohttp.ClientSession
    Go: http.Get, http.Post, client.Do
    TS: fetch(), axios.get/post
    C#: HttpClient.GetAsync/PostAsync
    """
    URL_REGEX = re.compile(r'https?://([^/]+)')

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~20 lines: check node type, extract URL, infer service name
        ...

class GrpcCallPattern(PatternMatcher):
    """Matches gRPC client calls.

    Python: grpc.insecure_channel(), stub.Method()
    Go: grpc.Dial(), client.Method()
    """
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~20 lines
        ...

class QueuePublishPattern(PatternMatcher):
    """Matches message queue publish operations.

    Python: channel.basic_publish(), producer.send()
    Go: channel.Publish(), producer.Produce()
    """
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~20 lines
        ...

class QueueSubscribePattern(PatternMatcher):
    """Matches message queue subscribe operations."""
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~15 lines
        ...
```

### `extractor.py` (~40 lines)
```python
class ServiceExtractor:
    """Main entry point - delegates to language-specific extractors."""

    LANG_MAP = {".py": "python", ".go": "go", ".ts": "typescript", ".cs": "csharp"}

    def __init__(self):
        self._extractors: dict[str, LanguageExtractor] = {
            "python": PythonExtractor(),
            "go": GoExtractor(),
            "typescript": TypeScriptExtractor(),
            "csharp": CSharpExtractor(),
        }

    def extract_from_file(self, path: str, content: bytes) -> list[ServiceCall]:
        """Extract all service calls from a source file."""
        lang = self._detect_language(path)
        if lang not in self._extractors:
            return []
        return self._extractors[lang].extract(content)

    def extract_from_repo(self, repo_path: str) -> Iterator[ServiceCall]:
        """Extract service calls from all files in a repo."""
        for file_path, content in walk_repo_files(repo_path):
            yield from self.extract_from_file(file_path, content)

    def _detect_language(self, path: str) -> str | None:
        ext = Path(path).suffix
        return self.LANG_MAP.get(ext)
```

### `languages/python.py` (~60 lines)
```python
import tree_sitter_python

class PythonExtractor(LanguageExtractor):
    language = "python"

    # AST node types we care about
    CALL_NODES = {"call", "attribute"}

    def __init__(self):
        self._parser = tree_sitter.Parser()
        self._parser.set_language(tree_sitter_python.language())
        self._patterns = [
            HttpCallPattern(),
            GrpcCallPattern(),
            QueuePublishPattern(),
            QueueSubscribePattern(),
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        tree = self._parser.parse(source)
        calls = []
        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))
        return calls

    def _walk_calls(self, node: tree_sitter.Node) -> Iterator[tree_sitter.Node]:
        """Yield all call expression nodes."""
        if node.type in self.CALL_NODES:
            yield node
        for child in node.children:
            yield from self._walk_calls(child)

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
```

### `languages/go.py`, `typescript.py`, `csharp.py` (~50 lines each)
Same structure as Python, different:
- Parser: `tree_sitter_go`, `tree_sitter_typescript`, `tree_sitter_c_sharp`
- Node types: Go uses `call_expression`, TS uses `call_expression`, C# uses `invocation_expression`
- Pattern adjustments for language-specific idioms

### Line Count Summary

| File | Lines | Purpose |
|------|-------|---------|
| `base.py` | 30 | Protocols, ServiceCall dataclass |
| `patterns.py` | 80 | 4 pattern matchers |
| `extractor.py` | 40 | Main entry point, language dispatch |
| `languages/python.py` | 60 | Python AST walking |
| `languages/go.py` | 50 | Go AST walking |
| `languages/typescript.py` | 50 | TypeScript AST walking |
| `languages/csharp.py` | 50 | C# AST walking |
| **Total** | **360** | |

---

## Phase 0: Core Protocols & Types

**Deliverable:** All interfaces, types, and contracts defined. Zero implementation.

**Why First:** This is your "specification" - reviewable, verifiable by inspection, no runtime needed.

### Tasks

#### 0.1 Define Core Data Types
```python
# rag/core/types.py

@dataclass(frozen=True)
class ChunkID:
    """Immutable chunk identifier."""
    value: str  # SHA256(source_uri + byte_range)

    @staticmethod
    def from_content(source_uri: str, start: int, end: int) -> "ChunkID":
        ...

@dataclass
class RawChunk:
    """Pre-scrubbing chunk."""
    id: ChunkID
    text: str
    source_uri: str
    corpus_type: CorpusType
    byte_range: tuple[int, int]
    metadata: dict[str, Any]

@dataclass
class CleanChunk:
    """Post-scrubbing chunk, safe for storage."""
    id: ChunkID
    text: str  # PHI removed
    source_uri: str
    corpus_type: CorpusType
    context_prefix: str  # file > class > function
    metadata: dict[str, Any]
    scrub_log: list[ScrubAction]  # Audit trail

@dataclass
class EmbeddedChunk:
    """Chunk with vector embedding."""
    chunk: CleanChunk
    vector: list[float]  # 768-dim

class CorpusType(Enum):
    CODE_LOGIC = "CODE_LOGIC"
    CODE_TEST = "CODE_TEST"
    DOC_README = "DOC_README"
    DOC_DESIGN = "DOC_DESIGN"
    CONVO_SLACK = "CONVO_SLACK"
    CONVO_TRANSCRIPT = "CONVO_TRANSCRIPT"
```

**Verification:** Type checker passes, all fields documented, invariants clear.

#### 0.2 Define Storage Protocols
```python
# rag/core/protocols.py

from typing import Protocol, AsyncIterator

class VectorStore(Protocol):
    """Protocol for vector similarity search."""

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id."""
        ...

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> int:
        """Batch insert. Returns count inserted."""
        ...

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Similarity search. Returns ranked results."""
        ...

    async def delete(self, chunk_id: ChunkID) -> bool:
        """Delete by ID. Returns True if existed."""
        ...


class GraphStore(Protocol):
    """Protocol for knowledge graph operations."""

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add or update entity. Returns ID."""
        ...

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add directed edge. Returns ID."""
        ...

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Semantic entity search."""
        ...

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """Graph traversal."""
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Ingest text, extract entities. Returns extracted."""
        ...
```

**Verification:** Protocol completeness - can every use case be expressed?

#### 0.3 Define Processing Protocols
```python
# rag/core/protocols.py (continued)

class Chunker(Protocol):
    """Protocol for content chunking."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks from content."""
        ...


class Scrubber(Protocol):
    """Protocol for PHI removal."""

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log."""
        ...

    def scrub_batch(self, chunks: list[RawChunk]) -> list[CleanChunk]:
        """Batch scrubbing for efficiency."""
        ...


class Embedder(Protocol):
    """Protocol for vector embedding."""

    def embed(self, text: str) -> list[float]:
        """Single text to vector."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding for efficiency."""
        ...

    @property
    def dimension(self) -> int:
        """Vector dimension (e.g., 768)."""
        ...


class Crawler(Protocol):
    """Protocol for source crawling."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield content from source."""
        ...
```

**Verification:** Interface sufficiency - every pipeline stage covered.

#### 0.4 Define Entity Schema
```python
# rag/core/schema.py

class EntityType(Enum):
    SERVICE = "Service"      # Microservice
    PERSON = "Person"        # Team member
    INCIDENT = "Incident"    # Production incident
    DECISION = "Decision"    # Architecture decision
    ENDPOINT = "Endpoint"    # API endpoint
    QUEUE = "Queue"          # Message queue
    DATABASE = "Database"    # Data store
    FILE = "File"            # Source file
    FUNCTION = "Function"    # Code function/method

class RelationType(Enum):
    CALLS = "CALLS"              # Service → Service
    PUBLISHES_TO = "PUBLISHES_TO"  # Service → Queue
    SUBSCRIBES_TO = "SUBSCRIBES_TO" # Service → Queue
    READS_FROM = "READS_FROM"    # Service → Database
    WRITES_TO = "WRITES_TO"      # Service → Database
    OWNS = "OWNS"                # Person → Service
    MENTIONS = "MENTIONS"        # Conversation → Entity
    CAUSED = "CAUSED"            # Change → Incident
    RESOLVED = "RESOLVED"        # Person → Incident
    IMPORTS = "IMPORTS"          # File → Module
    CONTAINS = "CONTAINS"        # File → Function

@dataclass
class Entity:
    id: EntityID
    type: EntityType
    name: str
    properties: dict[str, Any]
    source_refs: list[str]  # Where this entity was found

@dataclass
class Relationship:
    id: RelationshipID
    type: RelationType
    source_id: EntityID
    target_id: EntityID
    properties: dict[str, Any]
    timestamp: datetime | None
```

**Verification:** Schema completeness - all domain concepts captured.

#### 0.5 Define Error Types
```python
# rag/core/errors.py

class RAGError(Exception):
    """Base error for RAG system."""
    pass

class ChunkingError(RAGError):
    """Failed to chunk content."""
    source_uri: str
    reason: str

class ScrubError(RAGError):
    """PHI scrubbing failed."""
    chunk_id: ChunkID
    reason: str

class StorageError(RAGError):
    """Storage operation failed."""
    operation: str
    reason: str

class EmbeddingError(RAGError):
    """Embedding failed."""
    text_preview: str
    reason: str
```

**Verification:** Error taxonomy covers all failure modes.

### Phase 0 Verification Checklist

- [ ] All types are immutable or clearly mutable
- [ ] All protocols have docstrings specifying behavior
- [ ] No protocol method has side effects not mentioned in name
- [ ] Every async method that could fail has error type documented
- [ ] Entity/Relationship schema covers all design doc examples
- [ ] Type checker passes with strict mode

---

## Phase 1: Chunking Pipeline

**Deliverable:** Working chunkers for code, markdown, and conversations. Tested locally.

**Dependencies:** tree-sitter (local install), no network required.

### Tasks

#### 1.1 Token Counter
```python
# rag/chunking/token_counter.py

class TokenCounter:
    """Model-aligned token counting."""

    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
        self._tokenizer = AutoTokenizer.from_pretrained(model_name)

    def count(self, text: str) -> int:
        """Count tokens in text."""
        return len(self._tokenizer.encode(text, add_special_tokens=False))

    def truncate(self, text: str, max_tokens: int) -> str:
        """Truncate to max tokens, preserving whole words."""
        ...
```

**Tests:**
```python
def test_count_simple():
    tc = TokenCounter()
    assert tc.count("hello world") > 0

def test_count_code():
    tc = TokenCounter()
    code = "def foo(x): return x + 1"
    assert tc.count(code) == expected_token_count

def test_truncate_preserves_meaning():
    tc = TokenCounter()
    long_text = "..." * 1000
    truncated = tc.truncate(long_text, 100)
    assert tc.count(truncated) <= 100
```

**Verification:** Token counts match model's actual tokenization.

#### 1.2 AST Chunker (tree-sitter)
```python
# rag/chunking/ast_chunker.py

class ASTChunker:
    """Chunk code using tree-sitter AST."""

    SUPPORTED_LANGUAGES = {"python", "go", "typescript", "csharp"}

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = 512,
        overlap_tokens: int = 50,
    ):
        self._counter = token_counter
        self._max = max_tokens
        self._overlap = overlap_tokens
        self._parsers: dict[str, Parser] = {}

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str,
    ) -> Iterator[RawChunk]:
        """Yield chunks at function/class boundaries."""
        tree = self._parse(content, language)

        for node in self._walk_top_level(tree.root_node):
            chunk_text = content[node.start_byte:node.end_byte].decode()

            if self._counter.count(chunk_text) <= self._max:
                yield self._make_chunk(node, chunk_text, source_uri, language)
            else:
                # Split large functions
                yield from self._split_large_node(node, content, source_uri, language)

    def _walk_top_level(self, node: Node) -> Iterator[Node]:
        """Yield function/class/method nodes."""
        ...

    def _make_chunk(self, node: Node, text: str, uri: str, lang: str) -> RawChunk:
        """Create chunk with proper metadata."""
        ...
```

**Tests:**
```python
def test_chunks_at_function_boundaries():
    chunker = ASTChunker(TokenCounter())
    code = b'''
def foo():
    pass

def bar():
    pass
'''
    chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))
    assert len(chunks) == 2
    assert "foo" in chunks[0].text
    assert "bar" in chunks[1].text

def test_splits_large_functions():
    chunker = ASTChunker(TokenCounter(), max_tokens=50)
    code = b'def huge(): ' + b'x = 1\n' * 100
    chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))
    assert len(chunks) > 1
    for chunk in chunks:
        assert TokenCounter().count(chunk.text) <= 50 + 10  # Some tolerance
```

**Verification:** Chunks never exceed max tokens, boundaries align with AST.

#### 1.3 Markdown Chunker
```python
# rag/chunking/md_chunker.py

class MarkdownChunker:
    """Chunk markdown at heading boundaries."""

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = 512,
    ):
        self._counter = token_counter
        self._max = max_tokens

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks at heading boundaries."""
        text = content.decode("utf-8")
        sections = self._split_by_headings(text)

        for section in sections:
            if self._counter.count(section.text) <= self._max:
                yield self._make_chunk(section, source_uri)
            else:
                yield from self._split_large_section(section, source_uri)
```

**Verification:** Headings preserved, code blocks not split mid-block.

#### 1.4 Thread Chunker (Conversations)
```python
# rag/chunking/thread_chunker.py

class ThreadChunker:
    """Chunk conversations preserving thread context."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks per thread or message group."""
        messages = self._parse_messages(content)

        for thread in self._group_by_thread(messages):
            thread_text = self._format_thread(thread)

            if self._counter.count(thread_text) <= self._max:
                yield self._make_chunk(thread, source_uri)
            else:
                yield from self._split_thread(thread, source_uri)
```

**Verification:** Thread context preserved, speaker attribution maintained.

### Phase 1 Verification Checklist

- [ ] All chunkers implement Chunker protocol
- [ ] Token counts verified against model tokenizer
- [ ] No chunk exceeds max_tokens
- [ ] Chunks have valid byte ranges
- [ ] Context prefix (file > class > function) computed correctly
- [ ] Unit tests pass with real tree-sitter

---

## Phase 2: PHI Scrubbing

**Deliverable:** Working PHI scrubber with consistent pseudonymization. Testable with synthetic data.

**Dependencies:** Presidio (local), spaCy model (download once).

### Tasks

#### 2.1 Scrubber Core
```python
# rag/scrubbing/scrubber.py

class PresidioScrubber:
    """PHI scrubbing using Presidio."""

    def __init__(self, pseudonymizer: Pseudonymizer):
        self._analyzer = AnalyzerEngine()
        self._anonymizer = AnonymizerEngine()
        self._pseudonymizer = pseudonymizer

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk."""
        # Analyze for PII
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=["PERSON", "EMAIL", "PHONE_NUMBER", "US_SSN"],
            language="en",
        )

        # Build anonymization config
        operators = self._build_operators(results)

        # Anonymize
        anonymized = self._anonymizer.anonymize(
            text=chunk.text,
            analyzer_results=results,
            operators=operators,
        )

        return CleanChunk(
            id=chunk.id,
            text=anonymized.text,
            source_uri=chunk.source_uri,
            corpus_type=chunk.corpus_type,
            context_prefix=chunk.metadata.get("context_prefix", ""),
            metadata=chunk.metadata,
            scrub_log=self._build_audit_log(results),
        )
```

**Tests:**
```python
def test_scrubs_email():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = RawChunk(text="Contact john@example.com for help", ...)
    clean = scrubber.scrub(chunk)
    assert "john@example.com" not in clean.text
    assert "@" not in clean.text or "example.com" not in clean.text

def test_scrubs_phone():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = RawChunk(text="Call me at 555-123-4567", ...)
    clean = scrubber.scrub(chunk)
    assert "555-123-4567" not in clean.text
```

#### 2.2 Pseudonymizer (Consistent Replacement)
```python
# rag/scrubbing/pseudonymizer.py

class Pseudonymizer:
    """Consistent fake data generation."""

    def __init__(self, seed: int = 42):
        self._faker = Faker()
        self._faker.seed_instance(seed)
        self._cache: dict[str, str] = {}  # Original → Replacement

    def get_replacement(self, original: str, entity_type: str) -> str:
        """Get consistent replacement for original value."""
        cache_key = f"{entity_type}:{original}"

        if cache_key not in self._cache:
            self._cache[cache_key] = self._generate(entity_type)

        return self._cache[cache_key]

    def _generate(self, entity_type: str) -> str:
        """Generate fake data by type."""
        generators = {
            "PERSON": self._faker.name,
            "EMAIL": self._faker.email,
            "PHONE_NUMBER": self._faker.phone_number,
        }
        return generators.get(entity_type, lambda: "[REDACTED]")()
```

**Verification:** Same input always produces same output (deterministic).

### Phase 2 Verification Checklist

- [ ] All PII types from design doc detected
- [ ] Pseudonymization is deterministic (same input → same output)
- [ ] Audit log captures what was replaced
- [ ] Code identifiers NOT scrubbed (function names, etc.)
- [ ] Tests with synthetic PII pass

---

## Phase 3: LanceDB Store

**Deliverable:** Working vector store with LanceDB. Fully testable locally.

**Dependencies:** LanceDB (embedded, no server needed).

### Tasks

#### 3.1 LanceDB Store Implementation
```python
# rag/indexing/lance_store.py

class LanceStore:
    """LanceDB implementation of VectorStore protocol."""

    def __init__(self, db_path: str = "./data/lance"):
        self._db = lancedb.connect(db_path)
        self._table: Table | None = None

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id."""
        await self._ensure_table()

        record = {
            "id": chunk.chunk.id.value,
            "text": chunk.chunk.text,
            "vector": chunk.vector,
            "source_uri": chunk.chunk.source_uri,
            "corpus_type": chunk.chunk.corpus_type.value,
            "context_prefix": chunk.chunk.context_prefix,
            **chunk.chunk.metadata,
        }

        await self._table.add([record])

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Vector similarity search."""
        query = self._table.search(query_vector).limit(limit)

        if filters:
            query = query.where(self._build_filter(filters))

        results = await query.to_list()
        return [self._to_search_result(r) for r in results]
```

**Tests:**
```python
@pytest.fixture
def lance_store(tmp_path):
    return LanceStore(db_path=str(tmp_path / "test.lance"))

async def test_insert_and_search(lance_store):
    chunk = make_embedded_chunk("hello world", [0.1] * 768)
    await lance_store.insert(chunk)

    results = await lance_store.search([0.1] * 768, limit=1)
    assert len(results) == 1
    assert results[0].chunk.text == "hello world"

async def test_filter_by_corpus_type(lance_store):
    await lance_store.insert(make_embedded_chunk("code", corpus_type=CorpusType.CODE_LOGIC))
    await lance_store.insert(make_embedded_chunk("doc", corpus_type=CorpusType.DOC_README))

    results = await lance_store.search(
        [0.1] * 768,
        filters={"corpus_type": "CODE_LOGIC"},
    )
    assert all(r.chunk.corpus_type == CorpusType.CODE_LOGIC for r in results)
```

#### 3.2 Embedder Implementation
```python
# rag/indexing/embedder.py

class CodeRankEmbedder:
    """Embedder using CodeRankEmbed model."""

    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
        self._model = SentenceTransformer(model_name)

    def embed(self, text: str) -> list[float]:
        """Single text to vector."""
        return self._model.encode(text).tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding."""
        return self._model.encode(texts).tolist()

    @property
    def dimension(self) -> int:
        return 768
```

### Phase 3 Verification Checklist

- [ ] LanceStore implements VectorStore protocol
- [ ] Insert is idempotent (same ID doesn't duplicate)
- [ ] Search returns results sorted by similarity
- [ ] Filters work correctly
- [ ] Deletion works
- [ ] Embedder dimension matches schema

---

## Phase 4: Graph Store Abstraction

**Deliverable:** GraphStore protocol + MockGraphStore. Graphiti adapter interface defined.

**Why Mocks:** This is the critical phase for vibe coding. You can't spin up Neo4j, so we build everything against mocks, then swap in real Graphiti later.

### Tasks

#### 4.1 Mock Graph Store
```python
# rag/graphiti/mock_store.py

class MockGraphStore:
    """In-memory GraphStore for testing."""

    def __init__(self):
        self._entities: dict[EntityID, Entity] = {}
        self._relationships: dict[RelationshipID, Relationship] = {}
        self._entity_index: dict[str, list[EntityID]] = {}  # name → IDs

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add entity to in-memory store."""
        self._entities[entity.id] = entity
        self._entity_index.setdefault(entity.name.lower(), []).append(entity.id)
        return entity.id

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add relationship."""
        rel_id = RelationshipID(f"{source.value}-{rel_type.value}-{target.value}")
        self._relationships[rel_id] = Relationship(
            id=rel_id,
            type=rel_type,
            source_id=source,
            target_id=target,
            properties=properties,
            timestamp=datetime.now(),
        )
        return rel_id

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Simple substring search for testing."""
        query_lower = query.lower()
        matches = []

        for entity in self._entities.values():
            if query_lower in entity.name.lower():
                if entity_types is None or entity.type in entity_types:
                    matches.append(entity)

        return matches[:limit]

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """BFS graph traversal."""
        results = []
        visited = {entity_id}
        frontier = [entity_id]

        for _ in range(max_hops):
            next_frontier = []
            for eid in frontier:
                for rel in self._relationships.values():
                    neighbor_id = None
                    if direction in ("out", "both") and rel.source_id == eid:
                        neighbor_id = rel.target_id
                    if direction in ("in", "both") and rel.target_id == eid:
                        neighbor_id = rel.source_id

                    if neighbor_id and neighbor_id not in visited:
                        if rel_types is None or rel.type in rel_types:
                            visited.add(neighbor_id)
                            next_frontier.append(neighbor_id)
                            results.append((self._entities[neighbor_id], rel))

            frontier = next_frontier

        return results

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Mock: extract entities using simple regex patterns."""
        # This is a simplified mock - real Graphiti uses LLM
        entities = []

        # Simple service detection (mock)
        service_pattern = r'\b(\w+-service|\w+-api)\b'
        for match in re.finditer(service_pattern, text):
            entity = Entity(
                id=EntityID(f"service:{match.group(1)}"),
                type=EntityType.SERVICE,
                name=match.group(1),
                properties={},
                source_refs=[source],
            )
            await self.add_entity(entity)
            entities.append(entity)

        return entities
```

**Tests:** Exhaustive protocol compliance tests.

#### 4.2 Graphiti Adapter (Interface Only)
```python
# rag/graphiti/client.py

class GraphitiStore:
    """Graphiti implementation of GraphStore protocol.

    NOTE: This requires Neo4j + LLM API to function.
    Use MockGraphStore for offline testing.
    """

    def __init__(
        self,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        llm_client: Any,  # OpenAI or Anthropic client
    ):
        self._graphiti = Graphiti(
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
        )
        self._graphiti.llm_client = llm_client

    async def add_entity(self, entity: Entity) -> EntityID:
        """Delegate to Graphiti."""
        # Convert our Entity to Graphiti's format
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Let Graphiti extract entities via LLM."""
        result = await self._graphiti.add_episode(
            name=f"episode:{hash(text)}",
            episode_body=text,
            source_description=source,
            reference_time=timestamp or datetime.now(),
        )
        return self._convert_entities(result)
```

#### 4.3 Graph Store Factory
```python
# rag/graphiti/factory.py

def create_graph_store(config: Config) -> GraphStore:
    """Factory for GraphStore implementations.

    Use mock for testing, real for production.
    """
    if config.use_mock_graph:
        return MockGraphStore()

    return GraphitiStore(
        neo4j_uri=config.neo4j_uri,
        neo4j_user=config.neo4j_user,
        neo4j_password=config.neo4j_password,
        llm_client=config.llm_client,
    )
```

### Phase 4 Verification Checklist

- [ ] MockGraphStore implements GraphStore protocol completely
- [ ] All protocol methods have test coverage
- [ ] Graph traversal (get_neighbors) works correctly
- [ ] Entity search returns expected results
- [ ] GraphitiStore interface matches protocol (may not run without Neo4j)
- [ ] Factory correctly selects implementation

---

## Phase 5: Retrieval Layer

**Deliverable:** Hybrid retrieval combining vector and graph search. Testable with mocks.

### Tasks

#### 5.1 Hybrid Retriever
```python
# rag/retrieval/hybrid.py

class HybridRetriever:
    """Combines vector and graph search."""

    def __init__(
        self,
        vector_store: VectorStore,
        graph_store: GraphStore,
        embedder: Embedder,
        reranker: Reranker | None = None,
    ):
        self._vector = vector_store
        self._graph = graph_store
        self._embedder = embedder
        self._reranker = reranker

    async def search(
        self,
        query: str,
        *,
        top_k: int = 10,
        expand_graph: bool = True,
    ) -> list[SearchResult]:
        """Hybrid search: vector + graph expansion."""

        # 1. Vector search
        query_vector = self._embedder.embed(query)
        vector_results = await self._vector.search(query_vector, limit=top_k)

        if not expand_graph:
            return vector_results[:top_k]

        # 2. Entity search
        entities = await self._graph.search_entities(query, limit=5)

        # 3. Graph expansion
        expanded_entities = []
        for entity in entities:
            neighbors = await self._graph.get_neighbors(
                entity.id,
                rel_types=[RelationType.CALLS, RelationType.OWNS, RelationType.MENTIONS],
                max_hops=2,
            )
            expanded_entities.extend([e for e, _ in neighbors])

        # 4. Fetch chunks for expanded entities
        entity_names = [e.name for e in expanded_entities]
        graph_results = await self._vector.search(
            query_vector,
            filters={"service_name": entity_names},
            limit=top_k,
        )

        # 5. Merge and rerank
        all_results = self._merge_results(vector_results, graph_results)

        if self._reranker:
            all_results = self._reranker.rerank(all_results, query)

        return all_results[:top_k]
```

#### 5.2 Reranker
```python
# rag/retrieval/reranker.py

class Reranker:
    """Rerank results by relevance."""

    def rerank(
        self,
        results: list[SearchResult],
        query: str,
    ) -> list[SearchResult]:
        """Rerank using cross-encoder or simple scoring."""
        # Simple implementation: use original scores
        # Could upgrade to cross-encoder later

        # Deduplicate by chunk ID
        seen = set()
        unique = []
        for r in results:
            if r.chunk.id not in seen:
                seen.add(r.chunk.id)
                unique.append(r)

        # Sort by score
        return sorted(unique, key=lambda r: r.score, reverse=True)
```

### Phase 5 Verification Checklist

- [ ] Vector-only search works
- [ ] Graph expansion finds related entities
- [ ] Results are deduplicated
- [ ] Reranking preserves best results
- [ ] Full integration test with MockGraphStore passes

---

## Phase 6: Crawlers

**Deliverable:** Crawlers for code, docs, and conversations. Testable with local files.

### Tasks

#### 6.1 Code Crawler
```python
# rag/crawlers/code.py

class CodeCrawler:
    """Crawl git repositories for code files."""

    SUPPORTED_EXTENSIONS = {".py", ".go", ".ts", ".cs", ".js"}

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield code files from source."""
        if source.type == "git_repo":
            yield from self._crawl_repo(source.path)
        elif source.type == "directory":
            yield from self._crawl_directory(source.path)

    def _crawl_repo(self, repo_path: str) -> Iterator[CrawlResult]:
        """Walk repo, respecting .gitignore."""
        repo = git.Repo(repo_path)

        for item in repo.tree().traverse():
            if item.type == "blob" and self._should_include(item.path):
                yield CrawlResult(
                    content=item.data_stream.read(),
                    source_uri=f"{repo_path}:{item.path}",
                    language=self._detect_language(item.path),
                    metadata={"repo": repo_path, "path": item.path},
                )
```

#### 6.2 Docs Crawler
```python
# rag/crawlers/docs.py

class DocsCrawler:
    """Crawl markdown documentation."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield markdown files."""
        for path in Path(source.path).rglob("*.md"):
            yield CrawlResult(
                content=path.read_bytes(),
                source_uri=str(path),
                language=None,
                metadata={"type": "markdown"},
            )
```

#### 6.3 Conversation Crawler
```python
# rag/crawlers/conversation.py

class ConversationCrawler:
    """Crawl Slack exports or transcript files."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield conversation threads."""
        if source.type == "slack_export":
            yield from self._crawl_slack(source.path)
        elif source.type == "transcript":
            yield from self._crawl_transcript(source.path)
```

### Phase 6 Verification Checklist

- [ ] Code crawler respects .gitignore
- [ ] Language detection works
- [ ] Docs crawler finds nested markdown
- [ ] Conversation crawler preserves threads
- [ ] All crawlers implement Crawler protocol

---

## Phase 7: Orchestrator

**Deliverable:** End-to-end pipeline tying everything together. Testable with mocks.

### Tasks

#### 7.1 Ingestion Orchestrator
```python
# rag/pipeline/orchestrator.py

class IngestionOrchestrator:
    """Orchestrate full ingestion pipeline."""

    def __init__(
        self,
        crawler: Crawler,
        chunker: Chunker,
        scrubber: Scrubber,
        embedder: Embedder,
        vector_store: VectorStore,
        graph_store: GraphStore,
    ):
        self._crawler = crawler
        self._chunker = chunker
        self._scrubber = scrubber
        self._embedder = embedder
        self._vector = vector_store
        self._graph = graph_store

    async def ingest(self, source: CrawlSource) -> IngestionStats:
        """Run full ingestion pipeline."""
        stats = IngestionStats()

        for crawl_result in self._crawler.crawl(source):
            try:
                # Chunk
                chunks = list(self._chunker.chunk(
                    crawl_result.content,
                    source_uri=crawl_result.source_uri,
                    language=crawl_result.language,
                ))
                stats.chunks_created += len(chunks)

                # Scrub
                clean_chunks = [self._scrubber.scrub(c) for c in chunks]
                stats.chunks_scrubbed += len(clean_chunks)

                # Embed
                texts = [c.text for c in clean_chunks]
                vectors = self._embedder.embed_batch(texts)
                embedded = [
                    EmbeddedChunk(chunk=c, vector=v)
                    for c, v in zip(clean_chunks, vectors)
                ]

                # Store vectors
                await self._vector.insert_batch(embedded)
                stats.chunks_stored += len(embedded)

                # Extract relationships for graph
                await self._ingest_to_graph(crawl_result, clean_chunks)

            except Exception as e:
                stats.errors.append(f"{crawl_result.source_uri}: {e}")

        return stats

    async def _ingest_to_graph(
        self,
        crawl_result: CrawlResult,
        chunks: list[CleanChunk],
    ) -> None:
        """Add relationships to graph store."""
        if crawl_result.language:
            # Code: extract via AST
            imports = extract_imports(crawl_result.content, crawl_result.language)
            calls = detect_service_calls(crawl_result.content, crawl_result.language)

            for imp in imports:
                await self._graph.add_episode(
                    f"{crawl_result.source_uri} imports {imp.module}",
                    source="ast_analysis",
                )
            for call in calls:
                await self._graph.add_episode(
                    f"{crawl_result.source_uri} calls {call.target}",
                    source="ast_analysis",
                )
        else:
            # Text: let graph store extract entities
            for chunk in chunks:
                await self._graph.add_episode(
                    chunk.text,
                    source=chunk.source_uri,
                )
```

### Phase 7 Verification Checklist

- [ ] Full pipeline runs with all mocks
- [ ] Stats accurately reflect work done
- [ ] Errors are collected, not thrown
- [ ] Code and text paths both work
- [ ] Integration test with real files passes

---

## Phase 8: Graphiti Integration

**Deliverable:** Real Graphiti working with Neo4j. Production ready.

**This is the ONLY phase requiring external services.**

### Tasks

#### 8.1 Neo4j Setup
- Docker compose for local Neo4j
- Or Neo4j Aura cloud setup
- Connection validation

#### 8.2 Graphiti Client Validation
```python
async def test_graphiti_real():
    """Integration test with real Neo4j."""
    store = GraphitiStore(
        neo4j_uri=os.environ["NEO4J_URI"],
        neo4j_user=os.environ["NEO4J_USER"],
        neo4j_password=os.environ["NEO4J_PASSWORD"],
        llm_client=anthropic.Anthropic(),
    )

    # Test entity extraction
    entities = await store.add_episode(
        "The auth-service calls user-service for authentication.",
        source="test",
    )

    assert any(e.name == "auth-service" for e in entities)
    assert any(e.name == "user-service" for e in entities)
```

#### 8.3 Migration from Mock Data
- Export MockGraphStore state
- Import to Graphiti
- Validate entity/relationship counts

### Phase 8 Verification Checklist

- [ ] Neo4j connection works
- [ ] Graphiti entity extraction functions
- [ ] All MockGraphStore tests pass with GraphitiStore
- [ ] End-to-end ingestion works
- [ ] Hybrid retrieval produces quality results

---

## Control Flow Diagrams

### Ingestion Flow

```
CrawlSource
    │
    ▼
┌─────────┐
│ Crawler │  ─────► CrawlResult (content, uri, language)
└─────────┘
    │
    ▼
┌─────────┐
│ Chunker │  ─────► RawChunk[] (text, byte_range, metadata)
└─────────┘
    │
    ▼
┌──────────┐
│ Scrubber │  ────► CleanChunk[] (text, scrub_log)
└──────────┘
    │
    ├─────────────────────────┐
    │                         │
    ▼                         ▼
┌──────────┐             ┌────────────┐
│ Embedder │             │ GraphStore │
└──────────┘             │ (episode)  │
    │                    └────────────┘
    ▼                         │
┌─────────────┐               │
│ VectorStore │               │
│  (insert)   │               │
└─────────────┘               │
    │                         │
    └─────────┬───────────────┘
              │
              ▼
         IngestionStats
```

### Retrieval Flow

```
Query (string)
    │
    ├─────────────────────────┐
    │                         │
    ▼                         ▼
┌──────────┐             ┌────────────┐
│ Embedder │             │ GraphStore │
│ (embed)  │             │  (search)  │
└──────────┘             └────────────┘
    │                         │
    ▼                         ▼
┌─────────────┐          ┌────────────┐
│ VectorStore │          │ get_neighbors │
│  (search)   │          │  (expand)  │
└─────────────┘          └────────────┘
    │                         │
    │    vector_results       │    entity_names
    │                         │
    └─────────┬───────────────┘
              │
              ▼
         ┌────────┐
         │ Merge  │
         └────────┘
              │
              ▼
         ┌──────────┐
         │ Reranker │
         └──────────┘
              │
              ▼
         SearchResult[]
```

---

## Dependency Graph

```
              ┌────────────────┐
              │ core/types.py  │
              │ core/protocols │
              │ core/schema    │
              │ core/errors    │
              └───────┬────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│ chunking/ │  │ scrubbing/│  │ indexing/ │
│           │  │           │  │           │
│ ast       │  │ scrubber  │  │ embedder  │
│ md        │  │ pseudo    │  │ lance     │
│ thread    │  │           │  │           │
│ tokens    │  │           │  │           │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │
      └──────────────┼──────────────┘
                     │
                     ▼
              ┌────────────┐
              │  graphiti/ │
              │            │
              │  mock      │
              │  client    │
              │  factory   │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ retrieval/ │
              │            │
              │ hybrid     │
              │ reranker   │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ crawlers/  │
              │            │
              │ code       │
              │ docs       │
              │ convo      │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ pipeline/  │
              │            │
              │ orchestrator│
              └────────────┘
```

---

## Verification Summary

### Track A (MVP) - Dagster + LlamaIndex + Graphiti

| Phase | Custom Lines | Dagster Asset | External Dep |
|-------|--------------|---------------|--------------|
| 1 | ~0 | - | Dagster |
| 2 | ~50 | `raw_code_files` | git |
| 3 | ~20 | `code_chunks` | LlamaIndex |
| 4 | ~350 | `service_relations` | tree-sitter (multi-lang) |
| 5 | ~30 | `vector_index` | LanceDB |
| 6 | ~50 | `knowledge_graph` | Graphiti + Neo4j Aura |
| 7 | ~100 | `retriever` | - |

**MVP Total: ~600 custom lines**

### Track B (Post-MVP)

| Phase | Custom Lines | Dagster Asset | External Dep |
|-------|--------------|---------------|--------------|
| 8 | ~50 | `clean_chunks` | Presidio |
| 9 | ~80 | `conversation_docs` | - |

---

## Build Order

### MVP Path (Phases 1-7)
```
1. Project Setup      → pip install dagster llama-index graphiti-core lancedb
2. Repo Crawler       → @asset raw_code_files
3. Code Chunks        → @asset code_chunks (LlamaIndex CodeSplitter)
4. Service Extractor  → @asset service_relations (custom tree-sitter)
5. Vector Index       → @asset vector_index (LanceDB)
6. Knowledge Graph    → @asset knowledge_graph (Graphiti)
7. Hybrid Retriever   → Query both stores
```

**At Phase 7:** `dagster dev` shows full pipeline, search works.

### Post-MVP Path (Phases 8-9)
```
8. PHI Scrubbing      → Insert clean_chunks asset between chunks and index
9. Conversations      → Add conversation_docs asset, feeds into graph
```
