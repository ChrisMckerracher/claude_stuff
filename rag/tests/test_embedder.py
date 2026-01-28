"""Tests for CodeRankEmbedder.

Note: Tests marked with @pytest.mark.slow require the CodeRankEmbed model
to be downloaded (~521MB). These are skipped by default in CI.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from rag.indexing.embedder import CodeRankEmbedder
from tests.fixtures.chunks.sample_clean_chunks import make_code_chunk


class TestCodeRankEmbedderMocked:
    """Tests using a mocked model for fast CI runs."""

    @pytest.fixture
    def mock_embedder(self) -> CodeRankEmbedder:
        """Create embedder with mocked SentenceTransformer."""
        with patch("rag.indexing.embedder.SentenceTransformer") as mock_st:
            # Configure mock to return deterministic vectors
            mock_model = MagicMock()

            def mock_encode(texts, **kwargs):
                import numpy as np

                if isinstance(texts, str):
                    # Single text (query)
                    return np.random.RandomState(42).randn(768).astype(np.float32)
                # Batch of texts
                return np.random.RandomState(42).randn(len(texts), 768).astype(np.float32)

            mock_model.encode = mock_encode
            mock_st.return_value = mock_model

            return CodeRankEmbedder()

    def test_embed_batch_correct_count(self, mock_embedder: CodeRankEmbedder) -> None:
        """5 chunks in -> 5 EmbeddedChunks out."""
        chunks = [
            make_code_chunk(f"func Handler{i}() {{}}", symbol_name=f"Handler{i}")
            for i in range(5)
        ]

        result = mock_embedder.embed_batch(chunks)

        assert len(result) == 5

    def test_embed_produces_768_dims(self, mock_embedder: CodeRankEmbedder) -> None:
        """Vector length is exactly 768."""
        chunks = [make_code_chunk("func Test() {}")]

        result = mock_embedder.embed_batch(chunks)

        assert len(result[0].vector) == 768

    def test_embedded_chunk_wraps_clean(self, mock_embedder: CodeRankEmbedder) -> None:
        """EmbeddedChunk.chunk is the original CleanChunk."""
        chunk = make_code_chunk("func Test() {}")

        result = mock_embedder.embed_batch([chunk])

        assert result[0].chunk is chunk
        assert result[0].chunk.id == chunk.id

    def test_embed_empty_list(self, mock_embedder: CodeRankEmbedder) -> None:
        """Empty input returns empty output."""
        result = mock_embedder.embed_batch([])
        assert result == []

    def test_embed_query_returns_768_dims(self, mock_embedder: CodeRankEmbedder) -> None:
        """Query embedding produces 768-dim vector."""
        result = mock_embedder.embed_query("how to handle errors")

        assert len(result) == 768
        assert all(isinstance(x, float) for x in result)


class TestCodeRankEmbedderPrefixes:
    """Tests verifying prefix behavior (using mocked model)."""

    def test_embed_prepends_context(self) -> None:
        """Verify context_prefix is included in text sent to model."""
        with patch("rag.indexing.embedder.SentenceTransformer") as mock_st:
            import numpy as np

            mock_model = MagicMock()
            captured_texts: list[str] = []

            def mock_encode(texts, **kwargs):
                if isinstance(texts, list):
                    captured_texts.extend(texts)
                    return np.zeros((len(texts), 768), dtype=np.float32)
                return np.zeros(768, dtype=np.float32)

            mock_model.encode = mock_encode
            mock_st.return_value = mock_model

            embedder = CodeRankEmbedder()
            chunk = make_code_chunk(
                "func Test() {}",
                context_prefix="// test-repo/handler.go\n// function: Test",
            )

            embedder.embed_batch([chunk])

            assert len(captured_texts) == 1
            assert "// test-repo/handler.go" in captured_texts[0]
            assert "func Test() {}" in captured_texts[0]

    def test_embed_query_has_prefix(self) -> None:
        """Query embedding includes instruction prefix."""
        with patch("rag.indexing.embedder.SentenceTransformer") as mock_st:
            import numpy as np

            mock_model = MagicMock()
            captured_query: list[str] = []

            def mock_encode(text, **kwargs):
                if isinstance(text, str):
                    captured_query.append(text)
                return np.zeros(768, dtype=np.float32)

            mock_model.encode = mock_encode
            mock_st.return_value = mock_model

            embedder = CodeRankEmbedder()
            embedder.embed_query("error handling")

            assert len(captured_query) == 1
            assert captured_query[0].startswith(CodeRankEmbedder.QUERY_PREFIX)
            assert "error handling" in captured_query[0]


@pytest.mark.slow
class TestCodeRankEmbedderReal:
    """Tests using the real model. Requires model download."""

    @pytest.fixture(scope="class")
    def real_embedder(self) -> CodeRankEmbedder:
        """Create embedder with real model (cached for class)."""
        return CodeRankEmbedder()

    def test_embed_deterministic(self, real_embedder: CodeRankEmbedder) -> None:
        """Same text produces same vector."""
        chunk = make_code_chunk("func HandleRequest(ctx context.Context) error {}")

        result1 = real_embedder.embed_batch([chunk])
        result2 = real_embedder.embed_batch([chunk])

        # Vectors should be identical
        for v1, v2 in zip(result1[0].vector, result2[0].vector):
            assert abs(v1 - v2) < 1e-6

    def test_embed_different_texts(self, real_embedder: CodeRankEmbedder) -> None:
        """Different texts produce different vectors (cosine sim < 0.99)."""
        chunk1 = make_code_chunk("func HandleAuth() error { return nil }")
        chunk2 = make_code_chunk("func ProcessPayment(amount int) error { return nil }")

        result = real_embedder.embed_batch([chunk1, chunk2])

        # Calculate cosine similarity
        v1 = result[0].vector
        v2 = result[1].vector
        dot = sum(a * b for a, b in zip(v1, v2))
        norm1 = sum(x * x for x in v1) ** 0.5
        norm2 = sum(x * x for x in v2) ** 0.5
        cosine_sim = dot / (norm1 * norm2)

        # Should be similar but not identical
        assert cosine_sim < 0.99

    def test_vectors_are_normalized(self, real_embedder: CodeRankEmbedder) -> None:
        """Output vectors should be unit normalized."""
        chunk = make_code_chunk("func Test() {}")

        result = real_embedder.embed_batch([chunk])

        norm = sum(x * x for x in result[0].vector) ** 0.5
        assert abs(norm - 1.0) < 1e-5
