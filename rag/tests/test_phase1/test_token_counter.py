"""Tests for TokenCounter."""

import pytest

from rag.chunking.token_counter import TokenCounter


@pytest.fixture
def counter() -> TokenCounter:
    """Create a TokenCounter instance."""
    return TokenCounter()


class TestTokenCounter:
    """Token counting tests."""

    def test_count_simple(self, counter: TokenCounter) -> None:
        """Count tokens in simple text."""
        count = counter.count("hello world")
        assert count > 0
        assert count < 10  # Should be ~2 tokens

    def test_count_code(self, counter: TokenCounter) -> None:
        """Count tokens in code."""
        code = "def foo(x): return x + 1"
        count = counter.count(code)
        assert count > 5  # Code has more tokens than words

    def test_count_empty(self, counter: TokenCounter) -> None:
        """Empty string returns 0 tokens."""
        assert counter.count("") == 0

    def test_truncate_preserves_meaning(self, counter: TokenCounter) -> None:
        """Truncation respects max tokens."""
        long_text = "This is a sentence. " * 100
        truncated = counter.truncate(long_text, 50)
        assert counter.count(truncated) <= 50

    def test_truncate_short_text_unchanged(self, counter: TokenCounter) -> None:
        """Short text is not modified."""
        short_text = "Hello world"
        truncated = counter.truncate(short_text, 100)
        assert truncated == short_text

    def test_truncate_breaks_at_word_boundary(self, counter: TokenCounter) -> None:
        """Truncation breaks at word boundaries."""
        text = "word1 word2 word3 word4 word5"
        truncated = counter.truncate(text, 3)
        # Should not cut in middle of a word
        assert not truncated.endswith("wor")

    def test_count_long_identifier(self, counter: TokenCounter) -> None:
        """Long identifiers are split into multiple tokens."""
        long_id = "thisIsAVeryLongIdentifierName"
        count = counter.count(long_id)
        # Long identifiers should count as multiple tokens
        assert count > 1
