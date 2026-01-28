"""Corpus-type boosting based on query keywords.

Simple keyword-based heuristic that adjusts scores based on query
characteristics. Certain keywords indicate affinity for specific
corpus types.
"""

from __future__ import annotations

from typing import Any

# Boost rules: (keywords, boosted_corpus_types, multiplier)
BOOST_RULES: list[tuple[list[str], list[str], float]] = [
    # Deployment/infrastructure queries
    (
        ["deploy", "k8s", "kubernetes", "pod", "container", "helm", "docker"],
        ["CODE_DEPLOY", "DOC_RUNBOOK"],
        1.3,
    ),
    # Incident/outage queries
    (
        ["incident", "broke", "down", "outage", "alert", "error", "crash", "failing"],
        ["CONVO_SLACK", "DOC_RUNBOOK"],
        1.3,
    ),
    # How-to/procedural queries
    (
        ["how to", "steps", "procedure", "guide", "tutorial", "instructions"],
        ["DOC_RUNBOOK", "DOC_README"],
        1.2,
    ),
    # API/interface queries
    (
        ["api", "endpoint", "route", "handler", "request", "response"],
        ["CODE_LOGIC", "DOC_API"],
        1.2,
    ),
]


def apply_corpus_boost(
    query: str,
    results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Apply corpus-type boost based on query keywords.

    Scans the query for keywords and applies multipliers to matching
    corpus types. Multiple rules can stack.

    Args:
        query: The query text.
        results: List of chunk dicts with final_score or rrf_score.

    Returns:
        Results sorted by adjusted final_score descending.
    """
    if not results:
        return []

    query_lower = query.lower()

    for keywords, corpus_types, multiplier in BOOST_RULES:
        # Check if any keyword matches
        if any(kw in query_lower for kw in keywords):
            for r in results:
                corpus_type = r.get("corpus_type", "")
                if corpus_type in corpus_types:
                    base = r.get("final_score", r.get("rrf_score", 0))
                    r["final_score"] = base * multiplier

    return sorted(results, key=lambda r: r.get("final_score", 0), reverse=True)
