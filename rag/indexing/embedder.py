"""Embedder implementations for vector generation.

Provides embedders for converting text to vectors:
- CodeRankEmbedder: Production embedder using fastembed (ONNX-based)
- MockEmbedder: Deterministic embedder for testing without model download
"""

from fastembed import TextEmbedding

from rag.config import EMBEDDING_DIM, EMBEDDING_MODEL
from rag.core.errors import EmbeddingError


class CodeRankEmbedder:
    """Embedder using fastembed (ONNX-based, no PyTorch required).

    Optimized for code and technical documentation.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL) -> None:
        """Initialize embedder.

        Args:
            model_name: Model name (default: from config)
        """
        try:
            self._model = TextEmbedding(model_name)
        except Exception as e:
            raise EmbeddingError("", f"Failed to load model {model_name}: {e}")
        self._dimension = EMBEDDING_DIM

    def embed(self, text: str) -> list[float]:
        """Single text to vector.

        Args:
            text: Text to embed

        Returns:
            Vector of length self.dimension

        Raises:
            EmbeddingError: If embedding fails
        """
        if not text.strip():
            # Return zero vector for empty text
            return [0.0] * self._dimension

        try:
            vectors = list(self._model.embed([text]))
            return vectors[0].tolist()
        except Exception as e:
            raise EmbeddingError(text, f"Embedding failed: {e}")

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding for efficiency.

        Args:
            texts: List of texts to embed

        Returns:
            List of vectors in same order as input

        Raises:
            EmbeddingError: If batch embedding fails
        """
        if not texts:
            return []

        # Handle empty strings
        non_empty_indices = [i for i, t in enumerate(texts) if t.strip()]
        non_empty_texts = [texts[i] for i in non_empty_indices]

        if not non_empty_texts:
            return [[0.0] * self._dimension for _ in texts]

        try:
            vectors = list(self._model.embed(non_empty_texts))

            # Reconstruct full result with zero vectors for empty texts
            result: list[list[float]] = [[0.0] * self._dimension for _ in texts]
            for i, idx in enumerate(non_empty_indices):
                result[idx] = vectors[i].tolist()

            return result
        except Exception as e:
            raise EmbeddingError(str(texts[:3]), f"Batch embedding failed: {e}")

    @property
    def dimension(self) -> int:
        """Vector dimension (768 for jina-embeddings-v2-base-en)."""
        return self._dimension


class MockEmbedder:
    """Mock embedder for testing without model download.

    Returns deterministic vectors based on text hash.
    """

    def __init__(self, dimension: int = EMBEDDING_DIM) -> None:
        self._dimension = dimension

    def embed(self, text: str) -> list[float]:
        """Generate deterministic vector from text hash."""
        import hashlib

        h = hashlib.sha256(text.encode()).digest()
        # Use hash bytes to seed vector values
        vector = []
        for i in range(self._dimension):
            byte_idx = i % len(h)
            vector.append((h[byte_idx] - 128) / 128.0)  # Normalize to [-1, 1]
        return vector

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embed using single embed."""
        return [self.embed(t) for t in texts]

    @property
    def dimension(self) -> int:
        """Vector dimension."""
        return self._dimension
