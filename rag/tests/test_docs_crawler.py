"""Tests for Docs crawlers."""

from pathlib import Path

import pytest

from rag.config import SOURCE_TYPES
from rag.crawlers.docs import DocsCrawler, RunbookCrawler, GoogleDocsCrawler
from rag.models.chunk import RawChunk
from rag.models.types import CrawlSource, SourceKind, SensitivityTier


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestDocsCrawlerProtocol:
    """Test DocsCrawler satisfies the Crawler protocol."""

    def test_corpus_types(self) -> None:
        """Test corpus_types property."""
        crawler = DocsCrawler()
        assert "DOC_README" in crawler.corpus_types
        assert "DOC_RUNBOOK" in crawler.corpus_types
        assert "DOC_ADR" in crawler.corpus_types

    def test_crawl_yields_iterator(self) -> None:
        """Test crawl method returns an iterator."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs",
            repo_name="test-repo",
        )

        result = crawler.crawl(source)
        assert hasattr(result, "__iter__")
        assert hasattr(result, "__next__")


class TestDocsClassification:
    """Test document classification by path."""

    def test_readme_classified_correctly(self) -> None:
        """README.md is classified as DOC_README."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "README.md",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 1
        for chunk in chunks:
            assert chunk.source_type == SOURCE_TYPES["DOC_README"]

    def test_runbook_classified_correctly(self) -> None:
        """Runbook is classified as DOC_RUNBOOK."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "runbooks",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 1
        for chunk in chunks:
            assert chunk.source_type == SOURCE_TYPES["DOC_RUNBOOK"]

    def test_adr_classified_correctly(self) -> None:
        """ADR is classified as DOC_ADR."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "adr",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 1
        for chunk in chunks:
            assert chunk.source_type == SOURCE_TYPES["DOC_ADR"]


class TestDocsChunking:
    """Test docs are chunked by heading."""

    def test_docs_crawler_yields_raw_chunks(self) -> None:
        """DocsCrawler yields RawChunks."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 3  # At least from README, runbook, and ADR
        for chunk in chunks:
            assert isinstance(chunk, RawChunk)

    def test_chunks_have_section_path(self) -> None:
        """Chunks have section_path metadata."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "README.md",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        # At least some chunks should have section_path
        paths = [c.section_path for c in chunks if c.section_path]
        assert len(paths) >= 1


class TestDocsSensitivity:
    """Test sensitivity levels are correct."""

    def test_readme_is_clean(self) -> None:
        """DOC_README has CLEAN sensitivity."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "README.md",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            assert chunk.source_type.sensitivity == SensitivityTier.CLEAN

    def test_runbook_is_maybe_sensitive(self) -> None:
        """DOC_RUNBOOK has MAYBE_SENSITIVE sensitivity."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "runbooks",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            assert chunk.source_type.sensitivity == SensitivityTier.MAYBE_SENSITIVE

    def test_adr_is_maybe_sensitive(self) -> None:
        """DOC_ADR has MAYBE_SENSITIVE sensitivity."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "adr",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            assert chunk.source_type.sensitivity == SensitivityTier.MAYBE_SENSITIVE


class TestChunkIds:
    """Test chunk ID generation."""

    def test_chunk_ids_unique(self) -> None:
        """No duplicate IDs within a crawl."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        ids = [c.id for c in chunks]

        assert len(ids) == len(set(ids)), "Duplicate chunk IDs found"

    def test_crawl_deterministic(self) -> None:
        """Two runs on same fixtures produce same chunk IDs."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs",
            repo_name="test-repo",
        )

        chunks1 = list(crawler.crawl(source))
        chunks2 = list(crawler.crawl(source))

        ids1 = sorted([c.id for c in chunks1])
        ids2 = sorted([c.id for c in chunks2])

        assert ids1 == ids2


class TestRunbookCrawler:
    """Test RunbookCrawler for standalone runbook directories."""

    def test_runbook_crawler_corpus_types(self) -> None:
        """RunbookCrawler produces only DOC_RUNBOOK."""
        crawler = RunbookCrawler()
        assert crawler.corpus_types == frozenset({"DOC_RUNBOOK"})

    def test_runbook_crawler_requires_source_kind(self) -> None:
        """RunbookCrawler only works with RUNBOOK_DIR source kind."""
        crawler = RunbookCrawler()

        # Wrong source kind - should yield nothing
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "runbooks",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) == 0

    def test_runbook_crawler_with_correct_kind(self) -> None:
        """RunbookCrawler works with RUNBOOK_DIR source kind."""
        crawler = RunbookCrawler()
        source = CrawlSource(
            source_kind=SourceKind.RUNBOOK_DIR,
            path=FIXTURES_DIR / "docs" / "runbooks",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) >= 1

        for chunk in chunks:
            assert chunk.source_type == SOURCE_TYPES["DOC_RUNBOOK"]


class TestGoogleDocsCrawler:
    """Test GoogleDocsCrawler for exported Google Docs."""

    def test_gdocs_crawler_corpus_types(self) -> None:
        """GoogleDocsCrawler produces only DOC_GOOGLE."""
        crawler = GoogleDocsCrawler()
        assert crawler.corpus_types == frozenset({"DOC_GOOGLE"})

    def test_gdocs_crawler_requires_source_kind(self) -> None:
        """GoogleDocsCrawler only works with GOOGLE_DOCS_DIR source kind."""
        crawler = GoogleDocsCrawler()

        # Wrong source kind - should yield nothing
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) == 0

    def test_gdocs_is_sensitive(self) -> None:
        """DOC_GOOGLE has SENSITIVE sensitivity."""
        assert SOURCE_TYPES["DOC_GOOGLE"].sensitivity == SensitivityTier.SENSITIVE


class TestContextPrefix:
    """Test context prefix generation."""

    def test_context_prefix_includes_file(self) -> None:
        """Context prefix includes file path."""
        crawler = DocsCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "docs" / "README.md",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            assert "README.md" in chunk.context_prefix
