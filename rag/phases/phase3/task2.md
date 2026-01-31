# Task 3.2: Embedder Implementation

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement the Embedder protocol using fastembed for lightweight, ONNX-based vector embeddings.

## File

`rag/indexing/embedder.py`

## Implementation

```python
from fastembed import TextEmbedding
from rag.core.errors import EmbeddingError
from rag.config import EMBEDDING_MODEL, EMBEDDING_DIM

class CodeRankEmbedder:
    """Embedder using fastembed (ONNX-based, no PyTorch required).

    Optimized for code and technical documentation.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL):
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
            result = [[0.0] * self._dimension for _ in texts]
            for i, idx in enumerate(non_empty_indices):
                result[idx] = vectors[i].tolist()

            return result
        except Exception as e:
            raise EmbeddingError(str(texts[:3]), f"Batch embedding failed: {e}")

    @property
    def dimension(self) -> int:
        """Vector dimension (768 for jina-embeddings-v2-base-code)."""
        return self._dimension


class MockEmbedder:
    """Mock embedder for testing without model download.

    Returns deterministic vectors based on text hash.
    """

    def __init__(self, dimension: int = EMBEDDING_DIM):
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
        return [self.embed(t) for t in texts]

    @property
    def dimension(self) -> int:
        return self._dimension
```

## Tests

```python
def test_embed_returns_correct_dimension():
    embedder = CodeRankEmbedder()
    vector = embedder.embed("hello world")
    assert len(vector) == embedder.dimension
    assert embedder.dimension == 768

def test_embed_empty_string():
    embedder = CodeRankEmbedder()
    vector = embedder.embed("")
    assert len(vector) == embedder.dimension
    assert all(v == 0.0 for v in vector)

def test_embed_batch_preserves_order():
    embedder = CodeRankEmbedder()
    texts = ["apple", "banana", "cherry"]
    vectors = embedder.embed_batch(texts)
    assert len(vectors) == 3

    # Each text should produce same vector
    for i, text in enumerate(texts):
        single = embedder.embed(text)
        assert vectors[i] == single

def test_embed_batch_handles_empty():
    embedder = CodeRankEmbedder()
    vectors = embedder.embed_batch([])
    assert vectors == []

def test_embed_batch_handles_empty_strings():
    embedder = CodeRankEmbedder()
    texts = ["hello", "", "world"]
    vectors = embedder.embed_batch(texts)
    assert len(vectors) == 3
    assert all(v == 0.0 for v in vectors[1])  # Empty string
    assert vectors[0] != vectors[1]  # Non-empty different from empty

def test_similar_texts_closer():
    embedder = CodeRankEmbedder()
    v1 = embedder.embed("authentication login user")
    v2 = embedder.embed("authentication login password")
    v3 = embedder.embed("database query performance")

    # Cosine similarity helper
    def cosine(a, b):
        import math
        dot = sum(x*y for x,y in zip(a,b))
        norm_a = math.sqrt(sum(x*x for x in a))
        norm_b = math.sqrt(sum(x*x for x in b))
        return dot / (norm_a * norm_b)

    # Similar texts should be closer
    assert cosine(v1, v2) > cosine(v1, v3)

def test_mock_embedder_deterministic():
    embedder = MockEmbedder()
    v1 = embedder.embed("test")
    v2 = embedder.embed("test")
    assert v1 == v2
```

## Acceptance Criteria

- [ ] Implements Embedder protocol
- [ ] Returns vectors of correct dimension (768)
- [ ] Handles empty strings (returns zero vector)
- [ ] Batch embedding preserves order
- [ ] Similar texts produce similar vectors
- [ ] MockEmbedder available for testing

## Dependencies

- Task 0.3 (Embedder protocol)
- fastembed package (`uv add fastembed`)

## Estimated Time

25 minutes
