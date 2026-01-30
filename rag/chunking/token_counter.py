"""Model-aligned token counting.

Uses a simple heuristic-based tokenizer that works offline.
Approximates BPE tokenization by splitting on word boundaries
and punctuation, with adjustments for code tokens.
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
