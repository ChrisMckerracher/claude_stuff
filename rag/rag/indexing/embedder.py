"""CodeRankEmbed wrapper for batch embedding.

Satisfies the Embedder protocol from pipeline/protocols.py.
Uses nomic-ai/CodeRankEmbed for code-aware embeddings.
"""

from __future__ import annotations

from typing import Any, cast

from sentence_transformers import SentenceTransformer

from rag.models.chunk import CleanChunk, EmbeddedChunk


class CodeRankEmbedder:
    """Wraps CodeRankEmbed for batch embedding.

    Satisfies the Embedder protocol:
        embed_batch(chunks: list[CleanChunk]) -> list[EmbeddedChunk]
    """

    MODEL_NAME = "nomic-ai/CodeRankEmbed"
    QUERY_PREFIX = "Represent this query for searching relevant code: "
    VECTOR_DIM = 768

    def __init__(
        self,
        model_path: str | None = None,
        batch_size: int = 32,
    ) -> None:
        """Initialize the embedder.

        Args:
            model_path: Path to a local model or HuggingFace model name.
                       Defaults to MODEL_NAME.
            batch_size: Batch size for encoding. Default 32.
        """
        self._model: SentenceTransformer = SentenceTransformer(
            model_path or self.MODEL_NAME,
            trust_remote_code=True,
        )
        self._batch_size = batch_size

    def embed_batch(self, chunks: list[CleanChunk]) -> list[EmbeddedChunk]:
        """Batch-encode chunks into dense vectors.

        Prepends context_prefix to text for each chunk before encoding.
        Vectors are normalized for cosine similarity search.

        Args:
            chunks: List of CleanChunks to embed.

        Returns:
            List of EmbeddedChunks with 768-dim normalized vectors.
        """
        if not chunks:
            return []

        texts = [f"{c.context_prefix}\n{c.text}" for c in chunks]
        vectors: Any = self._model.encode(
            texts,
            batch_size=self._batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,
        )
        return [
            EmbeddedChunk(chunk=chunk, vector=cast(list[float], vec.tolist()))
            for chunk, vec in zip(chunks, vectors)
        ]

    def embed_query(self, query: str) -> list[float]:
        """Encode a query string into a dense vector.

        Prepends the query instruction prefix for asymmetric retrieval.

        Args:
            query: The query text to embed.

        Returns:
            768-dim normalized vector as a list of floats.
        """
        vec: Any = self._model.encode(
            self.QUERY_PREFIX + query,
            normalize_embeddings=True,
        )
        return cast(list[float], vec.tolist())
