"""Tests for the centralized token counter."""

import pytest

from rag.chunking.token_counter import count_tokens, count_tokens_fast


class TestCountTokens:
    """Test the model-based token counter."""

    def test_count_tokens_empty(self) -> None:
        """Test empty string returns 0."""
        assert count_tokens("") == 0

    def test_count_tokens_simple_text(self) -> None:
        """Test simple text produces non-zero tokens."""
        tokens = count_tokens("hello world")
        assert tokens > 0

    def test_count_tokens_code(self) -> None:
        """Test code produces reasonable token count."""
        code = """
def hello_world():
    print("Hello, World!")
"""
        tokens = count_tokens(code)
        # Code should produce more tokens than words due to subword tokenization
        assert tokens >= len(code.split())

    def test_count_tokens_longer_text_more_tokens(self) -> None:
        """Test that longer text produces more tokens."""
        short = "hello"
        long = "hello world this is a longer sentence with more words"
        assert count_tokens(long) > count_tokens(short)

    def test_count_tokens_consistent(self) -> None:
        """Test that same input produces same token count."""
        text = "The quick brown fox jumps over the lazy dog"
        assert count_tokens(text) == count_tokens(text)


class TestCountTokensFast:
    """Test the fast approximate token counter."""

    def test_count_tokens_fast_simple(self) -> None:
        """Test basic whitespace splitting."""
        assert count_tokens_fast("hello world") == 2
        assert count_tokens_fast("one two three four five") == 5

    def test_count_tokens_fast_empty(self) -> None:
        """Test empty string."""
        assert count_tokens_fast("") == 0
        assert count_tokens_fast("   ") == 0

    def test_count_tokens_fast_code(self) -> None:
        """Test code-like text."""
        code = "func main() { fmt.Println(\"hello\") }"
        tokens = count_tokens_fast(code)
        assert tokens > 0


class TestTokenizerComparison:
    """Compare model tokenizer vs fast approximation."""

    def test_fast_underestimates(self) -> None:
        """Test that fast counter generally underestimates for text."""
        text = "The quick brown fox jumps over the lazy dog"
        # Model tokenizer typically produces more tokens than whitespace split
        # due to subword tokenization
        model_tokens = count_tokens(text)
        fast_tokens = count_tokens_fast(text)
        # Fast count should be in reasonable range of model count
        # (not a strict requirement, but a sanity check)
        assert fast_tokens <= model_tokens * 2  # Fast shouldn't massively overcount
