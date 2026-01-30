# Task 5.1: Hybrid Retriever

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement hybrid retrieval that combines vector similarity search with graph expansion.

## File

`rag/retrieval/hybrid.py`

## Implementation

```python
from typing import Any
from rag.core.types import CleanChunk
from rag.core.protocols import VectorStore, GraphStore, Embedder, SearchResult
from rag.core.schema import RelationType
from rag.retrieval.reranker import Reranker

class HybridRetriever:
    """Combines vector and graph search for comprehensive retrieval.

    Strategy:
    1. Embed query and do vector similarity search
    2. Search graph for matching entities
    3. Expand graph neighbors (services that call/are called by matches)
    4. Fetch chunks for expanded entities
    5. Merge, deduplicate, and rerank all results
    """

    def __init__(
        self,
        vector_store: VectorStore,
        graph_store: GraphStore,
        embedder: Embedder,
        reranker: Reranker | None = None,
    ):
        """Initialize hybrid retriever.

        Args:
            vector_store: Vector store for similarity search
            graph_store: Graph store for entity search and expansion
            embedder: Embedder for query vectorization
            reranker: Optional reranker for result ordering
        """
        self._vector = vector_store
        self._graph = graph_store
        self._embedder = embedder
        self._reranker = reranker or Reranker()

    async def search(
        self,
        query: str,
        *,
        top_k: int = 10,
        expand_graph: bool = True,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Hybrid search combining vector and graph.

        Args:
            query: Natural language search query
            top_k: Maximum number of results to return
            expand_graph: Whether to expand via graph neighbors
            filters: Optional filters (corpus_type, service_name, etc.)

        Returns:
            List of SearchResult sorted by relevance
        """
        if not query.strip():
            return []

        # 1. Vector search
        query_vector = self._embedder.embed(query)
        vector_results = await self._vector.search(
            query_vector,
            limit=top_k * 2,  # Get extra for merging
            filters=filters,
        )

        if not expand_graph:
            return vector_results[:top_k]

        # 2. Entity search in graph
        entities = await self._graph.search_entities(query, limit=5)

        # 3. Graph expansion - find related services
        expanded_entities = []
        for entity in entities:
            try:
                neighbors = await self._graph.get_neighbors(
                    entity.id,
                    rel_types=[RelationType.CALLS, RelationType.OWNS, RelationType.MENTIONS],
                    direction="both",
                    max_hops=2,
                )
                expanded_entities.extend([e for e, _ in neighbors])
            except Exception:
                # Entity not found or graph error - continue
                pass

        # 4. Fetch chunks for expanded entities
        graph_results = []
        if expanded_entities:
            entity_names = list(set(e.name for e in expanded_entities))
            # Search for chunks mentioning these entities
            for name in entity_names[:5]:  # Limit to avoid too many searches
                name_results = await self._vector.search(
                    self._embedder.embed(name),
                    limit=top_k,
                    filters=filters,
                )
                graph_results.extend(name_results)

        # 5. Merge and rerank
        all_results = self._merge_results(vector_results, graph_results)
        all_results = self._reranker.rerank(all_results, query)

        return all_results[:top_k]

    def _merge_results(
        self,
        vector_results: list[SearchResult],
        graph_results: list[SearchResult],
    ) -> list[SearchResult]:
        """Merge results, boosting graph-expanded matches."""
        seen_ids = set()
        merged = []

        # Vector results first (primary relevance)
        for result in vector_results:
            if result.chunk.id.value not in seen_ids:
                seen_ids.add(result.chunk.id.value)
                merged.append(result)

        # Graph results with slight score boost
        for result in graph_results:
            if result.chunk.id.value not in seen_ids:
                seen_ids.add(result.chunk.id.value)
                # Boost graph results slightly for diversity
                boosted = SearchResult(
                    chunk=result.chunk,
                    score=result.score * 0.9,  # Slight penalty vs direct match
                    distance=result.distance,
                )
                merged.append(boosted)

        return merged

    async def search_vector_only(
        self,
        query: str,
        *,
        top_k: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Vector-only search without graph expansion."""
        return await self.search(query, top_k=top_k, expand_graph=False, filters=filters)
```

## Tests

```python
@pytest.fixture
def hybrid_retriever(lance_store, mock_graph, embedder):
    return HybridRetriever(lance_store, mock_graph, embedder)

async def test_vector_search_returns_results(hybrid_retriever, indexed_chunks):
    results = await hybrid_retriever.search("authentication", expand_graph=False)
    assert len(results) > 0

async def test_empty_query_returns_empty(hybrid_retriever):
    results = await hybrid_retriever.search("")
    assert len(results) == 0
    results = await hybrid_retriever.search("   ")
    assert len(results) == 0

async def test_graph_expansion_finds_related(hybrid_retriever, indexed_services):
    # Query about auth should find user-service via graph
    results = await hybrid_retriever.search("authentication logic")
    files = {r.chunk.source_uri for r in results}
    # Should find both services due to CALLS relationship
    assert any("auth" in f for f in files)

async def test_filters_applied(hybrid_retriever, indexed_chunks):
    results = await hybrid_retriever.search(
        "user",
        filters={"corpus_type": "CODE_LOGIC"}
    )
    assert all(r.chunk.corpus_type.value == "CODE_LOGIC" for r in results)

async def test_top_k_respected(hybrid_retriever, indexed_chunks):
    results = await hybrid_retriever.search("code", top_k=5)
    assert len(results) <= 5
```

## Acceptance Criteria

- [ ] Vector search works standalone
- [ ] Graph expansion finds related entities
- [ ] Results are merged without duplicates
- [ ] Filters are applied correctly
- [ ] top_k limit is respected
- [ ] Empty query returns empty results

## Estimated Time

45 minutes
