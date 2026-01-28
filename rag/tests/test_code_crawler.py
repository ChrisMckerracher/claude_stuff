"""Integration tests for CodeCrawler."""

from pathlib import Path

import pytest

from rag.config import SOURCE_TYPES
from rag.crawlers.code import CodeCrawler, EXTENSION_MAP, SKIP_DIRS
from rag.models.chunk import RawChunk
from rag.models.types import CrawlSource, SourceKind


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestCodeCrawlerProtocol:
    """Test CodeCrawler satisfies the Crawler protocol."""

    def test_corpus_types(self) -> None:
        """Test corpus_types property."""
        crawler = CodeCrawler()
        assert crawler.corpus_types == frozenset({"CODE_LOGIC"})

    def test_crawl_yields_iterator(self) -> None:
        """Test crawl method returns an iterator."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        result = crawler.crawl(source)
        # Should be an iterator
        assert hasattr(result, "__iter__")
        assert hasattr(result, "__next__")


class TestCrawlGoFixtures:
    """Test crawling Go fixtures."""

    def test_crawl_go_fixtures(self) -> None:
        """Test CodeCrawler yields RawChunks from Go fixtures."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) >= 1

    def test_all_chunks_are_raw_chunk(self) -> None:
        """Every yielded object should be a RawChunk."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert isinstance(chunk, RawChunk)

    def test_all_chunks_have_code_logic_type(self) -> None:
        """All chunks should have CODE_LOGIC source type."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type == SOURCE_TYPES["CODE_LOGIC"]

    def test_all_chunks_have_language(self) -> None:
        """Language field should be set for every chunk."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.language == "go"


class TestCrawlAllLanguages:
    """Test crawling fixtures for all languages."""

    @pytest.mark.parametrize(
        "fixture_dir,expected_language",
        [
            ("go", "go"),
            ("csharp", "c_sharp"),
            ("python", "python"),
            ("typescript", "typescript"),
        ],
    )
    def test_crawl_language_fixtures(
        self, fixture_dir: str, expected_language: str
    ) -> None:
        """Test crawling fixtures for each language."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / fixture_dir,
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) >= 1

        for chunk in chunks:
            assert chunk.language == expected_language


class TestChunkMetadata:
    """Test chunk metadata is populated correctly."""

    def test_chunks_have_imports(self) -> None:
        """Chunks should have imports populated."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        # At least some chunks should have imports
        chunks_with_imports = [c for c in chunks if c.imports]
        assert len(chunks_with_imports) >= 1

    def test_chunks_have_calls_out(self) -> None:
        """Chunks from http_client should have calls_out."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        # Find chunks from http_client.go
        http_chunks = [c for c in chunks if "http_client" in c.source_uri]

        # At least one should have calls_out
        chunks_with_calls = [c for c in http_chunks if c.calls_out]
        assert len(chunks_with_calls) >= 1

    def test_chunks_have_context_prefix(self) -> None:
        """All chunks should have context_prefix."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.context_prefix
            assert len(chunk.context_prefix) > 0

    def test_chunks_have_repo_name(self) -> None:
        """All chunks should have repo_name from source."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="my-test-repo",
        )

        for chunk in crawler.crawl(source):
            assert chunk.repo_name == "my-test-repo"


class TestChunkIds:
    """Test chunk ID generation."""

    def test_chunk_ids_unique(self) -> None:
        """No duplicate IDs within a crawl."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR,  # Crawl all fixtures
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        ids = [c.id for c in chunks]
        assert len(ids) == len(set(ids)), "Duplicate chunk IDs found"

    def test_chunk_ids_deterministic(self) -> None:
        """Crawl twice -> same IDs."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go",
            repo_name="test-repo",
        )

        chunks1 = list(crawler.crawl(source))
        chunks2 = list(crawler.crawl(source))

        ids1 = sorted([c.id for c in chunks1])
        ids2 = sorted([c.id for c in chunks2])
        assert ids1 == ids2


class TestSkipDirs:
    """Test directory skipping."""

    def test_skip_dirs_constant(self) -> None:
        """Verify SKIP_DIRS contains expected directories."""
        assert "vendor" in SKIP_DIRS
        assert "node_modules" in SKIP_DIRS
        assert ".git" in SKIP_DIRS
        assert "__pycache__" in SKIP_DIRS

    def test_unknown_extension_skipped(self) -> None:
        """Files with unknown extensions produce no chunks."""
        crawler = CodeCrawler()

        # Create a temporary source with just a .java file (unsupported)
        import tempfile

        with tempfile.TemporaryDirectory() as tmpdir:
            java_file = Path(tmpdir) / "Main.java"
            java_file.write_text("public class Main {}")

            source = CrawlSource(
                source_kind=SourceKind.REPO,
                path=Path(tmpdir),
                repo_name="test-repo",
            )

            chunks = list(crawler.crawl(source))
            assert len(chunks) == 0


class TestExtensionMap:
    """Test file extension mapping."""

    def test_extension_map_coverage(self) -> None:
        """Verify EXTENSION_MAP has all expected extensions."""
        assert EXTENSION_MAP[".go"] == "go"
        assert EXTENSION_MAP[".cs"] == "c_sharp"
        assert EXTENSION_MAP[".py"] == "python"
        assert EXTENSION_MAP[".ts"] == "typescript"
        assert EXTENSION_MAP[".tsx"] == "typescript"


class TestSingleFile:
    """Test crawling a single file."""

    def test_crawl_single_file(self) -> None:
        """Test crawling a single file instead of directory."""
        crawler = CodeCrawler()
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "go" / "simple_handler.go",
            repo_name="test-repo",
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) >= 1

        # All chunks should be from the single file
        for chunk in chunks:
            assert "simple_handler.go" in chunk.source_uri
