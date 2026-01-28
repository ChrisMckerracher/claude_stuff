"""Tests for corpus-type query boosting."""

from __future__ import annotations

import pytest

from rag.retrieval.query_boost import BOOST_RULES, apply_corpus_boost


class TestCorpusBoost:
    """Test cases for corpus-type boosting."""

    def test_empty_results(self) -> None:
        """Empty input returns empty output."""
        result = apply_corpus_boost("test query", [])
        assert result == []

    def test_no_keywords_no_boost(self) -> None:
        """Query without boost keywords leaves scores unchanged."""
        results = [
            {"id": "a", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "b", "corpus_type": "DOC_README", "final_score": 0.4},
        ]
        output = apply_corpus_boost("how does authentication work", results)

        # No boost keywords match, scores unchanged
        assert output[0]["final_score"] == 0.5
        assert output[1]["final_score"] == 0.4

    def test_deploy_keyword_boosts_deploy_chunks(self) -> None:
        """Deploy keywords boost CODE_DEPLOY and DOC_RUNBOOK."""
        results = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "deploy", "corpus_type": "CODE_DEPLOY", "final_score": 0.4},
            {"id": "runbook", "corpus_type": "DOC_RUNBOOK", "final_score": 0.3},
        ]
        output = apply_corpus_boost("k8s deployment configuration", results)

        # Deploy and runbook should be boosted by 1.3
        deploy = next(r for r in output if r["id"] == "deploy")
        runbook = next(r for r in output if r["id"] == "runbook")
        code = next(r for r in output if r["id"] == "code")

        assert deploy["final_score"] == pytest.approx(0.4 * 1.3)
        assert runbook["final_score"] == pytest.approx(0.3 * 1.3)
        assert code["final_score"] == 0.5  # Unchanged

    def test_incident_keyword_boosts_slack(self) -> None:
        """Incident keywords boost CONVO_SLACK and DOC_RUNBOOK."""
        results = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "slack", "corpus_type": "CONVO_SLACK", "final_score": 0.4},
            {"id": "runbook", "corpus_type": "DOC_RUNBOOK", "final_score": 0.3},
        ]
        # Use query without "response" to avoid API rule match
        output = apply_corpus_boost("incident in auth service outage", results)

        slack = next(r for r in output if r["id"] == "slack")
        runbook = next(r for r in output if r["id"] == "runbook")
        code = next(r for r in output if r["id"] == "code")

        assert slack["final_score"] == pytest.approx(0.4 * 1.3)
        assert runbook["final_score"] == pytest.approx(0.3 * 1.3)
        assert code["final_score"] == 0.5

    def test_howto_keyword_boosts_docs(self) -> None:
        """How-to keywords boost documentation types."""
        results = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "readme", "corpus_type": "DOC_README", "final_score": 0.4},
            {"id": "runbook", "corpus_type": "DOC_RUNBOOK", "final_score": 0.3},
        ]
        output = apply_corpus_boost("how to setup the database", results)

        readme = next(r for r in output if r["id"] == "readme")
        runbook = next(r for r in output if r["id"] == "runbook")
        code = next(r for r in output if r["id"] == "code")

        assert readme["final_score"] == pytest.approx(0.4 * 1.2)
        assert runbook["final_score"] == pytest.approx(0.3 * 1.2)
        assert code["final_score"] == 0.5

    def test_api_keyword_boosts_code(self) -> None:
        """API keywords boost CODE_LOGIC and DOC_API."""
        results = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "api", "corpus_type": "DOC_API", "final_score": 0.4},
            {"id": "readme", "corpus_type": "DOC_README", "final_score": 0.3},
        ]
        output = apply_corpus_boost("api endpoint for user creation", results)

        code = next(r for r in output if r["id"] == "code")
        api = next(r for r in output if r["id"] == "api")
        readme = next(r for r in output if r["id"] == "readme")

        assert code["final_score"] == pytest.approx(0.5 * 1.2)
        assert api["final_score"] == pytest.approx(0.4 * 1.2)
        assert readme["final_score"] == 0.3

    def test_uses_rrf_score_as_fallback(self) -> None:
        """Uses rrf_score when final_score is not present."""
        results = [
            {"id": "deploy", "corpus_type": "CODE_DEPLOY", "rrf_score": 0.4},
        ]
        output = apply_corpus_boost("k8s deployment", results)

        assert output[0]["final_score"] == pytest.approx(0.4 * 1.3)

    def test_sorting_after_boost(self) -> None:
        """Results are re-sorted after boosting."""
        results = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.5},
            {"id": "deploy", "corpus_type": "CODE_DEPLOY", "final_score": 0.3},
        ]
        output = apply_corpus_boost("k8s deployment", results)

        # Deploy should be boosted to 0.39, still below 0.5
        # But let's test with higher base
        results2 = [
            {"id": "code", "corpus_type": "CODE_LOGIC", "final_score": 0.4},
            {"id": "deploy", "corpus_type": "CODE_DEPLOY", "final_score": 0.35},
        ]
        output2 = apply_corpus_boost("k8s deployment", results2)

        # Deploy boosted to 0.455, now above code's 0.4
        assert output2[0]["id"] == "deploy"

    def test_case_insensitive_matching(self) -> None:
        """Keywords match regardless of case."""
        results = [
            {"id": "deploy", "corpus_type": "CODE_DEPLOY", "final_score": 0.4},
        ]

        output1 = apply_corpus_boost("K8S DEPLOYMENT", results.copy())
        output2 = apply_corpus_boost("k8s deployment", results.copy())
        output3 = apply_corpus_boost("K8s Deployment", results.copy())

        assert output1[0]["final_score"] == output2[0]["final_score"]
        assert output2[0]["final_score"] == output3[0]["final_score"]

    def test_non_matching_corpus_types_preserved(self) -> None:
        """Corpus types not in boost rules keep original score."""
        results = [
            {"id": "custom", "corpus_type": "CUSTOM_TYPE", "final_score": 0.5},
        ]
        output = apply_corpus_boost("k8s deployment", results)

        assert output[0]["final_score"] == 0.5

    def test_multiple_rules_can_stack(self) -> None:
        """Multiple matching rules can boost the same chunk."""
        # DOC_RUNBOOK is boosted by both deploy and incident keywords
        results = [
            {"id": "runbook", "corpus_type": "DOC_RUNBOOK", "final_score": 0.4},
        ]
        # Query has both deploy AND incident keywords
        output = apply_corpus_boost("k8s deployment incident response", results)

        # Should be boosted by 1.3 (deploy) then 1.3 again (incident)
        expected = 0.4 * 1.3 * 1.3
        assert output[0]["final_score"] == pytest.approx(expected)

    def test_boost_rules_structure(self) -> None:
        """BOOST_RULES has expected structure."""
        assert len(BOOST_RULES) > 0
        for keywords, corpus_types, multiplier in BOOST_RULES:
            assert isinstance(keywords, list)
            assert len(keywords) > 0
            assert isinstance(corpus_types, list)
            assert len(corpus_types) > 0
            assert isinstance(multiplier, float)
            assert multiplier > 1.0  # Should boost, not penalize
