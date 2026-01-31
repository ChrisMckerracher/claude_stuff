"""Tests for the embedder module.

Uses MockEmbedder for deterministic tests without model download.
"""

import math

import pytest

from rag.config import EMBEDDING_DIM
from rag.indexing.embedder import MockEmbedder


class TestMockEmbedder:
    """Tests for MockEmbedder."""

    def test_embed_returns_correct_dimension(self) -> None:
        """Embedding should return vector of configured dimension."""
        embedder = MockEmbedder()
        vector = embedder.embed("hello world")
        assert len(vector) == EMBEDDING_DIM
        assert embedder.dimension == EMBEDDING_DIM

    def test_embed_returns_floats(self) -> None:
        """All vector values should be floats."""
        embedder = MockEmbedder()
        vector = embedder.embed("hello world")
        assert all(isinstance(v, float) for v in vector)

    def test_embed_values_normalized(self) -> None:
        """Vector values should be normalized to [-1, 1]."""
        embedder = MockEmbedder()
        vector = embedder.embed("test input")
        assert all(-1.0 <= v <= 1.0 for v in vector)

    def test_embed_deterministic(self) -> None:
        """Same input should produce identical vectors."""
        embedder = MockEmbedder()
        v1 = embedder.embed("test")
        v2 = embedder.embed("test")
        assert v1 == v2

    def test_embed_different_texts_different_vectors(self) -> None:
        """Different texts should produce different vectors."""
        embedder = MockEmbedder()
        v1 = embedder.embed("hello")
        v2 = embedder.embed("world")
        assert v1 != v2

    def test_embed_empty_string(self) -> None:
        """Empty string should produce a valid vector."""
        embedder = MockEmbedder()
        vector = embedder.embed("")
        assert len(vector) == EMBEDDING_DIM
        # MockEmbedder uses hash-based generation, so empty string has a hash

    def test_embed_batch_empty_list(self) -> None:
        """Batch embedding of empty list returns empty list."""
        embedder = MockEmbedder()
        vectors = embedder.embed_batch([])
        assert vectors == []

    def test_embed_batch_preserves_order(self) -> None:
        """Batch embedding should preserve input order."""
        embedder = MockEmbedder()
        texts = ["apple", "banana", "cherry"]
        vectors = embedder.embed_batch(texts)

        assert len(vectors) == 3

        # Each text should produce same vector as single embed
        for i, text in enumerate(texts):
            single = embedder.embed(text)
            assert vectors[i] == single

    def test_embed_batch_multiple_texts(self) -> None:
        """Batch embedding should work with multiple texts."""
        embedder = MockEmbedder()
        texts = ["one", "two", "three", "four", "five"]
        vectors = embedder.embed_batch(texts)

        assert len(vectors) == 5
        assert all(len(v) == EMBEDDING_DIM for v in vectors)

    def test_custom_dimension(self) -> None:
        """MockEmbedder should support custom dimensions."""
        embedder = MockEmbedder(dimension=512)
        assert embedder.dimension == 512
        vector = embedder.embed("test")
        assert len(vector) == 512


class TestMockEmbedderSimilarity:
    """Tests for vector similarity properties."""

    @staticmethod
    def cosine_similarity(a: list[float], b: list[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x * x for x in a))
        norm_b = math.sqrt(sum(x * x for x in b))
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def test_identical_texts_max_similarity(self) -> None:
        """Identical texts should have similarity of 1.0."""
        embedder = MockEmbedder()
        v1 = embedder.embed("identical text")
        v2 = embedder.embed("identical text")
        similarity = self.cosine_similarity(v1, v2)
        assert abs(similarity - 1.0) < 0.0001

    def test_different_texts_lower_similarity(self) -> None:
        """Different texts should have similarity less than 1.0."""
        embedder = MockEmbedder()
        v1 = embedder.embed("hello world")
        v2 = embedder.embed("goodbye world")
        similarity = self.cosine_similarity(v1, v2)
        assert similarity < 1.0
