"""Tests for Thread chunker (Slack and transcripts)."""

import json
from pathlib import Path

import pytest

from rag.chunking.thread_chunker import (
    chunk_slack_messages,
    chunk_transcript,
    ThreadChunkData,
    _ts_to_iso,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestSlackThreadGrouping:
    """Test Slack thread grouping."""

    def test_thread_grouping(self) -> None:
        """Messages with same thread_ts are grouped into one chunk."""
        slack_path = FIXTURES_DIR / "slack" / "export.json"
        content = json.loads(slack_path.read_text())
        messages = content["channels"]["incident-response"]

        chunks = chunk_slack_messages(messages, "incident-response")

        # Should have 2 chunks: one thread (3 messages) and one standalone
        assert len(chunks) == 2

    def test_standalone_message(self) -> None:
        """Message without thread_ts becomes its own chunk."""
        messages = [
            {"ts": "1705312200.000100", "user": "alice", "text": "standalone message"}
        ]

        chunks = chunk_slack_messages(messages, "test-channel")

        assert len(chunks) == 1
        assert "standalone message" in chunks[0].text

    def test_all_chunks_are_dataclass(self) -> None:
        """All chunks are ThreadChunkData instances."""
        slack_path = FIXTURES_DIR / "slack" / "export.json"
        content = json.loads(slack_path.read_text())
        messages = content["channels"]["incident-response"]

        chunks = chunk_slack_messages(messages, "incident-response")

        for chunk in chunks:
            assert isinstance(chunk, ThreadChunkData)


class TestSlackLongThread:
    """Test handling of long threads."""

    def test_long_thread_split(self) -> None:
        """Thread exceeding 2048 tokens is split at message boundaries."""
        # Create a thread with many messages
        long_message = "This is a message with many words. " * 50
        messages = [
            {"ts": f"170531220{i}.00010{i}", "user": "alice", "text": long_message}
            for i in range(20)
        ]
        # Make them all part of the same thread
        for msg in messages[1:]:
            msg["thread_ts"] = messages[0]["ts"]

        chunks = chunk_slack_messages(messages, "test-channel")

        # Should be split into multiple chunks
        assert len(chunks) >= 2

    def test_never_split_mid_message(self) -> None:
        """Chunk boundaries are always between messages."""
        messages = [
            {
                "ts": f"170531220{i}.00010{i}",
                "user": "alice",
                "text": f"Message number {i} with some content.",
            }
            for i in range(10)
        ]
        for msg in messages[1:]:
            msg["thread_ts"] = messages[0]["ts"]

        chunks = chunk_slack_messages(messages, "test-channel")

        # Each chunk should contain complete messages
        for chunk in chunks:
            # Check that each line is a complete message format
            lines = [l for l in chunk.text.split("\n") if l.strip()]
            for line in lines:
                assert "@alice:" in line  # Complete speaker attribution


class TestSlackMetadata:
    """Test Slack chunk metadata."""

    def test_speaker_attribution(self) -> None:
        """Speaker names are preserved in chunk text."""
        slack_path = FIXTURES_DIR / "slack" / "export.json"
        content = json.loads(slack_path.read_text())
        messages = content["channels"]["incident-response"]

        chunks = chunk_slack_messages(messages, "incident-response")

        # Thread chunk should have multiple speakers
        thread_chunk = [c for c in chunks if "alice" in c.text and "bob" in c.text]
        assert len(thread_chunk) >= 1

    def test_timestamp_extraction(self) -> None:
        """ISO 8601 timestamp is on chunk metadata."""
        slack_path = FIXTURES_DIR / "slack" / "export.json"
        content = json.loads(slack_path.read_text())
        messages = content["channels"]["incident-response"]

        chunks = chunk_slack_messages(messages, "incident-response")

        for chunk in chunks:
            if chunk.timestamp:
                # Should be ISO 8601 format
                assert "T" in chunk.timestamp
                assert chunk.timestamp.endswith("Z")

    def test_channel_name(self) -> None:
        """Channel name is set on chunks."""
        messages = [
            {"ts": "1705312200.000100", "user": "alice", "text": "hello"}
        ]

        chunks = chunk_slack_messages(messages, "my-channel")

        assert chunks[0].channel == "my-channel"

    def test_thread_id_set(self) -> None:
        """Thread ID is set for threaded messages."""
        slack_path = FIXTURES_DIR / "slack" / "export.json"
        content = json.loads(slack_path.read_text())
        messages = content["channels"]["incident-response"]

        chunks = chunk_slack_messages(messages, "incident-response")

        # Thread chunk should have thread_id
        thread_chunks = [c for c in chunks if c.thread_id]
        assert len(thread_chunks) >= 1


class TestSlackTimestamp:
    """Test Slack timestamp conversion."""

    def test_ts_to_iso(self) -> None:
        """Slack timestamp is converted to ISO 8601."""
        ts = "1705312200.000100"
        iso = _ts_to_iso(ts)

        assert "2024-01-15" in iso
        assert iso.endswith("Z")

    def test_invalid_ts(self) -> None:
        """Invalid timestamp returns original string."""
        ts = "invalid"
        result = _ts_to_iso(ts)
        assert result == "invalid"


class TestTranscriptChunking:
    """Test transcript chunking."""

    def test_transcript_parsed(self) -> None:
        """Transcript file is parsed into chunks."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup-2024-01-15.txt")

        assert len(chunks) >= 1
        assert isinstance(chunks[0], ThreadChunkData)

    def test_speaker_attribution_transcript(self) -> None:
        """Speaker names are preserved in transcript chunks."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup-2024-01-15.txt")

        # Should have multiple speakers mentioned
        all_text = " ".join(c.text for c in chunks)
        assert "Alice" in all_text
        assert "Bob" in all_text

    def test_timestamp_preserved(self) -> None:
        """Timestamps are preserved in chunk text."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup-2024-01-15.txt")

        # Chunks should contain timestamps
        all_text = " ".join(c.text for c in chunks)
        assert "[10:" in all_text


class TestTranscriptMetadata:
    """Test transcript chunk metadata."""

    def test_author_set(self) -> None:
        """First speaker is set as author."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup-2024-01-15.txt")

        # First chunk should have Alice as author (first speaker)
        assert chunks[0].author == "Alice"

    def test_participants_tracked(self) -> None:
        """Participants list includes all speakers in chunk."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup-2024-01-15.txt")

        # Get all participants across chunks
        all_participants: set[str] = set()
        for chunk in chunks:
            all_participants.update(chunk.participants)

        assert "Alice" in all_participants
        assert "Bob" in all_participants


class TestContextPrefix:
    """Test context prefix generation."""

    def test_slack_context_prefix(self) -> None:
        """Slack context prefix includes channel and author."""
        messages = [
            {"ts": "1705312200.000100", "user": "alice", "text": "hello world"}
        ]

        chunks = chunk_slack_messages(messages, "general")

        assert "#general" in chunks[0].context_prefix
        assert "@alice" in chunks[0].context_prefix

    def test_transcript_context_prefix(self) -> None:
        """Transcript context prefix includes file and speaker."""
        transcript_path = FIXTURES_DIR / "transcripts" / "standup-2024-01-15.txt"
        content = transcript_path.read_bytes()

        chunks = chunk_transcript(content, "standup.txt")

        assert "standup.txt" in chunks[0].context_prefix
