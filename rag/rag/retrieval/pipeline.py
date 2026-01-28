"""Retrieval pipeline orchestrating the full query flow.

Combines dense search, BM25 search, RRF fusion, reranking,
freshness weighting, corpus boosting, and graph expansion.
"""

from __future__ import annotations

import time
from typing import Any

from rag.boundary.graph import ServiceGraph
from rag.indexing.bm25_store import BM25Store
from rag.indexing.embedder import CodeRankEmbedder
from rag.indexing.lance_store import LanceStore
from rag.indexing.tokenizer import CODE_TOKENIZER, NLP_TOKENIZER, tokenize
from rag.models.query import (
    QueryRequest,
    QueryResult,
    ScoredChunk,
    ServiceContext,
)
from rag.retrieval.freshness import apply_freshness_boost
from rag.retrieval.fusion import reciprocal_rank_fusion
from rag.retrieval.query_boost import apply_corpus_boost
from rag.retrieval.reranker import Reranker


class RetrievalPipeline:
    """Orchestrates the full retrieval flow.

    Components are injected, not created - this class is testable
    with mocks for any individual stage.
    """

    def __init__(
        self,
        embedder: CodeRankEmbedder,
        lance_store: LanceStore,
        bm25_store: BM25Store,
        service_graph: ServiceGraph,
        reranker: Reranker | None = None,
    ) -> None:
        """Initialize the retrieval pipeline.

        Args:
            embedder: CodeRankEmbedder for query embedding.
            lance_store: LanceStore for dense vector search.
            bm25_store: BM25Store for keyword search.
            service_graph: ServiceGraph for graph expansion.
            reranker: Optional Reranker for cross-encoder reranking.
        """
        self._embedder = embedder
        self._lance = lance_store
        self._bm25 = bm25_store
        self._graph = service_graph
        self._reranker = reranker

    def query(self, req: QueryRequest) -> QueryResult:
        """Execute a retrieval query through the full pipeline.

        Pipeline stages:
        1. Dense search (embed query, search LanceDB)
        2. Dual BM25 search (code + NLP tokenizers)
        3. RRF fusion (merge all rankings)
        4. Apply filters to fused results
        5. Cross-encoder reranking (optional)
        6. Freshness weighting (for conversation chunks)
        7. Corpus-type boosting
        8. Graph expansion (optional)

        Args:
            req: QueryRequest with query text and options.

        Returns:
            QueryResult with scored chunks and optional service context.
        """
        start_time = time.time()
        metadata: dict[str, Any] = {"stages": {}}

        # Overfetch for fusion (3x top_k)
        fetch_k = req.top_k * 3

        # Stage 1: Dense search
        stage_start = time.time()
        query_vec = self._embedder.embed_query(req.text)
        dense_hits = self._lance.search(
            query_vec,
            top_k=fetch_k,
            corpus_filter=req.corpus_filter,
            service_filter=req.service_filter,
            repo_filter=req.repo_filter,
        )
        metadata["stages"]["dense_search_ms"] = (time.time() - stage_start) * 1000
        metadata["dense_count"] = len(dense_hits)

        # Stage 2: Dual BM25 search
        stage_start = time.time()
        code_tokens = tokenize(req.text, CODE_TOKENIZER)
        nlp_tokens = tokenize(req.text, NLP_TOKENIZER)
        bm25_code_hits = self._bm25.query(code_tokens, top_k=fetch_k)
        bm25_nlp_hits = self._bm25.query(nlp_tokens, top_k=fetch_k)
        metadata["stages"]["bm25_search_ms"] = (time.time() - stage_start) * 1000
        metadata["bm25_code_count"] = len(bm25_code_hits)
        metadata["bm25_nlp_count"] = len(bm25_nlp_hits)

        # Stage 3: RRF fusion
        stage_start = time.time()
        fused = reciprocal_rank_fusion(
            dense_hits,
            bm25_code_hits,
            bm25_nlp_hits,
            k=60,
        )
        metadata["stages"]["rrf_fusion_ms"] = (time.time() - stage_start) * 1000
        metadata["fused_count"] = len(fused)

        # Stage 4: Apply post-hoc filters (BM25 results don't support filters)
        fused = self._apply_filters(fused, req)
        metadata["filtered_count"] = len(fused)

        # Stage 5: Reranking (optional)
        if req.rerank and self._reranker and len(fused) > 0:
            stage_start = time.time()
            # Rerank top 50 candidates
            fused = self._reranker.rerank(req.text, fused[:50])
            metadata["stages"]["rerank_ms"] = (time.time() - stage_start) * 1000
            metadata["reranked"] = True
        else:
            metadata["reranked"] = False

        # Stage 6: Freshness weighting
        if req.freshness_weight > 0 and req.freshness_half_life_days > 0:
            fused = apply_freshness_boost(
                fused,
                half_life_days=req.freshness_half_life_days,
                boost_weight=req.freshness_weight,
            )

        # Stage 7: Corpus-type boost
        fused = apply_corpus_boost(req.text, fused)

        # Stage 8: Graph expansion
        service_context: dict[str, ServiceContext] | None = None
        if req.expand_graph:
            stage_start = time.time()
            services = self._extract_services(fused[: req.top_k])
            raw_context = self._graph.get_neighborhood(services)
            service_context = {
                name: ServiceContext(
                    service_name=name,
                    calls=ctx.get("calls", []),
                    called_by=ctx.get("called_by", []),
                    edges=ctx.get("edges", []),
                )
                for name, ctx in raw_context.items()
            }
            metadata["stages"]["graph_expansion_ms"] = (
                time.time() - stage_start
            ) * 1000

        # Build final result
        scored_chunks = [self._to_scored_chunk(hit) for hit in fused[: req.top_k]]
        metadata["total_ms"] = (time.time() - start_time) * 1000

        return QueryResult(
            chunks=scored_chunks,
            service_context=service_context,
            query_metadata=metadata,
        )

    def _apply_filters(
        self,
        results: list[dict[str, Any]],
        req: QueryRequest,
    ) -> list[dict[str, Any]]:
        """Apply filters to results that came from BM25.

        Dense search already applies filters, but BM25 results need
        post-hoc filtering.

        Args:
            results: Fused results.
            req: Query request with filter criteria.

        Returns:
            Filtered results.
        """
        filtered = results

        if req.corpus_filter:
            filtered = [
                r for r in filtered if r.get("corpus_type") in req.corpus_filter
            ]

        if req.service_filter:
            filtered = [
                r for r in filtered if r.get("service_name") == req.service_filter
            ]

        if req.repo_filter:
            filtered = [
                r for r in filtered if r.get("repo_name") in req.repo_filter
            ]

        return filtered

    def _extract_services(self, results: list[dict[str, Any]]) -> list[str]:
        """Extract unique service names from results.

        Args:
            results: List of chunk dicts.

        Returns:
            List of unique service names.
        """
        services: set[str] = set()
        for r in results:
            svc = r.get("service_name")
            if svc:
                services.add(svc)
        return list(services)

    def _to_scored_chunk(self, hit: dict[str, Any]) -> ScoredChunk:
        """Convert a result dict to a ScoredChunk.

        Args:
            hit: Result dictionary from fusion/reranking.

        Returns:
            ScoredChunk with all fields populated.
        """
        return ScoredChunk(
            id=hit.get("id", ""),
            text=hit.get("text", ""),
            context_prefix=hit.get("context_prefix", ""),
            corpus_type=hit.get("corpus_type", ""),
            source_uri=hit.get("source_uri", ""),
            service_name=hit.get("service_name"),
            repo_name=hit.get("repo_name"),
            file_path=hit.get("file_path"),
            language=hit.get("language"),
            symbol_name=hit.get("symbol_name"),
            signature=hit.get("signature"),
            section_path=hit.get("section_path"),
            author=hit.get("author"),
            timestamp=hit.get("timestamp"),
            channel=hit.get("channel"),
            dense_score=hit.get("dense_score"),
            bm25_code_score=hit.get("bm25_code_score"),
            bm25_nlp_score=hit.get("bm25_nlp_score"),
            rrf_score=hit.get("rrf_score"),
            rerank_score=hit.get("rerank_score"),
            final_score=hit.get("final_score", 0.0),
        )
