"""Tests for Conversation crawlers (Slack and Transcript)."""

from pathlib import Path

import pytest

from rag.config import SOURCE_TYPES
from rag.crawlers.conversation import SlackCrawler, TranscriptCrawler
from rag.models.chunk import RawChunk
from rag.models.types import CrawlSource, SourceKind, SensitivityTier


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestSlackCrawlerProtocol:
    """Test SlackCrawler satisfies the Crawler protocol."""

    def test_corpus_types(self) -> None:
        """Test corpus_types property."""
        crawler = SlackCrawler()
        assert crawler.corpus_types == frozenset({"CONVO_SLACK"})

    def test_crawl_yields_iterator(self) -> None:
        """Test crawl method returns an iterator."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        result = crawler.crawl(source)
        assert hasattr(result, "__iter__")
        assert hasattr(result, "__next__")


class TestSlackCrawlerThreadGrouping:
    """Test Slack thread grouping."""

    def test_slack_crawler_thread_grouping(self) -> None:
        """SlackCrawler groups messages by thread."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        # Should have chunks from incident-response and platform-alerts
        assert len(chunks) >= 2

    def test_all_chunks_are_raw_chunk(self) -> None:
        """All yielded objects are RawChunks."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        for chunk in crawler.crawl(source):
            assert isinstance(chunk, RawChunk)

    def test_all_chunks_have_convo_slack_type(self) -> None:
        """All chunks have CONVO_SLACK source type."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type == SOURCE_TYPES["CONVO_SLACK"]


class TestSlackMetadata:
    """Test Slack chunk metadata."""

    def test_channel_metadata(self) -> None:
        """Chunks have channel metadata."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        channels = {c.channel for c in chunks if c.channel}
        assert "incident-response" in channels or "platform-alerts" in channels

    def test_author_metadata(self) -> None:
        """Chunks have author metadata."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        authors = {c.author for c in chunks if c.author}
        assert len(authors) >= 1

    def test_timestamp_metadata(self) -> None:
        """Chunks have timestamp metadata."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            if chunk.timestamp:
                assert "T" in chunk.timestamp  # ISO 8601


class TestSlackServiceRefs:
    """Test service reference extraction from Slack."""

    def test_service_refs_extracted(self) -> None:
        """Service references are extracted when known_services provided."""
        known = {"auth-service", "user-service", "payment-service"}
        crawler = SlackCrawler(known_services=known)
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        # Find chunks with service refs
        chunks_with_refs = [c for c in chunks if c.calls_out]
        assert len(chunks_with_refs) >= 1

        # Check specific services mentioned
        all_refs: set[str] = set()
        for c in chunks_with_refs:
            all_refs.update(c.calls_out)

        assert "auth-service" in all_refs or "user-service" in all_refs


class TestSlackSensitivity:
    """Test Slack sensitivity."""

    def test_slack_is_maybe_sensitive(self) -> None:
        """CONVO_SLACK has MAYBE_SENSITIVE sensitivity."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type.sensitivity == SensitivityTier.MAYBE_SENSITIVE


class TestSlackSourceKind:
    """Test Slack source kind requirement."""

    def test_requires_slack_export_kind(self) -> None:
        """SlackCrawler only works with SLACK_EXPORT source kind."""
        crawler = SlackCrawler()

        # Wrong source kind - should yield nothing
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) == 0


class TestTranscriptCrawlerProtocol:
    """Test TranscriptCrawler satisfies the Crawler protocol."""

    def test_corpus_types(self) -> None:
        """Test corpus_types property."""
        crawler = TranscriptCrawler()
        assert crawler.corpus_types == frozenset({"CONVO_TRANSCRIPT"})

    def test_crawl_yields_iterator(self) -> None:
        """Test crawl method returns an iterator."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        result = crawler.crawl(source)
        assert hasattr(result, "__iter__")
        assert hasattr(result, "__next__")


class TestTranscriptChunking:
    """Test transcript chunking."""

    def test_transcript_yields_chunks(self) -> None:
        """TranscriptCrawler yields RawChunks from transcript files."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 1
        for chunk in chunks:
            assert isinstance(chunk, RawChunk)

    def test_all_chunks_have_transcript_type(self) -> None:
        """All chunks have CONVO_TRANSCRIPT source type."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type == SOURCE_TYPES["CONVO_TRANSCRIPT"]


class TestTranscriptMetadata:
    """Test transcript chunk metadata."""

    def test_author_metadata(self) -> None:
        """Chunks have author (first speaker) metadata."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        assert len(chunks) >= 1
        assert chunks[0].author is not None

    def test_file_path_set(self) -> None:
        """Chunks have file_path metadata."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        for chunk in chunks:
            assert chunk.file_path is not None
            assert ".txt" in chunk.file_path


class TestTranscriptSensitivity:
    """Test transcript sensitivity."""

    def test_transcript_is_sensitive(self) -> None:
        """CONVO_TRANSCRIPT has SENSITIVE sensitivity."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        for chunk in crawler.crawl(source):
            assert chunk.source_type.sensitivity == SensitivityTier.SENSITIVE


class TestTranscriptSourceKind:
    """Test transcript source kind requirement."""

    def test_requires_transcript_dir_kind(self) -> None:
        """TranscriptCrawler only works with TRANSCRIPT_DIR source kind."""
        crawler = TranscriptCrawler()

        # Wrong source kind - should yield nothing
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))
        assert len(chunks) == 0


class TestTranscriptServiceRefs:
    """Test service reference extraction from transcripts."""

    def test_service_refs_extracted(self) -> None:
        """Service references are extracted when known_services provided."""
        known = {"auth-service", "user-service", "payment-service", "notification-service"}
        crawler = TranscriptCrawler(known_services=known)
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks = list(crawler.crawl(source))

        # Collect all service refs
        all_refs: set[str] = set()
        for c in chunks:
            all_refs.update(c.calls_out)

        # Transcript mentions auth-service, user-service, etc.
        assert len(all_refs) >= 1


class TestChunkIdsDeterministic:
    """Test chunk IDs are deterministic."""

    def test_slack_chunk_ids_deterministic(self) -> None:
        """Slack crawl twice produces same IDs."""
        crawler = SlackCrawler()
        source = CrawlSource(
            source_kind=SourceKind.SLACK_EXPORT,
            path=FIXTURES_DIR / "slack" / "export.json",
            repo_name=None,
        )

        chunks1 = list(crawler.crawl(source))
        chunks2 = list(crawler.crawl(source))

        ids1 = sorted([c.id for c in chunks1])
        ids2 = sorted([c.id for c in chunks2])

        assert ids1 == ids2

    def test_transcript_chunk_ids_deterministic(self) -> None:
        """Transcript crawl twice produces same IDs."""
        crawler = TranscriptCrawler()
        source = CrawlSource(
            source_kind=SourceKind.TRANSCRIPT_DIR,
            path=FIXTURES_DIR / "transcripts",
            repo_name=None,
        )

        chunks1 = list(crawler.crawl(source))
        chunks2 = list(crawler.crawl(source))

        ids1 = sorted([c.id for c in chunks1])
        ids2 = sorted([c.id for c in chunks2])

        assert ids1 == ids2
