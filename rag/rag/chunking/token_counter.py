"""Centralized token counter using the embedding model's tokenizer.

This module provides accurate token counting that matches the embedding model,
ensuring chunks are sized correctly for the model's context window.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from transformers import PreTrainedTokenizerBase

# Model name must match the embedder
MODEL_NAME = "nomic-ai/CodeRankEmbed"


@lru_cache(maxsize=1)
def _get_tokenizer() -> "PreTrainedTokenizerBase":
    """Load and cache the tokenizer.

    Uses lru_cache to ensure the tokenizer is only loaded once.
    """
    from transformers import AutoTokenizer

    return AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True)


def count_tokens(text: str) -> int:
    """Count tokens using the embedding model's tokenizer.

    Args:
        text: The text to count tokens for.

    Returns:
        Number of tokens according to the model's tokenizer.
    """
    tokenizer = _get_tokenizer()
    return len(tokenizer.encode(text, add_special_tokens=False))


def count_tokens_fast(text: str) -> int:
    """Fast approximate token count using whitespace splitting.

    Use this when exact token count is not critical and performance matters.
    Generally undercounts by ~30% compared to actual tokenization.

    Args:
        text: The text to count tokens for.

    Returns:
        Approximate number of tokens.
    """
    return len(text.split())
