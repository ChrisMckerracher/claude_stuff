"""BM25 index for keyword-based retrieval.

Uses bm25s for fast BM25 scoring with dual tokenization support:
- Code tokenizer for code chunks (splits camelCase/snake_case)
- NLP tokenizer for documentation and conversations
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import bm25s

from rag.config import SOURCE_TYPES
from rag.indexing.tokenizer import CODE_TOKENIZER, NLP_TOKENIZER, tokenize


class BM25Store:
    """BM25 index with dual tokenization support.

    At index time: each chunk is tokenized with its corpus-appropriate
    tokenizer (code or NLP) per the SOURCE_TYPES registry.

    At query time: the query is tokenized with BOTH tokenizers,
    producing two result sets. Fusion happens in the retrieval layer (Phase 6).
    """

    def __init__(self) -> None:
        """Initialize an empty BM25 store."""
        self._index: bm25s.BM25 | None = None
        self._doc_ids: list[str] = []

    def build(self, chunks: list[dict[str, Any]]) -> None:
        """Build BM25 index from all chunks.

        Each chunk is tokenized according to its corpus_type's bm25_tokenizer
        setting in SOURCE_TYPES.

        Args:
            chunks: List of chunk dictionaries with 'id', 'text', and
                   'corpus_type' fields.
        """
        if not chunks:
            self._index = bm25s.BM25()
            self._doc_ids = []
            return

        corpus: list[list[str]] = []
        self._doc_ids = []

        for chunk in chunks:
            corpus_type = chunk.get("corpus_type", "")
            source_type = SOURCE_TYPES.get(corpus_type)

            # Determine tokenizer based on source type definition
            if source_type and source_type.bm25_tokenizer == "code":
                tokens = tokenize(chunk["text"], CODE_TOKENIZER)
            else:
                tokens = tokenize(chunk["text"], NLP_TOKENIZER)

            corpus.append(tokens)
            self._doc_ids.append(chunk["id"])

        self._index = bm25s.BM25()
        self._index.index(corpus)

    def query(
        self,
        tokens: list[str],
        top_k: int = 40,
    ) -> list[tuple[str, float]]:
        """Query BM25 index with pre-tokenized query.

        Args:
            tokens: Pre-tokenized query terms.
            top_k: Maximum number of results to return.

        Returns:
            List of (chunk_id, score) tuples, sorted by score descending.
        """
        if self._index is None or not self._doc_ids:
            return []

        if not tokens:
            return []

        # Pass pre-tokenized tokens directly to retrieve
        # bm25s accepts list of token lists when index was built with tokens
        results = self._index.retrieve(
            [tokens],  # Wrap in list: one query
            k=min(top_k, len(self._doc_ids)),
        )

        output: list[tuple[str, float]] = []
        for idx, score in zip(results.documents[0], results.scores[0]):
            if 0 <= idx < len(self._doc_ids):
                output.append((self._doc_ids[idx], float(score)))

        return output

    def query_code(self, query: str, top_k: int = 40) -> list[tuple[str, float]]:
        """Query using code tokenization.

        Args:
            query: Raw query string.
            top_k: Maximum number of results.

        Returns:
            List of (chunk_id, score) tuples.
        """
        tokens = tokenize(query, CODE_TOKENIZER)
        return self.query(tokens, top_k)

    def query_nlp(self, query: str, top_k: int = 40) -> list[tuple[str, float]]:
        """Query using NLP tokenization.

        Args:
            query: Raw query string.
            top_k: Maximum number of results.

        Returns:
            List of (chunk_id, score) tuples.
        """
        tokens = tokenize(query, NLP_TOKENIZER)
        return self.query(tokens, top_k)

    def save(self, path: str) -> None:
        """Save the BM25 index and document IDs to disk.

        Args:
            path: Directory path to save the index.
        """
        if self._index is None:
            raise RuntimeError("No index to save. Call build() first.")

        index_path = Path(path)
        index_path.mkdir(parents=True, exist_ok=True)

        self._index.save(str(index_path))
        with open(index_path / "doc_ids.json", "w") as f:
            json.dump(self._doc_ids, f)

    def load(self, path: str) -> None:
        """Load a BM25 index and document IDs from disk.

        Args:
            path: Directory path containing the saved index.
        """
        index_path = Path(path)
        self._index = bm25s.BM25.load(str(index_path))
        with open(index_path / "doc_ids.json") as f:
            self._doc_ids = json.load(f)

    @property
    def doc_count(self) -> int:
        """Return the number of indexed documents."""
        return len(self._doc_ids)
