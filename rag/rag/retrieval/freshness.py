"""Freshness weighting for conversation chunks.

Applies exponential decay boost to CONVO_* chunks based on their
timestamp, favoring more recent conversations.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any


def apply_freshness_boost(
    results: list[dict[str, Any]],
    half_life_days: float = 90.0,
    boost_weight: float = 0.1,
) -> list[dict[str, Any]]:
    """Apply exponential decay freshness boost to conversation chunks.

    Only CONVO_* corpus types with timestamps are boosted. Other chunks
    retain their original score as final_score.

    The formula is:
        final_score = (1 - boost_weight) * base_score + boost_weight * decay
        decay = exp(-0.693 * age_days / half_life_days)

    Args:
        results: List of chunk dicts with scores and metadata.
        half_life_days: Days until decay factor reaches 0.5.
        boost_weight: How much freshness affects the final score (0-1).

    Returns:
        Results sorted by final_score descending.
    """
    if not results:
        return []

    now = datetime.now(timezone.utc)

    for r in results:
        # Use rerank_score if available, otherwise rrf_score
        base_score = r.get("rerank_score", r.get("rrf_score", 0.0))

        corpus_type = r.get("corpus_type", "")
        timestamp = r.get("timestamp")

        # Only boost conversation chunks with timestamps
        if corpus_type.startswith("CONVO_") and timestamp:
            try:
                ts = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                age_days = max((now - ts).total_seconds() / 86400, 0)
                # Exponential decay: half_life gives decay of 0.5
                decay = math.exp(-0.693 * age_days / half_life_days)
                r["final_score"] = (
                    (1 - boost_weight) * base_score + boost_weight * decay
                )
            except (ValueError, TypeError):
                # Invalid timestamp - treat as non-convo
                r["final_score"] = base_score
        else:
            r["final_score"] = base_score

    return sorted(results, key=lambda r: r.get("final_score", 0), reverse=True)
