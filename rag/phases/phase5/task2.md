# Task 5.2: Reranker

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement result reranking for deduplication and relevance ordering.

## File

`rag/retrieval/reranker.py`

## Implementation

```python
from rag.core.protocols import SearchResult

class Reranker:
    """Rerank search results for optimal ordering.

    Responsibilities:
    1. Deduplicate by chunk ID
    2. Sort by score
    3. (Future) Cross-encoder reranking
    """

    def rerank(
        self,
        results: list[SearchResult],
        query: str,
    ) -> list[SearchResult]:
        """Rerank results by relevance.

        Args:
            results: Search results to rerank
            query: Original query (for potential cross-encoder use)

        Returns:
            Reranked results, deduplicated and sorted
        """
        # Deduplicate by chunk ID, keeping highest score
        seen: dict[str, SearchResult] = {}
        for result in results:
            chunk_id = result.chunk.id.value
            if chunk_id not in seen or result.score > seen[chunk_id].score:
                seen[chunk_id] = result

        # Sort by score (descending)
        unique_results = list(seen.values())
        unique_results.sort(key=lambda r: r.score, reverse=True)

        return unique_results

    def rerank_with_boost(
        self,
        results: list[SearchResult],
        query: str,
        boost_terms: list[str],
        boost_factor: float = 1.2,
    ) -> list[SearchResult]:
        """Rerank with term boosting.

        Args:
            results: Search results to rerank
            query: Original query
            boost_terms: Terms that should boost score if present
            boost_factor: Multiplier for matching results

        Returns:
            Reranked results with boosted scores
        """
        boosted = []
        for result in results:
            text_lower = result.chunk.text.lower()
            has_boost = any(term.lower() in text_lower for term in boost_terms)

            if has_boost:
                new_score = result.score * boost_factor
                boosted.append(SearchResult(
                    chunk=result.chunk,
                    score=new_score,
                    distance=result.distance,
                ))
            else:
                boosted.append(result)

        return self.rerank(boosted, query)


class CrossEncoderReranker(Reranker):
    """Reranker using cross-encoder for semantic relevance.

    More accurate than bi-encoder similarity but slower.
    Use for final reranking of top candidates.
    """

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        """Initialize with cross-encoder model.

        Args:
            model_name: HuggingFace model name
        """
        try:
            from sentence_transformers import CrossEncoder
            self._model = CrossEncoder(model_name)
            self._enabled = True
        except Exception:
            self._enabled = False

    def rerank(
        self,
        results: list[SearchResult],
        query: str,
    ) -> list[SearchResult]:
        """Rerank using cross-encoder scores."""
        # First deduplicate
        results = super().rerank(results, query)

        if not self._enabled or not results:
            return results

        # Score with cross-encoder
        pairs = [(query, r.chunk.text) for r in results]
        scores = self._model.predict(pairs)

        # Create new results with cross-encoder scores
        reranked = []
        for result, score in zip(results, scores):
            reranked.append(SearchResult(
                chunk=result.chunk,
                score=float(score),
                distance=1.0 - float(score),
            ))

        # Sort by new scores
        reranked.sort(key=lambda r: r.score, reverse=True)
        return reranked
```

## Tests

```python
def test_deduplicates_by_chunk_id():
    r1 = make_search_result("chunk-1", score=0.8)
    r2 = make_search_result("chunk-1", score=0.9)  # Same chunk, higher score
    r3 = make_search_result("chunk-2", score=0.7)

    reranker = Reranker()
    results = reranker.rerank([r1, r2, r3], "query")

    assert len(results) == 2
    # Should keep higher score for chunk-1
    chunk_1_result = next(r for r in results if r.chunk.id.value == "chunk-1")
    assert chunk_1_result.score == 0.9

def test_sorts_by_score_descending():
    results = [
        make_search_result("a", score=0.5),
        make_search_result("b", score=0.9),
        make_search_result("c", score=0.7),
    ]

    reranker = Reranker()
    reranked = reranker.rerank(results, "query")

    scores = [r.score for r in reranked]
    assert scores == sorted(scores, reverse=True)

def test_boost_terms_increase_score():
    results = [
        make_search_result("a", text="authentication login", score=0.5),
        make_search_result("b", text="database query", score=0.6),
    ]

    reranker = Reranker()
    reranked = reranker.rerank_with_boost(
        results, "query",
        boost_terms=["authentication"],
        boost_factor=1.5,
    )

    # Authentication result should now be first
    assert "authentication" in reranked[0].chunk.text

def test_empty_results():
    reranker = Reranker()
    results = reranker.rerank([], "query")
    assert results == []
```

## Acceptance Criteria

- [ ] Deduplicates by chunk ID, keeping highest score
- [ ] Sorts by score descending
- [ ] Term boosting works correctly
- [ ] Empty input returns empty output
- [ ] CrossEncoderReranker falls back gracefully if model unavailable

## Estimated Time

25 minutes
