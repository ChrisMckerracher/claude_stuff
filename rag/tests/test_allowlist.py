"""Tests for the allowlist module.

Verifies that known false positives are correctly filtered out
while real PHI entities are preserved.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from rag.scrubbing.allowlist import Allowlist


@dataclass
class MockRecognizerResult:
    """Mock Presidio RecognizerResult for testing."""

    entity_type: str
    start: int
    end: int
    score: float = 0.85


class TestAllowlist:
    """Tests for the Allowlist class."""

    def test_filter_known_keywords_nil(self) -> None:
        """'nil' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "if value == nil { return }"

        results = [MockRecognizerResult("PERSON", 12, 15)]  # "nil"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_filter_known_keywords_null(self) -> None:
        """'null' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "const value = null;"

        results = [MockRecognizerResult("PERSON", 14, 18)]  # "null"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_filter_tech_terms_redis(self) -> None:
        """'Redis' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "Connect to Redis cluster"

        results = [MockRecognizerResult("PERSON", 11, 16)]  # "Redis"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_filter_tech_terms_docker(self) -> None:
        """'Docker' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "Run in Docker container"

        results = [MockRecognizerResult("PERSON", 7, 13)]  # "Docker"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_real_name_not_filtered(self) -> None:
        """'Jane Smith' should NOT be filtered (not in allowlist)."""
        allowlist = Allowlist()
        text = "Contact Jane Smith for details"

        results = [MockRecognizerResult("PERSON", 8, 18)]  # "Jane Smith"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 1
        assert text[filtered[0].start : filtered[0].end] == "Jane Smith"

    def test_custom_extra_terms(self) -> None:
        """Extra allowlist terms should be respected."""
        allowlist = Allowlist(extra_terms=frozenset({"customterm", "anotherterm"}))
        text = "Check with CustomTerm about the project"

        results = [MockRecognizerResult("PERSON", 11, 21)]  # "CustomTerm"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_case_insensitive_nil(self) -> None:
        """'NIL' (uppercase) should also be filtered."""
        allowlist = Allowlist()
        text = "if value == NIL { return }"

        results = [MockRecognizerResult("PERSON", 12, 15)]  # "NIL"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_case_insensitive_mixed(self) -> None:
        """'Docker' with mixed case should be filtered."""
        allowlist = Allowlist()
        text = "Run in DOCKER container"

        results = [MockRecognizerResult("PERSON", 7, 13)]  # "DOCKER"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_multiple_results_mixed_filtering(self) -> None:
        """Filter should remove allowlisted while keeping real names."""
        allowlist = Allowlist()
        text = "Jane Smith uses docker and redis daily"

        results = [
            MockRecognizerResult("PERSON", 0, 10),  # "Jane Smith" - keep
            MockRecognizerResult("PERSON", 16, 22),  # "docker" - filter
            MockRecognizerResult("PERSON", 27, 32),  # "redis" - filter
        ]

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 1
        assert text[filtered[0].start : filtered[0].end] == "Jane Smith"

    def test_is_allowed_method(self) -> None:
        """Test the is_allowed method directly."""
        allowlist = Allowlist()

        assert allowlist.is_allowed("nil")
        assert allowlist.is_allowed("NULL")
        assert allowlist.is_allowed("  Docker  ")  # with whitespace
        assert not allowlist.is_allowed("Jane Smith")
        assert not allowlist.is_allowed("john.doe@example.com")

    def test_all_terms_property(self) -> None:
        """Test that all_terms includes both default and extra terms."""
        allowlist = Allowlist(extra_terms=frozenset({"myterm"}))

        assert "nil" in allowlist.all_terms
        assert "docker" in allowlist.all_terms
        assert "myterm" in allowlist.all_terms
        assert "jane smith" not in allowlist.all_terms

    def test_filter_admin_keyword(self) -> None:
        """'admin' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "Contact admin for help"

        results = [MockRecognizerResult("PERSON", 8, 13)]  # "admin"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_filter_master_keyword(self) -> None:
        """'master' flagged as PERSON should be filtered out."""
        allowlist = Allowlist()
        text = "Push to master branch"

        results = [MockRecognizerResult("PERSON", 8, 14)]  # "master"

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 0

    def test_preserves_email_entities(self) -> None:
        """Email addresses should not be filtered by allowlist."""
        allowlist = Allowlist()
        text = "Email admin@company.com for help"

        results = [MockRecognizerResult("EMAIL_ADDRESS", 6, 23)]

        filtered = allowlist.filter(results, text)  # type: ignore[arg-type]
        assert len(filtered) == 1

    def test_empty_results(self) -> None:
        """Empty results list should return empty list."""
        allowlist = Allowlist()

        filtered = allowlist.filter([], "any text")  # type: ignore[arg-type]
        assert filtered == []
