"""Model-aligned token counting.

Uses a simple heuristic-based tokenizer that works offline.
Approximates BPE tokenization by splitting on word boundaries
and punctuation, with adjustments for code tokens.

TODO(tokenizer): Replace heuristic tokenizer with HuggingFace AutoTokenizer
==============================================================================
This module uses a regex-based heuristic tokenizer because network access was
blocked during initial implementation (HuggingFace model downloads failed).

To upgrade to the proper model-aligned tokenizer:

1. Ensure network access to huggingface.co

2. Install transformers (already in pyproject.toml):
   uv add transformers

3. Replace TokenCounter implementation with:

   ```python
   from transformers import AutoTokenizer
   from rag.config import EMBEDDING_MODEL

   class TokenCounter:
       def __init__(self, model_name: str = EMBEDDING_MODEL):
           self._tokenizer = AutoTokenizer.from_pretrained(model_name)

       def count(self, text: str) -> int:
           return len(self._tokenizer.encode(text, add_special_tokens=False))

       def truncate(self, text: str, max_tokens: int) -> str:
           tokens = self._tokenizer.encode(text, add_special_tokens=False)
           if len(tokens) <= max_tokens:
               return text
           truncated = self._tokenizer.decode(tokens[:max_tokens])
           last_space = truncated.rfind(" ")
           if last_space > len(truncated) * 0.8:
               truncated = truncated[:last_space]
           return truncated
   ```

4. Update tests to account for different token counts (HuggingFace will give
   different results than the heuristic approach).

5. First run will download the tokenizer (~500MB for jina-embeddings-v3).

Alternative: Use tiktoken for offline-capable tokenization:
   ```python
   import tiktoken
   self._tokenizer = tiktoken.get_encoding("cl100k_base")
   ```
   (Requires first-run download of ~1MB encoding file)

See: rag/config.py for EMBEDDING_MODEL setting (jinaai/jina-embeddings-v3)
==============================================================================
"""

import re


class TokenCounter:
    """Heuristic-based token counting.

    Uses word/punctuation splitting with character-based adjustments
    to approximate BPE tokenization behavior. Works entirely offline.

    Approximation rules:
    - Words are split on whitespace and punctuation
    - Long words (>10 chars) count as multiple tokens (~1 per 4 chars)
    - Code operators and brackets are individual tokens
    """

    # Pattern to split into token-like units
    _TOKEN_PATTERN = re.compile(
        r"""
        [a-zA-Z_][a-zA-Z0-9_]*  |  # identifiers
        \d+(?:\.\d+)?           |  # numbers
        [^\s\w]                 |  # punctuation/operators
        \s+                        # whitespace (will be filtered)
        """,
        re.VERBOSE,
    )

    def __init__(self, chars_per_token: float = 4.0):
        """Initialize token counter.

        Args:
            chars_per_token: Average characters per token for long words
        """
        self._chars_per_token = chars_per_token

    def count(self, text: str) -> int:
        """Count tokens in text.

        Args:
            text: Text to count tokens for

        Returns:
            Estimated number of tokens
        """
        if not text:
            return 0

        tokens = self._tokenize(text)
        return len(tokens)

    def _tokenize(self, text: str) -> list[str]:
        """Split text into token-like units.

        Args:
            text: Text to tokenize

        Returns:
            List of token strings
        """
        raw_tokens = self._TOKEN_PATTERN.findall(text)

        # Filter whitespace and expand long tokens
        result = []
        for token in raw_tokens:
            if token.isspace():
                continue

            # Long identifiers get split (BPE behavior)
            if len(token) > 10 and token[0].isalpha():
                # Approximate: 1 token per chars_per_token characters
                num_tokens = max(1, int(len(token) / self._chars_per_token))
                chunk_size = len(token) // num_tokens
                for i in range(0, len(token), chunk_size):
                    chunk = token[i : i + chunk_size]
                    if chunk:
                        result.append(chunk)
            else:
                result.append(token)

        return result

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
        if self.count(text) <= max_tokens:
            return text

        # Binary search for the right truncation point
        words = text.split()
        low, high = 0, len(words)

        while low < high:
            mid = (low + high + 1) // 2
            candidate = " ".join(words[:mid])
            if self.count(candidate) <= max_tokens:
                low = mid
            else:
                high = mid - 1

        return " ".join(words[:low])
