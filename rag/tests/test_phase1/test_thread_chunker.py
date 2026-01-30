"""Tests for ThreadChunker."""

import pytest

from rag.chunking.thread_chunker import ThreadChunker
from rag.chunking.token_counter import TokenCounter
from rag.core.types import CorpusType


@pytest.fixture
def counter() -> TokenCounter:
    """Create a TokenCounter instance."""
    return TokenCounter()


@pytest.fixture
def chunker(counter: TokenCounter) -> ThreadChunker:
    """Create a ThreadChunker instance."""
    return ThreadChunker(counter)


class TestThreadChunker:
    """Thread chunking tests."""

    def test_parse_slack_json_format(self, chunker: ThreadChunker) -> None:
        """Parse Slack JSON export format."""
        slack_json = b"""[
  {"type": "message", "user": "alice", "text": "Hello", "ts": "1234567890.000001"},
  {"type": "message", "user": "bob", "text": "Hi there", "ts": "1234567890.000002"}
]"""
        chunks = list(chunker.chunk(slack_json, source_uri="slack/channel.json"))
        assert len(chunks) == 1
        assert "alice" in chunks[0].text.lower()
        assert "bob" in chunks[0].text.lower()

    def test_parse_simple_text_format(self, chunker: ThreadChunker) -> None:
        """Parse simple text conversation format."""
        convo = b"""Alice: Hello everyone
Bob: Hi Alice
Charlie: Hey!
"""
        chunks = list(chunker.chunk(convo, source_uri="chat.txt"))
        assert len(chunks) == 1
        speakers = chunks[0].metadata["speakers"]
        assert "Alice" in speakers
        assert "Bob" in speakers
        assert "Charlie" in speakers

    def test_group_by_thread(self, chunker: ThreadChunker) -> None:
        """Group messages by thread."""
        slack_json = b"""[
  {"type": "message", "user": "alice", "text": "Main topic", "ts": "1"},
  {"type": "message", "user": "bob", "text": "Reply 1", "thread_ts": "1", "ts": "2"},
  {"type": "message", "user": "alice", "text": "New topic", "ts": "3"}
]"""
        chunks = list(chunker.chunk(slack_json, source_uri="slack/channel.json"))
        # Should have chunks for different threads
        assert len(chunks) >= 1

    def test_preserve_speaker_attribution(self, chunker: ThreadChunker) -> None:
        """Preserve speaker attribution in all chunks."""
        convo = b"""Alice: Message 1
Bob: Message 2
Alice: Message 3
"""
        chunks = list(chunker.chunk(convo, source_uri="chat.txt"))
        for chunk in chunks:
            # Each chunk should have speakers metadata
            assert "speakers" in chunk.metadata
            assert len(chunk.metadata["speakers"]) > 0

    def test_handle_unknown_speaker(self, chunker: ThreadChunker) -> None:
        """Handle content without speaker labels."""
        content = b"This is just some text without any speaker labels at all."
        chunks = list(chunker.chunk(content, source_uri="unknown.txt"))
        assert len(chunks) == 1
        assert "unknown" in chunks[0].metadata["speakers"]

    def test_identify_slack_corpus_type(self, chunker: ThreadChunker) -> None:
        """Slack exports get CONVO_SLACK corpus type."""
        slack_json = b'[{"type": "message", "user": "alice", "text": "Hi"}]'
        chunks = list(chunker.chunk(slack_json, source_uri="exports/slack/channel.json"))
        assert chunks[0].corpus_type == CorpusType.CONVO_SLACK

    def test_identify_transcript_corpus_type(self, chunker: ThreadChunker) -> None:
        """Transcripts get CONVO_TRANSCRIPT corpus type."""
        convo = b"Alice: Hello"
        chunks = list(chunker.chunk(convo, source_uri="transcripts/meeting.txt"))
        assert chunks[0].corpus_type == CorpusType.CONVO_TRANSCRIPT

    def test_split_large_thread(self, counter: TokenCounter) -> None:
        """Split large threads while maintaining speaker attribution."""
        chunker = ThreadChunker(counter, max_tokens=30)

        # Create a large conversation
        lines = []
        for i in range(50):
            speaker = "Alice" if i % 2 == 0 else "Bob"
            lines.append(f"{speaker}: This is message number {i} with some content.")

        convo = "\n".join(lines).encode()
        chunks = list(chunker.chunk(convo, source_uri="long_chat.txt"))

        assert len(chunks) > 1
        # Each chunk should have speaker info
        for chunk in chunks:
            assert "speakers" in chunk.metadata
            # Should have at least one speaker
            assert len(chunk.metadata["speakers"]) >= 1

    def test_message_count_metadata(self, chunker: ThreadChunker) -> None:
        """Chunk metadata includes message count."""
        convo = b"""Alice: One
Bob: Two
Charlie: Three
"""
        chunks = list(chunker.chunk(convo, source_uri="chat.txt"))
        assert chunks[0].metadata["message_count"] == 3

    def test_empty_content(self, chunker: ThreadChunker) -> None:
        """Handle empty content gracefully."""
        chunks = list(chunker.chunk(b"", source_uri="empty.txt"))
        assert len(chunks) == 0

    def test_slack_json_with_non_message_types(self, chunker: ThreadChunker) -> None:
        """Skip non-message types in Slack JSON."""
        slack_json = b"""[
  {"type": "channel_join", "user": "alice"},
  {"type": "message", "user": "bob", "text": "Hello"},
  {"type": "channel_leave", "user": "alice"}
]"""
        chunks = list(chunker.chunk(slack_json, source_uri="slack/channel.json"))
        # Should only have one message
        assert len(chunks) == 1
        assert chunks[0].metadata["message_count"] == 1
