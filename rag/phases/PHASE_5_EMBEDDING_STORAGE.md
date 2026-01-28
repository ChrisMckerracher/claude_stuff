# Phase 5: Embedding & Storage — CodeRankEmbed, LanceDB, BM25, Service Graph

**Depends on:** Phase 1 (Foundation), Phase 4 (PHI Scrubbing — need CleanChunks)
**Unlocks:** Phase 6 (Retrieval Pipeline)
**Can partially overlap with:** Phases 2–3 (crawlers), if using mock CleanChunks

**Reference:** DESIGN.md Sections 5, 6, 9

---

## 1. Scope

Build the storage layer: embed CleanChunks with CodeRankEmbed, store them
in LanceDB with full metadata, build the BM25 index with dual tokenization,
and construct the service dependency graph. After this phase, data is fully
indexed and ready for querying.

### In scope

- `CodeRankEmbedder` class satisfying the `Embedder` protocol
- `LanceStore` class for LanceDB read/write (create table, insert, delete, search)
- `BM25Store` class for bm25s index (build, query, serialize)
- `ServiceGraph` class (build from chunk metadata, serialize to JSON,
  query neighbors/blast radius)
- Service name resolution (`resolver.py`)
- `Indexer` implementation combining LanceStore + BM25Store + ServiceGraph
- PyArrow schema definition matching the Chunk dataclass
- `data/` directory layout creation

### Out of scope

- Query interface / RRF / reranker (Phase 6)
- CLI / pipeline orchestration (Phase 7)
- Docker (Phase 7)

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── indexing/
│   │   ├── embedder.py           # CodeRankEmbedder
│   │   ├── lance_store.py        # LanceDB read/write/delete/search
│   │   ├── bm25_store.py         # bm25s index build/query
│   │   └── indexer.py            # CompositeIndexer (combines all three)
│   ├── boundary/
│   │   ├── graph.py              # ServiceGraph construction + queries
│   │   └── resolver.py           # Service name resolution
├── tests/
│   ├── test_embedder.py
│   ├── test_lance_store.py
│   ├── test_bm25_store.py
│   ├── test_service_graph.py
│   ├── test_resolver.py
│   ├── test_indexer_integration.py
│   └── fixtures/
│       └── chunks/
│           └── sample_clean_chunks.py  # factory functions for test CleanChunks
```

---

## 3. Implementation Details

### 3.1 `CodeRankEmbedder`

```python
from sentence_transformers import SentenceTransformer

class CodeRankEmbedder:
    """Wraps CodeRankEmbed for batch embedding.

    Satisfies the Embedder protocol:
        embed_batch(chunks: list[CleanChunk]) -> list[EmbeddedChunk]
    """

    MODEL_NAME = "nomic-ai/CodeRankEmbed"
    QUERY_PREFIX = "Represent this query for searching relevant code: "

    def __init__(self, model_path: str | None = None, batch_size: int = 32):
        self._model = SentenceTransformer(
            model_path or self.MODEL_NAME,
            trust_remote_code=True,
        )
        self._batch_size = batch_size

    def embed_batch(self, chunks: list[CleanChunk]) -> list[EmbeddedChunk]:
        texts = [
            f"{c.context_prefix}\n{c.text}" for c in chunks
        ]
        vectors = self._model.encode(
            texts,
            batch_size=self._batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return [
            EmbeddedChunk(chunk=chunk, vector=vec.tolist())
            for chunk, vec in zip(chunks, vectors)
        ]

    def embed_query(self, query: str) -> list[float]:
        vec = self._model.encode(
            self.QUERY_PREFIX + query,
            normalize_embeddings=True,
        )
        return vec.tolist()
```

### 3.2 `LanceStore` — LanceDB Wrapper

```python
import lancedb
import pyarrow as pa

CHUNKS_SCHEMA = pa.schema([
    pa.field("id", pa.string()),
    pa.field("source_uri", pa.string()),
    pa.field("byte_start", pa.int64()),
    pa.field("byte_end", pa.int64()),
    pa.field("corpus_type", pa.string()),
    pa.field("text", pa.string()),
    pa.field("context_prefix", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 768)),
    pa.field("repo_name", pa.string()),
    pa.field("language", pa.string()),
    pa.field("symbol_name", pa.string()),
    pa.field("symbol_kind", pa.string()),
    pa.field("signature", pa.string()),
    pa.field("file_path", pa.string()),
    pa.field("git_hash", pa.string()),
    pa.field("section_path", pa.string()),
    pa.field("author", pa.string()),
    pa.field("timestamp", pa.string()),
    pa.field("channel", pa.string()),
    pa.field("thread_id", pa.string()),
    pa.field("imports", pa.list_(pa.string())),
    pa.field("calls_out", pa.list_(pa.string())),
    pa.field("called_by", pa.list_(pa.string())),
    pa.field("service_name", pa.string()),
])

class LanceStore:
    def __init__(self, db_path: str):
        self._db = lancedb.connect(db_path)
        self._table = None

    def create_or_open(self) -> None:
        if "chunks" in self._db.table_names():
            self._table = self._db.open_table("chunks")
        else:
            self._table = self._db.create_table("chunks", schema=CHUNKS_SCHEMA)

    def insert(self, chunks: list[EmbeddedChunk]) -> None:
        records = [self._to_record(c) for c in chunks]
        self._table.add(records)

    def delete_by_repo(self, repo_name: str) -> int:
        count_before = self._table.count_rows()
        self._table.delete(f"repo_name = '{repo_name}'")
        return count_before - self._table.count_rows()

    def delete_by_source_uri_prefix(self, prefix: str) -> int:
        count_before = self._table.count_rows()
        self._table.delete(f"source_uri LIKE '{prefix}%'")
        return count_before - self._table.count_rows()

    def search(
        self,
        vector: list[float],
        top_k: int = 40,
        corpus_filter: list[str] | None = None,
        service_filter: str | None = None,
        repo_filter: list[str] | None = None,
    ) -> list[dict]:
        q = self._table.search(vector).limit(top_k)
        filters = []
        if corpus_filter:
            types = ", ".join(f"'{t}'" for t in corpus_filter)
            filters.append(f"corpus_type IN ({types})")
        if service_filter:
            filters.append(f"service_name = '{service_filter}'")
        if repo_filter:
            repos = ", ".join(f"'{r}'" for r in repo_filter)
            filters.append(f"repo_name IN ({repos})")
        if filters:
            q = q.where(" AND ".join(filters))
        return q.to_list()

    def all_chunks(self) -> list[dict]:
        return self._table.to_pandas().to_dict("records")

    def count(self) -> int:
        return self._table.count_rows()
```

### 3.3 `BM25Store`

```python
import bm25s
import json

class BM25Store:
    """BM25 index with dual tokenization support.

    At index time: each chunk is tokenized with its corpus-appropriate
    tokenizer (code or NLP) per the SOURCE_TYPES registry.

    At query time: the query is tokenized with BOTH tokenizers,
    producing two result sets. Fusion happens in the retrieval layer.
    """

    def __init__(self):
        self._index = None
        self._doc_ids: list[str] = []

    def build(self, chunks: list[dict]) -> None:
        """Build BM25 index from all chunks in the store."""
        corpus = []
        self._doc_ids = []
        for chunk in chunks:
            tokenizer_kind = SOURCE_TYPES[chunk["corpus_type"]].bm25_tokenizer
            if tokenizer_kind == "code":
                tokens = tokenize_code(chunk["text"], CODE_TOKENIZER)
            else:
                tokens = tokenize_code(chunk["text"], NLP_TOKENIZER)
            corpus.append(tokens)
            self._doc_ids.append(chunk["id"])
        self._index = bm25s.BM25()
        self._index.index(corpus)

    def query(self, tokens: list[str], top_k: int = 40) -> list[tuple[str, float]]:
        """Query BM25, return (chunk_id, score) pairs."""
        results = self._index.retrieve(
            [tokens], k=top_k
        )
        return [
            (self._doc_ids[idx], score)
            for idx, score in zip(results.documents[0], results.scores[0])
            if idx < len(self._doc_ids)
        ]

    def save(self, path: str) -> None:
        self._index.save(path)
        with open(f"{path}/doc_ids.json", "w") as f:
            json.dump(self._doc_ids, f)

    def load(self, path: str) -> None:
        self._index = bm25s.BM25.load(path)
        with open(f"{path}/doc_ids.json") as f:
            self._doc_ids = json.load(f)
```

### 3.4 `ServiceGraph`

```python
import json
import networkx as nx

@dataclass
class ServiceNode:
    name: str
    repo_name: str | None
    language: str | None
    k8s_namespace: str | None
    ports: list[int]
    deploy_chunk_ids: list[str]

@dataclass
class ServiceEdge:
    source: str       # calling service
    target: str       # called service
    edge_type: str    # "http", "queue", "db"
    evidence_chunk_ids: list[str]
    url_pattern: str | None

class ServiceGraph:
    def __init__(self):
        self._graph = nx.DiGraph()
        self._nodes: dict[str, ServiceNode] = {}
        self._edges: list[ServiceEdge] = []

    def build_from_chunks(
        self,
        chunks: list[dict],
        resolver: ServiceNameResolver,
    ) -> None:
        """Build graph from accumulated chunk metadata.

        1. Identify services from deploy chunks (kind=Service, kind=Deployment)
        2. Add edges from code chunks' calls_out
        3. Resolve raw hostnames to known service names
        """
        # Phase 1: Discover services from deploy chunks
        for chunk in chunks:
            if chunk["corpus_type"] == "CODE_DEPLOY" and chunk.get("service_name"):
                self._add_or_update_node(chunk)

        # Phase 2: Add edges from code calls_out
        for chunk in chunks:
            if chunk.get("calls_out") and chunk.get("service_name"):
                for raw_target in chunk["calls_out"]:
                    resolved = resolver.resolve(raw_target, self._nodes)
                    if resolved:
                        self._add_edge(chunk["service_name"], resolved, chunk)

    def get_neighborhood(
        self, service_names: list[str], depth: int = 1
    ) -> dict:
        """Return upstream + downstream neighbors within N hops."""
        result = {}
        for name in service_names:
            if name not in self._graph:
                continue
            upstream = list(self._graph.predecessors(name))
            downstream = list(self._graph.successors(name))
            result[name] = {
                "calls": downstream,
                "called_by": upstream,
                "edges": self._get_edges_for(name),
            }
        return result

    def blast_radius(self, service_name: str) -> set[str]:
        """Transitive closure of dependents. If this service goes
        down, which services are affected?"""
        return nx.ancestors(self._graph, service_name)

    def save(self, path: str) -> None:
        data = {
            "nodes": {k: asdict(v) for k, v in self._nodes.items()},
            "edges": [asdict(e) for e in self._edges],
        }
        with open(path, "w") as f:
            json.dump(data, f, indent=2)

    def load(self, path: str) -> None:
        with open(path) as f:
            data = json.load(f)
        # rebuild graph from serialized data
        ...
```

### 3.5 `CompositeIndexer`

```python
class CompositeIndexer:
    """Satisfies the Indexer protocol by composing LanceStore + BM25Store + ServiceGraph."""

    def __init__(self, output_dir: Path, resolver: ServiceNameResolver):
        self._lance = LanceStore(str(output_dir / "rag.lance"))
        self._bm25 = BM25Store()
        self._graph = ServiceGraph()
        self._resolver = resolver
        self._output_dir = output_dir
        self._lance.create_or_open()

    def index(self, chunks: list[EmbeddedChunk]) -> None:
        self._lance.insert(chunks)

    def delete_by_source(self, source: CrawlSource) -> int:
        if source.source_kind == SourceKind.REPO:
            return self._lance.delete_by_repo(source.repo_name or source.path.name)
        return self._lance.delete_by_source_uri_prefix(str(source.path))

    def finalize(self) -> None:
        all_chunks = self._lance.all_chunks()

        # Rebuild BM25 from all chunks
        self._bm25.build(all_chunks)
        self._bm25.save(str(self._output_dir / "bm25_index"))

        # Rebuild service graph from all chunks
        self._graph.build_from_chunks(all_chunks, self._resolver)
        self._graph.save(str(self._output_dir / "service_graph.json"))

    def all_chunks(self):
        return self._lance.all_chunks()
```

---

## 4. Testing Strategy

### 4.1 Test Utilities

Create a `tests/fixtures/chunks/sample_clean_chunks.py` with factory
functions that produce realistic CleanChunks without needing actual
crawlers or scrubbers:

```python
def make_code_chunk(text: str, **kwargs) -> CleanChunk:
    """Factory for CODE_LOGIC CleanChunks."""
    defaults = {
        "id": make_chunk_id("test.go", 0, len(text)),
        "source_type": SOURCE_TYPES["CODE_LOGIC"],
        "language": "go",
        "service_name": "auth-service",
        ...
    }
    defaults.update(kwargs)
    return CleanChunk(text=text, **defaults)

def make_slack_chunk(text: str, **kwargs) -> CleanChunk: ...
def make_deploy_chunk(text: str, **kwargs) -> CleanChunk: ...
```

### 4.2 Unit Tests: `tests/test_embedder.py`

| Test | What it verifies |
|------|-----------------|
| `test_embed_produces_768_dims` | Vector length is exactly 768 |
| `test_embed_batch_correct_count` | 5 chunks in → 5 EmbeddedChunks out |
| `test_embed_deterministic` | Same text → same vector |
| `test_embed_different_texts` | Different texts → different vectors (cosine sim < 0.99) |
| `test_embed_prepends_context` | Verify context_prefix is included (mock model to capture input) |
| `test_embed_query_has_prefix` | Query embedding includes instruction prefix |
| `test_embedded_chunk_wraps_clean` | `EmbeddedChunk.chunk` is the original CleanChunk |

**Note:** These tests require model download (~521MB). Mark with `@pytest.mark.slow`
and skip in CI unless explicitly enabled. For fast tests, use a mock model
that returns deterministic vectors.

### 4.3 Unit Tests: `tests/test_lance_store.py`

Use a temporary directory for each test (pytest `tmp_path` fixture).

| Test | What it verifies |
|------|-----------------|
| `test_create_table` | Table created with correct schema |
| `test_insert_and_count` | Insert 10 chunks → count is 10 |
| `test_insert_all_fields` | All metadata fields survive roundtrip |
| `test_search_returns_results` | Dense search on inserted vectors returns matches |
| `test_search_top_k` | Requesting top_k=5 returns ≤5 results |
| `test_search_corpus_filter` | Filter by CODE_LOGIC → only code chunks returned |
| `test_search_service_filter` | Filter by service_name → only that service |
| `test_search_repo_filter` | Filter by repo_name → only that repo |
| `test_delete_by_repo` | Delete by repo_name → only those chunks removed |
| `test_delete_returns_count` | Delete returns correct number of removed chunks |
| `test_all_chunks_roundtrip` | Insert → all_chunks() → matches original data |
| `test_empty_table` | Operations on empty table don't crash |
| `test_idempotent_create_or_open` | Calling create_or_open twice doesn't drop data |

### 4.4 Unit Tests: `tests/test_bm25_store.py`

| Test | What it verifies |
|------|-----------------|
| `test_build_index` | Building from 100 chunks succeeds |
| `test_query_code_tokens` | Code-tokenized query finds code chunk |
| `test_query_nlp_tokens` | NLP-tokenized query finds doc chunk |
| `test_camel_case_match` | Query "getUser" matches chunk containing "getUserProfile" |
| `test_snake_case_match` | Query "get_user" matches chunk containing "get_user_profile" |
| `test_top_k_limit` | Requesting 5 → returns ≤5 |
| `test_save_load_roundtrip` | Save to disk → load → same query results |
| `test_empty_query` | Empty token list returns empty results |
| `test_doc_ids_match` | Returned IDs are valid chunk IDs from the store |

### 4.5 Unit Tests: `tests/test_service_graph.py`

| Test | What it verifies |
|------|-----------------|
| `test_build_discovers_services` | Deploy chunks with service_name → nodes in graph |
| `test_build_creates_edges` | Code chunks with calls_out → edges between services |
| `test_get_neighborhood` | Neighbors of a service include upstream + downstream |
| `test_blast_radius` | Transitive closure correctly identifies all dependents |
| `test_save_load_roundtrip` | Save JSON → load → same graph structure |
| `test_empty_graph` | Operations on empty graph don't crash |
| `test_unknown_service_neighborhood` | Querying unknown service → empty result |

### 4.6 Unit Tests: `tests/test_resolver.py`

| Test | What it verifies |
|------|-----------------|
| `test_exact_match` | "auth-service" resolves to known "auth-service" |
| `test_strip_protocol_port` | "http://auth-service:8080" → "auth-service" |
| `test_partial_match` | "auth-svc" matches "auth-service" |
| `test_no_match` | "unknown-thing" → None |
| `test_url_path_stripped` | "http://user-service:8080/api/v1/users" → "user-service" |

### 4.7 Integration Test: `tests/test_indexer_integration.py`

| Test | What it verifies |
|------|-----------------|
| `test_full_index_flow` | Create indexer → index 50 chunks → finalize → data/ has all files |
| `test_lance_file_exists` | `data/rag.lance/` directory created |
| `test_bm25_files_exist` | `data/bm25_index/` with vocab, index, doc_ids |
| `test_service_graph_exists` | `data/service_graph.json` exists and is valid JSON |
| `test_delete_and_reindex` | Delete repo → re-index → counts correct |
| `test_finalize_rebuilds_bm25` | After delete + add, BM25 reflects new state |

---

## 5. Acceptance Criteria

- [ ] `CodeRankEmbedder` produces 768-dim normalized vectors
- [ ] LanceDB roundtrip preserves all chunk metadata fields
- [ ] LanceDB vector search returns relevant results (basic sanity check)
- [ ] LanceDB filtering by corpus_type, service_name, repo_name works
- [ ] LanceDB delete_by_repo removes correct chunks
- [ ] BM25 index handles dual tokenization (code + NLP)
- [ ] BM25 camelCase/snake_case splitting works correctly
- [ ] BM25 save/load roundtrip preserves index state
- [ ] Service graph builds from deploy + code chunk metadata
- [ ] Service graph neighborhood and blast_radius queries work
- [ ] `CompositeIndexer` orchestrates all three stores
- [ ] `data/` directory layout matches DESIGN.md Section 9
- [ ] All 40+ tests pass
- [ ] `mypy rag/indexing/ rag/boundary/graph.py rag/boundary/resolver.py --strict` passes

---

## 6. Dependencies (pip, this phase)

```
sentence-transformers>=3.0
torch>=2.0
lancedb>=0.8
pyarrow>=14.0
bm25s>=0.2
networkx>=3.0
```
