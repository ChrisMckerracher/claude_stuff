"""Tests for Reciprocal Rank Fusion (RRF) implementation."""

from __future__ import annotations

import pytest

from rag.retrieval.fusion import reciprocal_rank_fusion


class TestReciprocalRankFusion:
    """Test cases for the RRF algorithm."""

    def test_empty_lists(self) -> None:
        """Empty input returns empty output."""
        result = reciprocal_rank_fusion([], [], [])
        assert result == []

    def test_single_dense_list(self) -> None:
        """RRF with only dense results preserves order."""
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
            {"id": "c", "_distance": 0.3},
        ]
        result = reciprocal_rank_fusion(dense, [], [])

        assert len(result) == 3
        assert result[0]["id"] == "a"
        assert result[1]["id"] == "b"
        assert result[2]["id"] == "c"

    def test_rrf_score_attached(self) -> None:
        """Output items have rrf_score field."""
        dense = [{"id": "a", "_distance": 0.1}]
        result = reciprocal_rank_fusion(dense, [], [])

        assert "rrf_score" in result[0]
        assert result[0]["rrf_score"] > 0

    def test_two_lists_agreement(self) -> None:
        """Item ranked #1 in both lists gets top RRF score."""
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
        ]
        bm25_code = [("a", 10.0), ("b", 5.0)]

        result = reciprocal_rank_fusion(dense, bm25_code, [])

        # 'a' is #1 in both, should remain top
        assert result[0]["id"] == "a"
        assert result[1]["id"] == "b"
        # 'a' should have higher RRF score
        assert result[0]["rrf_score"] > result[1]["rrf_score"]

    def test_two_lists_disagreement(self) -> None:
        """RRF properly combines rankings even when lists disagree."""
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
            {"id": "c", "_distance": 0.3},
            {"id": "d", "_distance": 0.4},
            {"id": "e", "_distance": 0.5},
        ]
        # 'a' is #10 in BM25, 'e' is #1
        bm25_code = [
            ("e", 10.0), ("d", 9.0), ("c", 8.0), ("b", 7.0),
            ("x", 6.0), ("y", 5.0), ("z", 4.0), ("w", 3.0),
            ("v", 2.0), ("a", 1.0),
        ]

        result = reciprocal_rank_fusion(dense, bm25_code, [])

        # All dense items should be in results
        ids = [r["id"] for r in result]
        assert set(ids) == {"a", "b", "c", "d", "e"}

        # 'e' should rank well due to being #1 in BM25 and #5 in dense
        # With k=60, being #1 in one list contributes significantly
        e_result = next(r for r in result if r["id"] == "e")
        a_result = next(r for r in result if r["id"] == "a")

        # Both should have positive RRF scores from both lists
        assert e_result["rrf_score"] > 0
        assert a_result["rrf_score"] > 0

    def test_three_lists_contribution(self) -> None:
        """All three lists contribute to RRF scores."""
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
        ]
        bm25_code = [("a", 10.0), ("b", 5.0)]
        bm25_nlp = [("b", 8.0), ("a", 4.0)]

        result = reciprocal_rank_fusion(dense, bm25_code, bm25_nlp)

        # Both should have contributions from all three
        assert result[0]["rrf_score"] > 0
        assert result[1]["rrf_score"] > 0
        # 'a' is #1 in dense and code, 'b' is #1 in nlp
        # With k=60, being #1 in two lists beats #1 in one
        assert result[0]["id"] == "a"

    def test_k_parameter_effect(self) -> None:
        """Different k values affect relative scores."""
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
        ]

        result_k60 = reciprocal_rank_fusion(dense, [], [], k=60)
        result_k10 = reciprocal_rank_fusion(dense, [], [], k=10)

        # With smaller k, score difference between ranks is larger
        diff_k60 = result_k60[0]["rrf_score"] - result_k60[1]["rrf_score"]
        diff_k10 = result_k10[0]["rrf_score"] - result_k10[1]["rrf_score"]
        # k=10 should have larger difference
        assert diff_k10 > diff_k60

    def test_bm25_only_items_skipped(self) -> None:
        """Items only in BM25 (not dense) are gracefully handled."""
        dense = [{"id": "a", "_distance": 0.1}]
        bm25_code = [("b", 10.0), ("a", 5.0)]  # 'b' is not in dense

        result = reciprocal_rank_fusion(dense, bm25_code, [])

        # Only 'a' should appear (lazy fusion)
        assert len(result) == 1
        assert result[0]["id"] == "a"

    def test_dense_score_preserved(self) -> None:
        """Dense score is preserved in output."""
        dense = [{"id": "a", "_distance": 0.123}]
        result = reciprocal_rank_fusion(dense, [], [])

        assert result[0]["dense_score"] == 0.123

    def test_bm25_scores_preserved(self) -> None:
        """BM25 scores are preserved in output."""
        dense = [{"id": "a", "_distance": 0.1}]
        bm25_code = [("a", 15.5)]
        bm25_nlp = [("a", 12.3)]

        result = reciprocal_rank_fusion(dense, bm25_code, bm25_nlp)

        assert result[0]["bm25_code_score"] == 15.5
        assert result[0]["bm25_nlp_score"] == 12.3

    def test_known_rrf_computation(self) -> None:
        """Hand-computed RRF for known inputs matches output."""
        # With k=60:
        # rank 0 -> 1/(60+1) = 0.01639...
        # rank 1 -> 1/(60+2) = 0.01613...
        dense = [
            {"id": "a", "_distance": 0.1},
            {"id": "b", "_distance": 0.2},
        ]
        bm25_code = [("b", 10.0), ("a", 5.0)]

        result = reciprocal_rank_fusion(dense, bm25_code, [], k=60)

        # 'a': rank 0 in dense (1/61), rank 1 in bm25 (1/62)
        expected_a = 1 / 61 + 1 / 62
        # 'b': rank 1 in dense (1/62), rank 0 in bm25 (1/61)
        expected_b = 1 / 62 + 1 / 61

        # They should be equal due to symmetry
        assert abs(expected_a - expected_b) < 1e-10

        a_result = next(r for r in result if r["id"] == "a")
        b_result = next(r for r in result if r["id"] == "b")

        assert abs(a_result["rrf_score"] - expected_a) < 1e-10
        assert abs(b_result["rrf_score"] - expected_b) < 1e-10

    def test_rank_fields_attached(self) -> None:
        """Output items have rank fields for debugging."""
        dense = [{"id": "a", "_distance": 0.1}]
        bm25_code = [("a", 10.0)]

        result = reciprocal_rank_fusion(dense, bm25_code, [])

        assert result[0]["dense_rank"] == 0
        assert result[0]["bm25_code_rank"] == 0

    def test_large_lists_performance(self) -> None:
        """RRF handles larger lists without issues."""
        dense = [{"id": f"d{i}", "_distance": i * 0.01} for i in range(100)]
        bm25_code = [(f"d{99-i}", float(i)) for i in range(100)]
        bm25_nlp = [(f"d{i}", float(i)) for i in range(100)]

        result = reciprocal_rank_fusion(dense, bm25_code, bm25_nlp)

        assert len(result) == 100
        # All should have rrf_score
        assert all("rrf_score" in r for r in result)
