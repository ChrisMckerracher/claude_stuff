"""Tests for freshness weighting."""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

import pytest

from rag.retrieval.freshness import apply_freshness_boost


class TestFreshnessBoost:
    """Test cases for freshness weighting."""

    def test_empty_results(self) -> None:
        """Empty input returns empty output."""
        result = apply_freshness_boost([])
        assert result == []

    def test_non_convo_unchanged(self) -> None:
        """CODE_LOGIC chunks retain their base score."""
        results = [
            {
                "id": "a",
                "corpus_type": "CODE_LOGIC",
                "rrf_score": 0.5,
                "timestamp": "2024-01-01T10:00:00Z",
            }
        ]
        output = apply_freshness_boost(results, boost_weight=0.1)

        # Non-CONVO chunk should have final_score == rrf_score
        assert output[0]["final_score"] == 0.5

    def test_convo_without_timestamp_unchanged(self) -> None:
        """CONVO chunk without timestamp treated as non-convo."""
        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                # No timestamp
            }
        ]
        output = apply_freshness_boost(results, boost_weight=0.1)

        assert output[0]["final_score"] == 0.5

    def test_recent_convo_boosted(self) -> None:
        """Recent CONVO chunk gets boost toward 1.0."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            }
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.1,
        )

        # Decay for 1 day with 90-day half-life is nearly 1.0
        # final = 0.9 * 0.5 + 0.1 * decay ≈ 0.45 + 0.1 = 0.55
        assert output[0]["final_score"] > 0.5
        assert output[0]["final_score"] < 0.6

    def test_old_convo_penalized(self) -> None:
        """Old CONVO chunk gets decay toward 0."""
        now = datetime.now(timezone.utc)
        one_year_ago = (now - timedelta(days=365)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": one_year_ago,
            }
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.1,
        )

        # Decay for 365 days with 90-day half-life is very small
        # final = 0.9 * 0.5 + 0.1 * decay ≈ 0.45 + ~0 = 0.45
        assert output[0]["final_score"] < 0.5
        assert output[0]["final_score"] > 0.4

    def test_half_life_decay_accuracy(self) -> None:
        """Chunk exactly half_life_days old has decay ~0.5."""
        now = datetime.now(timezone.utc)
        half_life_ago = (now - timedelta(days=90)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 1.0,  # Use 1.0 for easier math
                "timestamp": half_life_ago,
            }
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=1.0,  # Use 1.0 to see raw decay
        )

        # With boost_weight=1.0, final_score = decay
        # Decay at half_life should be 0.5
        assert abs(output[0]["final_score"] - 0.5) < 0.01

    def test_zero_weight_disables_boost(self) -> None:
        """boost_weight=0 means no freshness effect."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()
        year_ago = (now - timedelta(days=365)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.8,
                "timestamp": yesterday,
            },
            {
                "id": "b",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.6,
                "timestamp": year_ago,
            },
        ]
        output = apply_freshness_boost(results, boost_weight=0.0)

        # Both should have final_score == rrf_score
        assert output[0]["final_score"] == 0.8
        assert output[1]["final_score"] == 0.6

    def test_uses_rerank_score_if_available(self) -> None:
        """Uses rerank_score as base when available."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.3,
                "rerank_score": 0.9,
                "timestamp": yesterday,
            }
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.1,
        )

        # Base should be 0.9, not 0.3
        # final ≈ 0.9 * 0.9 + 0.1 * ~1.0 = 0.81 + 0.1 = 0.91
        assert output[0]["final_score"] > 0.85

    def test_sorting_by_final_score(self) -> None:
        """Results are sorted by final_score descending."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()
        year_ago = (now - timedelta(days=365)).isoformat()

        results = [
            {
                "id": "old",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.6,
                "timestamp": year_ago,
            },
            {
                "id": "recent",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            },
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.3,
        )

        # Recent should now rank higher despite lower base score
        assert output[0]["id"] == "recent"

    def test_invalid_timestamp_handled(self) -> None:
        """Invalid timestamp format is handled gracefully."""
        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": "invalid-timestamp",
            }
        ]
        output = apply_freshness_boost(results, boost_weight=0.1)

        # Should fall back to base score
        assert output[0]["final_score"] == 0.5

    def test_future_timestamp_max_boost(self) -> None:
        """Future timestamp gets maximum decay (1.0)."""
        now = datetime.now(timezone.utc)
        tomorrow = (now + timedelta(days=1)).isoformat()

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": tomorrow,
            }
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.1,
        )

        # age_days = max(negative, 0) = 0, so decay = 1.0
        # final = 0.9 * 0.5 + 0.1 * 1.0 = 0.55
        assert abs(output[0]["final_score"] - 0.55) < 0.01

    def test_mixed_corpus_types(self) -> None:
        """Only CONVO types get freshness boost."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).isoformat()

        results = [
            {
                "id": "code",
                "corpus_type": "CODE_LOGIC",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            },
            {
                "id": "slack",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            },
            {
                "id": "teams",
                "corpus_type": "CONVO_TEAMS",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            },
        ]
        output = apply_freshness_boost(
            results,
            half_life_days=90.0,
            boost_weight=0.1,
        )

        code_result = next(r for r in output if r["id"] == "code")
        slack_result = next(r for r in output if r["id"] == "slack")
        teams_result = next(r for r in output if r["id"] == "teams")

        # Code should be unchanged
        assert code_result["final_score"] == 0.5
        # Both CONVO types should be boosted
        assert slack_result["final_score"] > 0.5
        assert teams_result["final_score"] > 0.5

    def test_timestamp_with_z_suffix(self) -> None:
        """Handles ISO timestamps with Z suffix."""
        now = datetime.now(timezone.utc)
        yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%SZ")

        results = [
            {
                "id": "a",
                "corpus_type": "CONVO_SLACK",
                "rrf_score": 0.5,
                "timestamp": yesterday,
            }
        ]
        output = apply_freshness_boost(results, boost_weight=0.1)

        # Should parse successfully and boost
        assert output[0]["final_score"] > 0.5
