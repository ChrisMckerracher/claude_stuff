"""Tests for Pseudonymizer."""

import pytest

from rag.scrubbing.pseudonymizer import Pseudonymizer


class TestPseudonymizerConsistency:
    """Test that pseudonymization is consistent."""

    def test_same_input_same_output(self) -> None:
        """Same original always produces same replacement."""
        p = Pseudonymizer(seed=42)
        r1 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        r2 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        assert r1 == r2

    def test_different_inputs_different_outputs(self) -> None:
        """Different originals produce different replacements."""
        p = Pseudonymizer(seed=42)
        r1 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        r2 = p.get_replacement("jane@example.com", "EMAIL_ADDRESS")
        assert r1 != r2

    def test_deterministic_across_instances(self) -> None:
        """Same seed produces same results."""
        p1 = Pseudonymizer(seed=42)
        p2 = Pseudonymizer(seed=42)
        r1 = p1.get_replacement("john@example.com", "EMAIL_ADDRESS")
        r2 = p2.get_replacement("john@example.com", "EMAIL_ADDRESS")
        assert r1 == r2

    def test_different_seeds_different_results(self) -> None:
        """Different seeds produce different results."""
        p1 = Pseudonymizer(seed=42)
        p2 = Pseudonymizer(seed=100)
        r1 = p1.get_replacement("john@example.com", "EMAIL_ADDRESS")
        r2 = p2.get_replacement("john@example.com", "EMAIL_ADDRESS")
        assert r1 != r2


class TestPseudonymizerTypes:
    """Test entity-type-specific replacements."""

    def test_email_looks_like_email(self) -> None:
        """Email replacement contains @ symbol."""
        p = Pseudonymizer()
        replacement = p.get_replacement("test@test.com", "EMAIL_ADDRESS")
        assert "@" in replacement

    def test_phone_has_content(self) -> None:
        """Phone replacement has content."""
        p = Pseudonymizer()
        replacement = p.get_replacement("555-123-4567", "PHONE_NUMBER")
        assert len(replacement) > 5

    def test_person_is_name(self) -> None:
        """Person replacement is a name with first and last."""
        p = Pseudonymizer()
        replacement = p.get_replacement("John Smith", "PERSON")
        assert " " in replacement  # First and last name

    def test_ssn_is_redacted(self) -> None:
        """SSN is redacted with XXX pattern."""
        p = Pseudonymizer()
        replacement = p.get_replacement("123-45-6789", "US_SSN")
        assert "XXX" in replacement

    def test_credit_card_is_redacted(self) -> None:
        """Credit card is redacted."""
        p = Pseudonymizer()
        replacement = p.get_replacement("4111-1111-1111-1111", "CREDIT_CARD")
        assert "XXXX" in replacement

    def test_ip_is_redacted(self) -> None:
        """IP address is redacted."""
        p = Pseudonymizer()
        replacement = p.get_replacement("192.168.1.1", "IP_ADDRESS")
        assert "XXX" in replacement

    def test_unknown_type_redacted(self) -> None:
        """Unknown entity types are redacted."""
        p = Pseudonymizer()
        replacement = p.get_replacement("secret", "UNKNOWN_TYPE")
        assert replacement == "[REDACTED]"


class TestPseudonymizerCache:
    """Test cache behavior."""

    def test_reset_cache(self) -> None:
        """Reset clears the cache."""
        p = Pseudonymizer()
        p.get_replacement("test", "PERSON")
        assert p.get_cache_stats()["PERSON"] == 1
        p.reset_cache()
        assert p.get_cache_stats() == {}

    def test_cache_stats_counts_by_type(self) -> None:
        """Cache stats count by entity type."""
        p = Pseudonymizer()
        p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        p.get_replacement("jane@example.com", "EMAIL_ADDRESS")
        p.get_replacement("555-1234", "PHONE_NUMBER")

        stats = p.get_cache_stats()
        assert stats["EMAIL_ADDRESS"] == 2
        assert stats["PHONE_NUMBER"] == 1
