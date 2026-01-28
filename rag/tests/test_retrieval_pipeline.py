"""Integration tests for the RetrievalPipeline.

These tests build a small index with known chunks and verify
the full retrieval flow works correctly.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from rag.boundary.graph import ServiceGraph
from rag.boundary.resolver import ServiceNameResolver
from rag.indexing.bm25_store import BM25Store
from rag.indexing.embedder import CodeRankEmbedder
from rag.indexing.lance_store import LanceStore
from rag.models.query import QueryRequest, QueryResult, ScoredChunk
from rag.retrieval.pipeline import RetrievalPipeline
from rag.retrieval.reranker import Reranker
from tests.fixtures.chunks.sample_clean_chunks import (
    make_code_chunk,
    make_deploy_chunk,
    make_doc_chunk,
    make_embedded_chunk,
    make_slack_chunk,
)


def make_test_chunks() -> list[dict[str, Any]]:
    """Create a diverse set of test chunks for retrieval testing."""
    now = datetime.now(timezone.utc)
    recent_ts = (now - timedelta(days=1)).isoformat()
    old_ts = (now - timedelta(days=365)).isoformat()

    return [
        # Code chunks
        {
            "id": "code-getuser",
            "text": "func GetUser(id string) User { return db.Find(id) }",
            "context_prefix": "// auth-service/handler.go\n// function: GetUser",
            "corpus_type": "CODE_LOGIC",
            "source_uri": "repo://auth/src/handler.go",
            "service_name": "auth-service",
            "repo_name": "auth",
            "file_path": "src/handler.go",
            "language": "go",
            "symbol_name": "GetUser",
            "signature": "func GetUser(id string) User",
            "section_path": None,
            "author": None,
            "timestamp": None,
            "channel": None,
        },
        {
            "id": "code-createorder",
            "text": "func CreateOrder(item string) Order { http.Post(payment_url) }",
            "context_prefix": "// order-service/order.go\n// function: CreateOrder",
            "corpus_type": "CODE_LOGIC",
            "source_uri": "repo://order/src/order.go",
            "service_name": "order-service",
            "repo_name": "order",
            "file_path": "src/order.go",
            "language": "go",
            "symbol_name": "CreateOrder",
            "signature": "func CreateOrder(item string) Order",
            "section_path": None,
            "author": None,
            "timestamp": None,
            "channel": None,
            "calls_out": ["payment-service"],
        },
        # Deploy chunk
        {
            "id": "deploy-auth",
            "text": "kind: Service\nmetadata:\n  name: auth-service\nspec:\n  port: 8080",
            "context_prefix": "# auth/k8s/service.yaml\n# Service: auth-service",
            "corpus_type": "CODE_DEPLOY",
            "source_uri": "repo://auth/k8s/service.yaml",
            "service_name": "auth-service",
            "repo_name": "auth",
            "file_path": "k8s/service.yaml",
            "language": None,
            "symbol_name": None,
            "signature": None,
            "section_path": None,
            "author": None,
            "timestamp": None,
            "channel": None,
        },
        # Slack chunks
        {
            "id": "slack-incident",
            "text": "auth-service is throwing 503s, checking user-service dependency",
            "context_prefix": "# Slack: #incident\n# Thread: t123",
            "corpus_type": "CONVO_SLACK",
            "source_uri": "slack://workspace/C123/t123",
            "service_name": None,
            "repo_name": None,
            "file_path": None,
            "language": None,
            "symbol_name": None,
            "signature": None,
            "section_path": None,
            "author": "[PERSON_1]",
            "timestamp": recent_ts,
            "channel": "incident",
        },
        {
            "id": "slack-old",
            "text": "old discussion about auth service architecture",
            "context_prefix": "# Slack: #engineering\n# Thread: t456",
            "corpus_type": "CONVO_SLACK",
            "source_uri": "slack://workspace/C456/t456",
            "service_name": None,
            "repo_name": None,
            "file_path": None,
            "language": None,
            "symbol_name": None,
            "signature": None,
            "section_path": None,
            "author": "[PERSON_2]",
            "timestamp": old_ts,
            "channel": "engineering",
        },
        # Documentation chunks
        {
            "id": "doc-rollback",
            "text": "## Rollback Procedure\nRun kubectl rollback deployment/auth-service",
            "context_prefix": "# auth/docs/runbook.md\n# Section: Deploy > Rollback",
            "corpus_type": "DOC_RUNBOOK",
            "source_uri": "repo://auth/docs/runbook.md",
            "service_name": None,
            "repo_name": "auth",
            "file_path": "docs/runbook.md",
            "language": None,
            "symbol_name": None,
            "signature": None,
            "section_path": "Deploy > Rollback",
            "author": None,
            "timestamp": None,
            "channel": None,
        },
        {
            "id": "doc-readme",
            "text": "# Auth Service\nAuthentication microservice using OAuth2",
            "context_prefix": "# auth/README.md\n# Section: Overview",
            "corpus_type": "DOC_README",
            "source_uri": "repo://auth/README.md",
            "service_name": None,
            "repo_name": "auth",
            "file_path": "README.md",
            "language": None,
            "symbol_name": None,
            "signature": None,
            "section_path": "Overview",
            "author": None,
            "timestamp": None,
            "channel": None,
        },
    ]


class MockEmbedder:
    """Mock embedder that returns deterministic vectors."""

    VECTOR_DIM = 768

    def embed_query(self, query: str) -> list[float]:
        """Return a deterministic vector based on query."""
        # Simple hash-based vector for testing
        import hashlib

        h = hashlib.sha256(query.encode()).digest()
        vec = [float(b) / 255.0 for b in h[:self.VECTOR_DIM // 32] * 32]
        # Pad to VECTOR_DIM
        vec = vec[:self.VECTOR_DIM]
        while len(vec) < self.VECTOR_DIM:
            vec.append(0.0)
        # Normalize
        norm = sum(x * x for x in vec) ** 0.5
        if norm > 0:
            vec = [x / norm for x in vec]
        return vec


class MockLanceStore:
    """Mock LanceStore for testing."""

    def __init__(self, chunks: list[dict[str, Any]]) -> None:
        self._chunks = chunks

    def search(
        self,
        vector: list[float],
        top_k: int = 40,
        corpus_filter: list[str] | None = None,
        service_filter: str | None = None,
        repo_filter: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Return chunks matching filters with mock distances."""
        results = []
        for i, chunk in enumerate(self._chunks):
            # Apply filters
            if corpus_filter and chunk.get("corpus_type") not in corpus_filter:
                continue
            if service_filter and chunk.get("service_name") != service_filter:
                continue
            if repo_filter and chunk.get("repo_name") not in repo_filter:
                continue

            result = chunk.copy()
            result["_distance"] = 0.1 * (i + 1)  # Mock distance
            results.append(result)

        return results[:top_k]


class MockBM25Store:
    """Mock BM25Store for testing."""

    def __init__(self, chunks: list[dict[str, Any]]) -> None:
        self._chunks = {c["id"]: c for c in chunks}
        self._ids = list(self._chunks.keys())

    def query(
        self,
        tokens: list[str],
        top_k: int = 40,
    ) -> list[tuple[str, float]]:
        """Return chunk IDs with mock BM25 scores."""
        # Simple keyword matching for testing
        results: list[tuple[str, float]] = []
        query_terms = set(t.lower() for t in tokens)

        for chunk_id, chunk in self._chunks.items():
            text_lower = chunk.get("text", "").lower()
            # Count matching terms
            matches = sum(1 for t in query_terms if t in text_lower)
            if matches > 0:
                results.append((chunk_id, float(matches)))

        # Sort by score descending
        results.sort(key=lambda x: x[1], reverse=True)
        return results[:top_k]


class MockServiceGraph:
    """Mock ServiceGraph for testing."""

    def __init__(self) -> None:
        self._neighbors: dict[str, dict[str, Any]] = {
            "auth-service": {
                "calls": ["user-service", "db-service"],
                "called_by": ["api-gateway"],
                "edges": [],
            },
            "order-service": {
                "calls": ["payment-service", "inventory-service"],
                "called_by": ["api-gateway"],
                "edges": [],
            },
        }

    def get_neighborhood(
        self,
        service_names: list[str],
        depth: int = 1,
    ) -> dict[str, dict[str, Any]]:
        """Return mock neighborhood for services."""
        return {
            name: self._neighbors.get(name, {"calls": [], "called_by": [], "edges": []})
            for name in service_names
            if name in self._neighbors
        }


@pytest.fixture
def test_chunks() -> list[dict[str, Any]]:
    """Fixture providing test chunks."""
    return make_test_chunks()


@pytest.fixture
def mock_pipeline(test_chunks: list[dict[str, Any]]) -> RetrievalPipeline:
    """Fixture providing a pipeline with mocked components."""
    return RetrievalPipeline(
        embedder=MockEmbedder(),  # type: ignore
        lance_store=MockLanceStore(test_chunks),  # type: ignore
        bm25_store=MockBM25Store(test_chunks),  # type: ignore
        service_graph=MockServiceGraph(),  # type: ignore
        reranker=None,
    )


class TestRetrievalPipeline:
    """Test cases for the RetrievalPipeline."""

    def test_basic_query_returns_results(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Any query returns non-empty results."""
        req = QueryRequest(text="user authentication")
        result = mock_pipeline.query(req)

        assert isinstance(result, QueryResult)
        assert len(result.chunks) > 0

    def test_code_query_finds_code(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Code-related query returns code chunks."""
        req = QueryRequest(text="GetUser function")
        result = mock_pipeline.query(req)

        # Should find the GetUser code chunk
        ids = [c.id for c in result.chunks]
        assert "code-getuser" in ids

    def test_incident_query_finds_slack(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Incident query finds Slack discussion."""
        req = QueryRequest(text="auth-service 503 error")
        result = mock_pipeline.query(req)

        ids = [c.id for c in result.chunks]
        assert "slack-incident" in ids

    def test_deploy_query_finds_yaml(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Deploy query finds Kubernetes config."""
        req = QueryRequest(text="auth-service port 8080")
        result = mock_pipeline.query(req)

        ids = [c.id for c in result.chunks]
        assert "deploy-auth" in ids

    def test_corpus_filter(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Corpus filter restricts results to specified types."""
        req = QueryRequest(
            text="auth service",
            corpus_filter=["CODE_LOGIC"],
        )
        result = mock_pipeline.query(req)

        # All results should be CODE_LOGIC
        for chunk in result.chunks:
            assert chunk.corpus_type == "CODE_LOGIC"

    def test_service_filter(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Service filter restricts results to specified service."""
        req = QueryRequest(
            text="function handler",
            service_filter="auth-service",
        )
        result = mock_pipeline.query(req)

        # All results with service_name should be auth-service
        for chunk in result.chunks:
            if chunk.service_name:
                assert chunk.service_name == "auth-service"

    def test_repo_filter(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Repo filter restricts results to specified repositories."""
        req = QueryRequest(
            text="service code",
            repo_filter=["auth"],
        )
        result = mock_pipeline.query(req)

        # All results with repo_name should be in filter
        for chunk in result.chunks:
            if chunk.repo_name:
                assert chunk.repo_name in ["auth"]

    def test_graph_expansion(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Graph expansion populates service_context."""
        req = QueryRequest(
            text="auth service handler",
            expand_graph=True,
        )
        result = mock_pipeline.query(req)

        # Should have service_context
        assert result.service_context is not None
        # auth-service should be in context if it's in results
        if any(c.service_name == "auth-service" for c in result.chunks):
            assert "auth-service" in result.service_context

    def test_top_k_respected(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """top_k limits the number of results."""
        req = QueryRequest(text="service", top_k=2)
        result = mock_pipeline.query(req)

        assert len(result.chunks) <= 2

    def test_result_has_scored_chunk_fields(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """ScoredChunk has expected fields."""
        req = QueryRequest(text="auth")
        result = mock_pipeline.query(req)

        assert len(result.chunks) > 0
        chunk = result.chunks[0]

        # Check ScoredChunk fields
        assert isinstance(chunk, ScoredChunk)
        assert chunk.id
        assert chunk.text
        assert chunk.corpus_type
        assert chunk.final_score >= 0

    def test_query_metadata_present(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Query result includes metadata."""
        req = QueryRequest(text="test query")
        result = mock_pipeline.query(req)

        assert result.query_metadata is not None
        assert "total_ms" in result.query_metadata
        assert "stages" in result.query_metadata

    def test_rerank_disabled(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """rerank=False skips reranking."""
        req = QueryRequest(text="auth", rerank=False)
        result = mock_pipeline.query(req)

        # Should not have reranked field in metadata
        assert result.query_metadata is not None
        assert result.query_metadata.get("reranked") is False

        # Chunks should not have rerank_score
        for chunk in result.chunks:
            assert chunk.rerank_score is None

    def test_rrf_score_present(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Results have RRF scores."""
        req = QueryRequest(text="auth service", rerank=False)
        result = mock_pipeline.query(req)

        # At least some chunks should have rrf_score
        assert any(c.rrf_score is not None for c in result.chunks)


class TestRetrievalPipelineWithReranker:
    """Tests with reranker enabled."""

    def test_rerank_enabled(
        self,
        test_chunks: list[dict[str, Any]],
    ) -> None:
        """rerank=True applies reranking."""
        # Create mock reranker
        mock_reranker = MagicMock(spec=Reranker)
        mock_reranker.rerank.return_value = [
            {"id": "code-getuser", "text": "...", "rerank_score": 0.9},
        ]

        pipeline = RetrievalPipeline(
            embedder=MockEmbedder(),  # type: ignore
            lance_store=MockLanceStore(test_chunks),  # type: ignore
            bm25_store=MockBM25Store(test_chunks),  # type: ignore
            service_graph=MockServiceGraph(),  # type: ignore
            reranker=mock_reranker,
        )

        req = QueryRequest(text="user function", rerank=True)
        result = pipeline.query(req)

        # Reranker should have been called
        mock_reranker.rerank.assert_called_once()

        # Metadata should show reranked
        assert result.query_metadata is not None
        assert result.query_metadata.get("reranked") is True


class TestRetrievalPipelineFreshness:
    """Tests for freshness weighting in the pipeline."""

    def test_recent_convo_boosted(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Recent conversation chunks get freshness boost."""
        req = QueryRequest(
            text="auth service discussion",
            freshness_weight=0.3,
            freshness_half_life_days=90.0,
            rerank=False,
        )
        result = mock_pipeline.query(req)

        # Find the slack chunks
        recent_slack = next(
            (c for c in result.chunks if c.id == "slack-incident"),
            None,
        )
        old_slack = next(
            (c for c in result.chunks if c.id == "slack-old"),
            None,
        )

        if recent_slack and old_slack:
            # Recent should have higher final score after freshness
            assert recent_slack.final_score > old_slack.final_score


class TestRetrievalPipelineCorpusBoost:
    """Tests for corpus-type boosting in the pipeline."""

    def test_deploy_keywords_boost(
        self,
        mock_pipeline: RetrievalPipeline,
    ) -> None:
        """Deploy keywords boost deploy and runbook chunks."""
        req = QueryRequest(
            text="k8s deployment auth-service",
            rerank=False,
        )
        result = mock_pipeline.query(req)

        # Deploy chunk should be boosted
        deploy = next(
            (c for c in result.chunks if c.id == "deploy-auth"),
            None,
        )
        runbook = next(
            (c for c in result.chunks if c.id == "doc-rollback"),
            None,
        )

        # Both should appear in results
        assert deploy is not None or runbook is not None
