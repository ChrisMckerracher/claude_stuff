# Task 1.1: Token Counter

**Status:** [ ] Not Started  |  [ ] In Progress  |  [x] Complete

## Objective

Create a token counter that uses the same tokenizer as the embedding model to ensure accurate chunk size estimation.

## File

`rag/chunking/token_counter.py`

## Implementation

```python
from transformers import AutoTokenizer
from rag.config import EMBEDDING_MODEL

class TokenCounter:
    """Model-aligned token counting.

    Uses the same tokenizer as the embedding model to ensure
    chunk token counts match what the model will see.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL):
        """Initialize with model tokenizer.

        Args:
            model_name: HuggingFace model name (default: from config)
        """
        self._tokenizer = AutoTokenizer.from_pretrained(model_name)

    def count(self, text: str) -> int:
        """Count tokens in text.

        Args:
            text: Text to count tokens for

        Returns:
            Number of tokens (excluding special tokens)
        """
        return len(self._tokenizer.encode(text, add_special_tokens=False))

    def truncate(self, text: str, max_tokens: int) -> str:
        """Truncate to max tokens, preserving whole words.

        Args:
            text: Text to truncate
            max_tokens: Maximum number of tokens

        Returns:
            Truncated text with <= max_tokens tokens

        Note:
            Attempts to break at word boundaries to preserve readability.
        """
        tokens = self._tokenizer.encode(text, add_special_tokens=False)
        if len(tokens) <= max_tokens:
            return text

        # Decode truncated tokens
        truncated = self._tokenizer.decode(tokens[:max_tokens])

        # Try to break at word boundary (last space)
        last_space = truncated.rfind(' ')
        if last_space > len(truncated) * 0.8:  # Only if near the end
            truncated = truncated[:last_space]

        return truncated
```

## Tests

```python
def test_count_simple():
    tc = TokenCounter()
    count = tc.count("hello world")
    assert count > 0
    assert count < 10  # Should be ~2-3 tokens

def test_count_code():
    tc = TokenCounter()
    code = "def foo(x): return x + 1"
    count = tc.count(code)
    assert count > 5  # Code has more tokens than words

def test_count_empty():
    tc = TokenCounter()
    assert tc.count("") == 0

def test_truncate_preserves_meaning():
    tc = TokenCounter()
    long_text = "This is a sentence. " * 100
    truncated = tc.truncate(long_text, 50)
    assert tc.count(truncated) <= 50

def test_truncate_short_text_unchanged():
    tc = TokenCounter()
    short_text = "Hello world"
    truncated = tc.truncate(short_text, 100)
    assert truncated == short_text

def test_truncate_breaks_at_word_boundary():
    tc = TokenCounter()
    text = "word1 word2 word3 word4 word5"
    truncated = tc.truncate(text, 3)
    # Should not cut in middle of a word
    assert not truncated.endswith("wor")
```

## Acceptance Criteria

- [ ] TokenCounter uses model-aligned tokenizer
- [ ] count() returns accurate token count
- [ ] truncate() respects max_tokens limit
- [ ] truncate() tries to preserve word boundaries
- [ ] Empty string returns 0 tokens
- [ ] All tests pass

## Dependencies

- `transformers` package for AutoTokenizer
- `rag/config.py` for EMBEDDING_MODEL constant

## Estimated Time

20 minutes
