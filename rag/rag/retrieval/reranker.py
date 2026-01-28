"""Cross-encoder reranker for improving retrieval precision.

Uses a pre-trained cross-encoder model to score query-document pairs
and reorder candidates by relevance.
"""

from __future__ import annotations

from typing import Any

from sentence_transformers import CrossEncoder


class Reranker:
    """Cross-encoder reranker using MS MARCO MiniLM.

    Scores each (query, chunk.text) pair and re-sorts by relevance score.
    More accurate than bi-encoder similarity but slower.
    """

    MODEL_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def __init__(self, model_path: str | None = None) -> None:
        """Initialize the reranker with a cross-encoder model.

        Args:
            model_path: Path to a local model or HuggingFace model name.
                       Defaults to MODEL_NAME.
        """
        self._model: CrossEncoder = CrossEncoder(model_path or self.MODEL_NAME)

    def rerank(
        self,
        query: str,
        candidates: list[dict[str, Any]],
        top_k: int | None = None,
    ) -> list[dict[str, Any]]:
        """Score each candidate and re-sort by relevance.

        Args:
            query: The query text.
            candidates: List of chunk dictionaries with "text" field.
            top_k: Maximum number of results to return. If None, returns all.

        Returns:
            Candidates sorted by rerank_score descending.
            Each dict has "rerank_score" field added.
        """
        if not candidates:
            return []

        # Build query-document pairs
        pairs: list[tuple[str, str]] = [
            (query, c.get("text", "")) for c in candidates
        ]

        # Score all pairs
        scores: Any = self._model.predict(pairs)

        # Attach scores to candidates
        for candidate, score in zip(candidates, scores):
            candidate["rerank_score"] = float(score)

        # Sort by rerank score descending
        ranked = sorted(
            candidates,
            key=lambda c: c.get("rerank_score", 0),
            reverse=True,
        )

        if top_k is not None:
            ranked = ranked[:top_k]

        return ranked
