# Phase 6: Retrieval Pipeline — Query, RRF, Reranker, Freshness, Graph Expansion

**Depends on:** Phase 5 (Embedding & Storage — need populated stores to query)
**Unlocks:** Phase 7 (Orchestration & Deployment — retrieval is the core API)

**Reference:** DESIGN.md Sections 7.1–7.6

---

## 1. Scope

Build the unified query interface that combines dense search, dual BM25
search, reciprocal rank fusion, cross-encoder reranking, freshness
weighting, and graph expansion into a single `query()` function. This is
what the query server (Phase 7) wraps in an HTTP endpoint.

### In scope

- `QueryRequest` and `QueryResult` dataclasses
- `RetrievalPipeline` class that orchestrates the full query flow
- Reciprocal Rank Fusion (RRF) implementation
- Cross-encoder reranker integration (`ms-marco-MiniLM-L-6-v2`)
- Conversation freshness weighting (exponential decay)
- Graph expansion (enrich results with service neighborhood)
- Corpus-type-aware query boosting (keyword-based heuristic)

### Out of scope

- Building/populating the index (Phase 5)
- HTTP server / CLI (Phase 7)
- Incremental ingestion logic (Phase 7)

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── retrieval/
│   │   ├── __init__.py
│   │   ├── pipeline.py           # RetrievalPipeline (orchestrates full query)
│   │   ├── fusion.py             # RRF implementation
│   │   ├── reranker.py           # Cross-encoder reranker wrapper
│   │   ├── freshness.py          # Conversation freshness weighting
│   │   └── query_boost.py        # Corpus-type boosting heuristic
│   ├── models/
│   │   └── query.py              # QueryRequest, QueryResult, ScoredChunk
├── tests/
│   ├── test_fusion.py
│   ├── test_reranker.py
│   ├── test_freshness.py
│   ├── test_query_boost.py
│   ├── test_retrieval_pipeline.py  # integration test with populated stores
│   └── fixtures/
│       └── retrieval/
│           └── sample_index/       # pre-built small index for query tests
```

---

## 3. Implementation Details

### 3.1 Query Types

```python
@dataclass
class QueryRequest:
    text: str
    corpus_filter: list[str] | None = None
    service_filter: str | None = None
    repo_filter: list[str] | None = None
    top_k: int = 20
    expand_graph: bool = False
    freshness_half_life_days: float = 90.0
    freshness_weight: float = 0.1
    rerank: bool = True           # can disable for latency-sensitive paths

@dataclass
class ScoredChunk:
    """A chunk with its retrieval scores at each stage."""
    id: str
    text: str
    context_prefix: str
    corpus_type: str
    source_uri: str
    service_name: str | None
    repo_name: str | None
    file_path: str | None
    language: str | None
    symbol_name: str | None
    signature: str | None
    section_path: str | None
    author: str | None
    timestamp: str | None
    channel: str | None
    # Scores
    dense_score: float | None = None
    bm25_code_score: float | None = None
    bm25_nlp_score: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None
    final_score: float = 0.0

@dataclass
class ServiceContext:
    """Graph neighborhood for a service."""
    service_name: str
    calls: list[str]
    called_by: list[str]
    edges: list[dict]

@dataclass
class QueryResult:
    chunks: list[ScoredChunk]
    service_context: dict[str, ServiceContext] | None = None
    query_metadata: dict | None = None   # timing, counts, etc.
```

### 3.2 `RetrievalPipeline`

```python
class RetrievalPipeline:
    """Orchestrates the full retrieval flow.

    Components are injected, not created — this class is testable
    with mocks for any individual stage.
    """

    def __init__(
        self,
        embedder: CodeRankEmbedder,
        lance_store: LanceStore,
        bm25_store: BM25Store,
        service_graph: ServiceGraph,
        reranker: Reranker | None = None,
    ):
        self._embedder = embedder
        self._lance = lance_store
        self._bm25 = bm25_store
        self._graph = service_graph
        self._reranker = reranker

    def query(self, req: QueryRequest) -> QueryResult:
        fetch_k = req.top_k * 3   # overfetch for fusion

        # 1. Dense search
        query_vec = self._embedder.embed_query(req.text)
        dense_hits = self._lance.search(
            query_vec,
            top_k=fetch_k,
            corpus_filter=req.corpus_filter,
            service_filter=req.service_filter,
            repo_filter=req.repo_filter,
        )

        # 2. Dual BM25 search
        code_tokens = tokenize_code(req.text, CODE_TOKENIZER)
        nlp_tokens = tokenize_code(req.text, NLP_TOKENIZER)
        bm25_code_hits = self._bm25.query(code_tokens, top_k=fetch_k)
        bm25_nlp_hits = self._bm25.query(nlp_tokens, top_k=fetch_k)

        # 3. RRF fusion
        fused = reciprocal_rank_fusion(
            dense_hits, bm25_code_hits, bm25_nlp_hits,
            k=60,
        )

        # 4. Apply post-hoc filters to BM25 results
        fused = self._apply_filters(fused, req)

        # 5. Rerank (optional)
        if req.rerank and self._reranker and len(fused) > 0:
            fused = self._reranker.rerank(req.text, fused[:50])

        # 6. Freshness weighting
        if req.freshness_weight > 0 and req.freshness_half_life_days > 0:
            fused = apply_freshness_boost(
                fused,
                half_life_days=req.freshness_half_life_days,
                boost_weight=req.freshness_weight,
            )

        # 7. Corpus-type boost
        fused = apply_corpus_boost(req.text, fused)

        # 8. Graph expansion
        service_context = None
        if req.expand_graph:
            services = extract_services_from_results(fused[:req.top_k])
            service_context = self._graph.get_neighborhood(services)

        # 9. Build result
        scored = [self._to_scored_chunk(hit) for hit in fused[:req.top_k]]
        return QueryResult(
            chunks=scored,
            service_context=service_context,
        )
```

### 3.3 Reciprocal Rank Fusion (`rag/retrieval/fusion.py`)

```python
def reciprocal_rank_fusion(
    dense_hits: list[dict],
    bm25_code_hits: list[tuple[str, float]],
    bm25_nlp_hits: list[tuple[str, float]],
    k: int = 60,
) -> list[dict]:
    """Merge three ranked lists using RRF (k=60).

    dense_hits: list of dicts from LanceDB search (has "id", "_distance")
    bm25_*_hits: list of (chunk_id, bm25_score) tuples

    Returns: unified list of dicts sorted by RRF score descending.
    """
    scores: dict[str, dict] = {}

    # Dense results (rank by ascending distance)
    for rank, hit in enumerate(dense_hits):
        cid = hit["id"]
        if cid not in scores:
            scores[cid] = {"item": hit, "rrf_score": 0.0}
        scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)
        scores[cid]["item"]["dense_rank"] = rank

    # BM25 code results
    for rank, (cid, bm25_score) in enumerate(bm25_code_hits):
        if cid not in scores:
            # Need to fetch full record from LanceDB (or skip if not in dense)
            continue  # Only fuse if chunk appeared in at least one dense result
            # Alternative: maintain a chunk cache
        scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)

    # BM25 NLP results
    for rank, (cid, bm25_score) in enumerate(bm25_nlp_hits):
        if cid in scores:
            scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)

    ranked = sorted(scores.values(), key=lambda x: x["rrf_score"], reverse=True)
    for entry in ranked:
        entry["item"]["rrf_score"] = entry["rrf_score"]
    return [entry["item"] for entry in ranked]
```

**Design note on BM25 chunk resolution:** BM25 returns chunk IDs, not full
records. Two approaches:

1. **Lazy (current):** Only fuse chunks that appeared in the dense results.
   BM25-only hits are lost. Acceptable because dense search has high recall.
2. **Eager:** Maintain a chunk_id → record cache, or fetch missing records
   from LanceDB by ID. More complete but adds latency.

Start with lazy. If recall is noticeably worse, switch to eager.

### 3.4 Cross-Encoder Reranker (`rag/retrieval/reranker.py`)

```python
from sentence_transformers import CrossEncoder

class Reranker:
    MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def __init__(self, model_path: str | None = None):
        self._model = CrossEncoder(model_path or self.MODEL_NAME)

    def rerank(
        self,
        query: str,
        candidates: list[dict],
        top_k: int | None = None,
    ) -> list[dict]:
        """Score each (query, chunk.text) pair and re-sort."""
        pairs = [(query, c["text"]) for c in candidates]
        scores = self._model.predict(pairs)
        for candidate, score in zip(candidates, scores):
            candidate["rerank_score"] = float(score)
        ranked = sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)
        if top_k:
            ranked = ranked[:top_k]
        return ranked
```

### 3.5 Freshness Weighting (`rag/retrieval/freshness.py`)

```python
import math
from datetime import datetime, timezone

def apply_freshness_boost(
    results: list[dict],
    half_life_days: float = 90.0,
    boost_weight: float = 0.1,
) -> list[dict]:
    """Exponential decay boost for CONVO_* chunks only."""
    now = datetime.now(timezone.utc)
    for r in results:
        base_score = r.get("rerank_score", r.get("rrf_score", 0))
        if r.get("corpus_type", "").startswith("CONVO_") and r.get("timestamp"):
            ts = datetime.fromisoformat(r["timestamp"])
            age_days = max((now - ts).total_seconds() / 86400, 0)
            decay = math.exp(-0.693 * age_days / half_life_days)
            r["final_score"] = (1 - boost_weight) * base_score + boost_weight * decay
        else:
            r["final_score"] = base_score
    return sorted(results, key=lambda r: r["final_score"], reverse=True)
```

### 3.6 Corpus-Type Boost (`rag/retrieval/query_boost.py`)

Simple keyword-based heuristic that adjusts RRF scores based on query
characteristics. Not a model — just a multiplier.

```python
BOOST_RULES: list[tuple[list[str], list[str], float]] = [
    # (query_keywords, boosted_corpus_types, multiplier)
    (["deploy", "k8s", "pod", "container", "helm"],
     ["CODE_DEPLOY", "DOC_RUNBOOK"], 1.3),
    (["incident", "broke", "down", "outage", "alert"],
     ["CONVO_SLACK", "DOC_RUNBOOK"], 1.3),
    (["how to", "steps", "procedure", "guide"],
     ["DOC_RUNBOOK", "DOC_README"], 1.2),
]

def apply_corpus_boost(query: str, results: list[dict]) -> list[dict]:
    query_lower = query.lower()
    for keywords, corpus_types, multiplier in BOOST_RULES:
        if any(kw in query_lower for kw in keywords):
            for r in results:
                if r.get("corpus_type") in corpus_types:
                    r["final_score"] = r.get("final_score", r.get("rrf_score", 0)) * multiplier
    return sorted(results, key=lambda r: r.get("final_score", 0), reverse=True)
```

---

## 4. Testing Strategy

### 4.1 Unit Tests: `tests/test_fusion.py`

RRF is a pure function — easy to test with synthetic ranked lists.

| Test | What it verifies |
|------|-----------------|
| `test_single_list` | RRF with one list = same order |
| `test_two_lists_agreement` | Item ranked #1 in both lists → top RRF |
| `test_two_lists_disagreement` | Item #1 in list A, #10 in list B → still beats item #5 in both |
| `test_three_lists` | All three lists contribute to scores |
| `test_k_parameter` | Changing k shifts relative scores (but not order for dominant items) |
| `test_bm25_only_items_handled` | Items in BM25 but not dense → handled gracefully |
| `test_empty_list` | Empty input → empty output |
| `test_rrf_score_attached` | Output items have `rrf_score` field |
| `test_known_rrf_computation` | Hand-computed RRF for 3 items across 2 lists matches output |

### 4.2 Unit Tests: `tests/test_reranker.py`

| Test | What it verifies |
|------|-----------------|
| `test_rerank_changes_order` | Reranker reorders candidates (at least one swap) |
| `test_rerank_score_attached` | Output items have `rerank_score` field |
| `test_rerank_top_k` | Requesting top_k=5 returns exactly 5 |
| `test_relevant_chunk_ranked_higher` | A clearly relevant (query, chunk) pair scores higher than irrelevant one |
| `test_empty_candidates` | Empty input → empty output |

**Note:** Reranker tests require model download (~22MB). Mark with
`@pytest.mark.slow`. For fast tests, mock the CrossEncoder.

### 4.3 Unit Tests: `tests/test_freshness.py`

| Test | What it verifies |
|------|-----------------|
| `test_recent_convo_boosted` | CONVO chunk from 1 day ago scores higher than 1 year ago |
| `test_non_convo_unchanged` | CODE_LOGIC chunk → final_score == rerank_score (no boost) |
| `test_half_life_decay` | Chunk exactly half_life_days old → decay factor ~0.5 |
| `test_zero_weight_disables` | boost_weight=0 → all final_scores unchanged |
| `test_missing_timestamp_unchanged` | CONVO chunk without timestamp → treated as non-convo |
| `test_future_timestamp_no_boost` | Timestamp in the future → decay = 1.0 (max) |
| `test_ordering_preserved_for_non_convo` | Non-CONVO chunks maintain original order |

### 4.4 Unit Tests: `tests/test_query_boost.py`

| Test | What it verifies |
|------|-----------------|
| `test_deploy_keyword_boosts_deploy_chunks` | "k8s deployment" → CODE_DEPLOY boosted |
| `test_incident_keyword_boosts_slack` | "incident response" → CONVO_SLACK boosted |
| `test_no_keywords_no_boost` | "how does auth work" → no boost applied |
| `test_boost_multiplier_applied` | Known multiplier × score matches output |
| `test_boost_preserves_non_matching` | Non-matching corpus types unchanged |

### 4.5 Integration Tests: `tests/test_retrieval_pipeline.py`

Build a small index (20-50 chunks) from fixtures, then query it.

**Setup fixture:**

```python
@pytest.fixture
def populated_pipeline(tmp_path):
    """Build a small index with known chunks for retrieval testing."""
    chunks = [
        make_code_chunk("func GetUser(id string) User { return db.Find(id) }",
                        service_name="auth-service", symbol_name="GetUser"),
        make_code_chunk("func CreateOrder(item string) Order { http.Post(...) }",
                        service_name="order-service", calls_out=["payment-service"]),
        make_deploy_chunk("kind: Service\nname: auth-service\nport: 8080"),
        make_slack_chunk("auth-service is throwing 503s, checking user-service",
                         channel="incident", timestamp="2025-01-01T10:00:00Z"),
        make_doc_chunk("## Rollback Procedure\nRun kubectl rollback...",
                       section_path="## Deploy > ## Rollback"),
        # ... 15-20 more chunks covering various corpus types and services
    ]
    # Embed, index, finalize
    pipeline = build_test_pipeline(tmp_path, chunks)
    return pipeline
```

| Test | What it verifies |
|------|-----------------|
| `test_basic_query_returns_results` | Any query returns non-empty results |
| `test_code_query_finds_code` | "GetUser function" → top result is the GetUser chunk |
| `test_incident_query_finds_slack` | "auth-service 503" → Slack incident chunk in results |
| `test_deploy_query_finds_yaml` | "auth-service port" → deploy chunk in results |
| `test_corpus_filter` | Filter CODE_LOGIC → only code chunks in results |
| `test_service_filter` | Filter auth-service → only auth chunks |
| `test_repo_filter` | Filter repo → only that repo's chunks |
| `test_graph_expansion` | expand_graph=True → service_context populated |
| `test_top_k_respected` | top_k=3 → exactly 3 results |
| `test_rerank_disabled` | rerank=False → no rerank_score on results |
| `test_result_has_all_scores` | ScoredChunk has rrf_score, rerank_score, final_score |

---

## 5. Acceptance Criteria

- [ ] `RetrievalPipeline.query()` returns `QueryResult` for any valid query
- [ ] RRF correctly fuses 3 ranked lists (verified by hand-computed test)
- [ ] Cross-encoder reranker reorders candidates by relevance
- [ ] Freshness weighting boosts recent CONVO chunks, ignores non-CONVO
- [ ] Corpus-type boost adjusts scores based on query keywords
- [ ] Graph expansion returns service neighborhood when enabled
- [ ] Filters (corpus, service, repo) restrict results correctly
- [ ] All components are injectable (testable with mocks)
- [ ] All 35+ tests pass
- [ ] `mypy rag/retrieval/ --strict` passes

---

## 6. Dependencies (pip, this phase)

```
# Already installed from Phase 5:
sentence-transformers>=3.0    # also provides CrossEncoder
```

No new dependencies. The reranker uses `sentence_transformers.CrossEncoder`
which is part of the same package as the embedder.
