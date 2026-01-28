"""Tests for the cross-encoder reranker."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from rag.retrieval.reranker import Reranker


class TestReranker:
    """Test cases for the Reranker class."""

    def test_empty_candidates(self) -> None:
        """Empty input returns empty output."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()

            result = reranker.rerank("test query", [])
            assert result == []

    def test_rerank_score_attached(self) -> None:
        """Output items have rerank_score field."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.8]

            candidates = [{"id": "a", "text": "Hello world"}]
            result = reranker.rerank("test", candidates)

            assert "rerank_score" in result[0]
            assert result[0]["rerank_score"] == 0.8

    def test_rerank_changes_order(self) -> None:
        """Reranker reorders candidates by score."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            # Second candidate gets higher score
            reranker._model.predict.return_value = [0.3, 0.9, 0.5]

            candidates = [
                {"id": "a", "text": "First"},
                {"id": "b", "text": "Second"},
                {"id": "c", "text": "Third"},
            ]
            result = reranker.rerank("test", candidates)

            # Should be reordered by score
            assert result[0]["id"] == "b"  # 0.9
            assert result[1]["id"] == "c"  # 0.5
            assert result[2]["id"] == "a"  # 0.3

    def test_rerank_top_k(self) -> None:
        """Requesting top_k limits output size."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.9, 0.8, 0.7, 0.6, 0.5]

            candidates = [
                {"id": f"c{i}", "text": f"Text {i}"} for i in range(5)
            ]
            result = reranker.rerank("test", candidates, top_k=3)

            assert len(result) == 3
            # Should be top 3 by score
            assert result[0]["rerank_score"] == 0.9

    def test_query_text_pairs_built(self) -> None:
        """Model receives correct query-text pairs."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.5, 0.6]

            candidates = [
                {"id": "a", "text": "Document one"},
                {"id": "b", "text": "Document two"},
            ]
            reranker.rerank("my query", candidates)

            # Check what pairs were passed to predict
            call_args = reranker._model.predict.call_args[0][0]
            assert call_args == [
                ("my query", "Document one"),
                ("my query", "Document two"),
            ]

    def test_preserves_other_fields(self) -> None:
        """Reranking preserves other fields on candidates."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.8]

            candidates = [
                {
                    "id": "a",
                    "text": "Hello",
                    "corpus_type": "CODE_LOGIC",
                    "service_name": "auth-service",
                    "rrf_score": 0.05,
                }
            ]
            result = reranker.rerank("test", candidates)

            assert result[0]["id"] == "a"
            assert result[0]["corpus_type"] == "CODE_LOGIC"
            assert result[0]["service_name"] == "auth-service"
            assert result[0]["rrf_score"] == 0.05

    def test_handles_missing_text_field(self) -> None:
        """Gracefully handles candidates without text field."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.5]

            candidates = [{"id": "a"}]  # No text field
            result = reranker.rerank("test", candidates)

            # Should use empty string for text
            call_args = reranker._model.predict.call_args[0][0]
            assert call_args == [("test", "")]

    def test_top_k_none_returns_all(self) -> None:
        """top_k=None returns all candidates."""
        with patch.object(Reranker, "__init__", lambda self, *args: None):
            reranker = Reranker()
            reranker._model = MagicMock()
            reranker._model.predict.return_value = [0.9, 0.8, 0.7]

            candidates = [
                {"id": f"c{i}", "text": f"Text {i}"} for i in range(3)
            ]
            result = reranker.rerank("test", candidates, top_k=None)

            assert len(result) == 3


@pytest.mark.slow
class TestRerankerIntegration:
    """Integration tests that load the actual model."""

    def test_relevant_chunk_ranked_higher(self) -> None:
        """A clearly relevant chunk scores higher than irrelevant one."""
        reranker = Reranker()

        candidates = [
            {"id": "irrelevant", "text": "The weather is nice today."},
            {"id": "relevant", "text": "Python is a programming language."},
        ]

        result = reranker.rerank("What is Python?", candidates)

        # The relevant chunk should be ranked first
        assert result[0]["id"] == "relevant"
        assert result[0]["rerank_score"] > result[1]["rerank_score"]

    def test_model_loads_successfully(self) -> None:
        """Model loads and can make predictions."""
        reranker = Reranker()

        candidates = [{"id": "a", "text": "Test document"}]
        result = reranker.rerank("test query", candidates)

        assert len(result) == 1
        assert "rerank_score" in result[0]
        assert isinstance(result[0]["rerank_score"], float)
