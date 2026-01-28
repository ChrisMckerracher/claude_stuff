"""Tests for Deploy crawler."""

from pathlib import Path

import pytest

from rag.config import SOURCE_TYPES
from rag.crawlers.deploy import DeployCrawler
from rag.models.chunk import RawChunk
from rag.models.types import CrawlSource, SourceKind


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestDeployCrawlerProtocol:
    """Test DeployCrawler satisfies the Crawler protocol."""

    def test_corpus_types(self) -> None:
        """Test corpus_types property."""
        crawler = DeployCrawler()
        assert crawler.corpus_types == frozenset({"CODE_DEPLOY"})

    def test_crawl_yields_iterator(self) -> None:
        """Test crawl method returns an iterator."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        result = crawler.crawl(source)
        assert hasattr(result, "__iter__")
        assert hasattr(result, "__next__")


class TestDeployCrawlerYieldsChunks:
    """Test DeployCrawler yields RawChunks."""

    def test_deploy_crawler_yields_raw_chunks(self) -> None:
        """DeployCrawler on k8s fixtures yields RawChunks."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 4  # At least one per fixture file
        for chunk in chunks:
            assert isinstance(chunk, RawChunk)

    def test_all_chunks_have_code_deploy_type(self) -> None:
        """All chunks have CODE_DEPLOY source type."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type == SOURCE_TYPES["CODE_DEPLOY"]


class TestMultiDocumentSplit:
    """Test multi-document YAML handling."""

    def test_multi_document_produces_multiple_chunks(self) -> None:
        """Multi-resource.yaml produces multiple chunks."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "multi-resource.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        # Should have 3 chunks: Deployment, Service, ConfigMap
        assert len(chunks) == 3


class TestMetadataExtraction:
    """Test metadata extraction."""

    def test_symbol_name_extracted(self) -> None:
        """symbol_name is extracted from K8s metadata."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "deployment.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) == 1
        assert chunks[0].symbol_name == "auth-service"

    def test_symbol_kind_extracted(self) -> None:
        """symbol_kind is extracted from K8s kind."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "deployment.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert chunks[0].symbol_kind == "deployment"

    def test_k8s_labels_extracted(self) -> None:
        """K8s labels are extracted."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "deployment.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert chunks[0].k8s_labels is not None
        assert chunks[0].k8s_labels.get("app") == "auth-service"

    def test_service_name_extracted(self) -> None:
        """service_name is extracted from labels.app."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "deployment.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert chunks[0].service_name == "auth-service"


class TestServiceCallsExtraction:
    """Test service call extraction from env vars."""

    def test_env_var_service_refs(self) -> None:
        """Service references are extracted from env vars."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "env-refs.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) == 1
        calls_out = chunks[0].calls_out

        assert "auth-service" in calls_out
        assert "user-service" in calls_out
        assert "payment-service" in calls_out

    def test_ingress_backend_refs(self) -> None:
        """Backend service refs are extracted from Ingress."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s" / "ingress.yaml",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) == 1
        calls_out = chunks[0].calls_out

        assert "auth-service" in calls_out
        assert "user-service" in calls_out


class TestChunkIds:
    """Test chunk ID generation."""

    def test_chunk_ids_unique(self) -> None:
        """No duplicate IDs within a crawl."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        ids = [c.id for c in chunks]

        assert len(ids) == len(set(ids)), "Duplicate chunk IDs found"

    def test_chunk_ids_deterministic(self) -> None:
        """Crawl twice produces same IDs."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        chunks1 = list(crawler.crawl(source))
        chunks2 = list(crawler.crawl(source))

        ids1 = sorted([c.id for c in chunks1])
        ids2 = sorted([c.id for c in chunks2])

        assert ids1 == ids2


class TestContextPrefix:
    """Test context prefix generation."""

    def test_context_prefix_set(self) -> None:
        """All chunks have context_prefix."""
        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.context_prefix
            assert len(chunk.context_prefix) > 0


class TestSensitivity:
    """Test sensitivity is correct."""

    def test_chunks_are_clean(self) -> None:
        """CODE_DEPLOY chunks have CLEAN sensitivity."""
        from rag.models.types import SensitivityTier

        crawler = DeployCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "k8s",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type.sensitivity == SensitivityTier.CLEAN
