"""Reciprocal Rank Fusion (RRF) for merging ranked lists.

Combines dense vector search and BM25 keyword search results into a
single unified ranking using the RRF algorithm.
"""

from __future__ import annotations

from typing import Any


def reciprocal_rank_fusion(
    dense_hits: list[dict[str, Any]],
    bm25_code_hits: list[tuple[str, float]],
    bm25_nlp_hits: list[tuple[str, float]],
    k: int = 60,
) -> list[dict[str, Any]]:
    """Merge three ranked lists using Reciprocal Rank Fusion.

    RRF score for document d across all rankings R:
        RRF(d) = sum(1 / (k + rank(d, r)) for r in R if d in r)

    The parameter k (default 60) controls how quickly scores decrease
    with rank. Higher k makes the scores more uniform across ranks.

    Args:
        dense_hits: List of dicts from LanceDB search with "id" and "_distance".
        bm25_code_hits: List of (chunk_id, bm25_score) tuples from code tokenizer.
        bm25_nlp_hits: List of (chunk_id, bm25_score) tuples from NLP tokenizer.
        k: RRF parameter (default 60 per original paper).

    Returns:
        Unified list of dicts sorted by RRF score descending.
        Each dict has an "rrf_score" field added.
    """
    if not dense_hits and not bm25_code_hits and not bm25_nlp_hits:
        return []

    scores: dict[str, dict[str, Any]] = {}

    # Dense results (rank by ascending distance - lower is better)
    for rank, hit in enumerate(dense_hits):
        cid = hit["id"]
        if cid not in scores:
            scores[cid] = {"item": hit.copy(), "rrf_score": 0.0}
        scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)
        scores[cid]["item"]["dense_rank"] = rank
        scores[cid]["item"]["dense_score"] = hit.get("_distance")

    # BM25 code results
    # Only fuse if chunk appeared in dense results (lazy approach)
    for rank, (cid, bm25_score) in enumerate(bm25_code_hits):
        if cid in scores:
            scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)
            scores[cid]["item"]["bm25_code_rank"] = rank
            scores[cid]["item"]["bm25_code_score"] = bm25_score

    # BM25 NLP results
    for rank, (cid, bm25_score) in enumerate(bm25_nlp_hits):
        if cid in scores:
            scores[cid]["rrf_score"] += 1.0 / (k + rank + 1)
            scores[cid]["item"]["bm25_nlp_rank"] = rank
            scores[cid]["item"]["bm25_nlp_score"] = bm25_score

    # Sort by RRF score descending
    ranked = sorted(scores.values(), key=lambda x: x["rrf_score"], reverse=True)

    # Attach rrf_score to items
    for entry in ranked:
        entry["item"]["rrf_score"] = entry["rrf_score"]

    return [entry["item"] for entry in ranked]
