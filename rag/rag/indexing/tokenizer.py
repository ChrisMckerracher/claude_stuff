"""BM25 tokenizers: code-aware and NLP.

These are pure functions with no external dependencies. The code tokenizer
splits camelCase and snake_case identifiers and removes language keywords.
The NLP tokenizer does basic lowercasing and whitespace splitting.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TokenizerConfig:
    """Configuration for a BM25 tokenizer."""

    split_identifiers: bool
    stop_words: frozenset[str]
    lowercase: bool


CODE_TOKENIZER = TokenizerConfig(
    split_identifiers=True,
    stop_words=frozenset({
        # Go
        "func", "return", "if", "else", "for", "range", "var", "const",
        "type", "struct", "interface", "package", "import", "defer", "go",
        # C#
        "public", "private", "protected", "static", "void", "class",
        "namespace", "using", "async", "await", "new", "this", "base",
        # Python
        "def", "self", "none",
        # TypeScript
        "function", "let", "export", "default",
        # Common
        "true", "false", "null", "nil", "string", "int", "bool", "err",
    }),
    lowercase=True,
)

NLP_TOKENIZER = TokenizerConfig(
    split_identifiers=False,
    stop_words=frozenset(),
    lowercase=True,
)


def tokenize(text: str, config: TokenizerConfig) -> list[str]:
    """Tokenize text using the given configuration.

    For code: splits on punctuation/whitespace, splits camelCase/snake_case
    identifiers, removes language stop words.

    For NLP: splits on whitespace/punctuation, lowercases.
    """
    tokens = re.split(
        r'[\s\.\,\;\:\(\)\[\]\{\}\<\>\=\+\-\*/&|!@#$%^~`"\'\\]+',
        text,
    )
    result: list[str] = []
    for token in tokens:
        if not token:
            continue
        if config.split_identifiers:
            # snake_case split
            parts = token.split("_")
            expanded: list[str] = []
            for part in parts:
                if not part:
                    continue
                # camelCase split:
                #   (?<=[a-z])(?=[A-Z])     — "getUser" -> "get User"
                #   (?<=[A-Z])(?=[A-Z][a-z]) — "HTTPClient" -> "HTTP Client"
                split = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", part)
                split = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", split)
                expanded.extend(split.split())
            sub_tokens = expanded
        else:
            sub_tokens = [token]

        for sub in sub_tokens:
            if config.lowercase:
                sub = sub.lower()
            if sub and sub not in config.stop_words:
                result.append(sub)
    return result


def get_tokenizer(corpus_type: str) -> TokenizerConfig:
    """Route to the right tokenizer based on corpus type."""
    if corpus_type.startswith("CODE_"):
        return CODE_TOKENIZER
    return NLP_TOKENIZER
