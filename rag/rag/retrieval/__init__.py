"""Retrieval pipeline for RAG queries.

This module provides the unified query interface combining dense search,
BM25 search, reciprocal rank fusion, reranking, and result enrichment.
"""

from rag.retrieval.freshness import apply_freshness_boost
from rag.retrieval.fusion import reciprocal_rank_fusion
from rag.retrieval.pipeline import RetrievalPipeline
from rag.retrieval.query_boost import apply_corpus_boost
from rag.retrieval.reranker import Reranker

__all__ = [
    "RetrievalPipeline",
    "reciprocal_rank_fusion",
    "Reranker",
    "apply_freshness_boost",
    "apply_corpus_boost",
]
