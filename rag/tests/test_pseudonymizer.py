"""Tests for the pseudonymizer module.

Verifies consistent pseudonymization behavior: same input produces
same output, different inputs produce different outputs.
"""

from __future__ import annotations

import pytest

from rag.scrubbing.pseudonymizer import ConsistentPseudonymizer


class TestConsistentPseudonymizer:
    """Tests for the ConsistentPseudonymizer class."""

    def test_consistent_same_input(self) -> None:
        """Same name should produce same fake name every time."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        result2 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")

        assert result1 == result2

    def test_different_inputs_different_outputs(self) -> None:
        """Different names should produce different fake names."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        result2 = pseudonymizer.pseudonymize("Bob Jones", "PERSON")

        assert result1 != result2

    def test_case_insensitive(self) -> None:
        """'jane smith' and 'Jane Smith' should produce same output."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer.pseudonymize("jane smith", "PERSON")
        result2 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        result3 = pseudonymizer.pseudonymize("JANE SMITH", "PERSON")

        assert result1 == result2 == result3

    def test_type_specific_person(self) -> None:
        """PERSON entity should generate a fake name."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("Jane Smith", "PERSON")

        # Should be a name-like string (not a redaction marker)
        assert not result.startswith("[REDACTED")
        assert len(result) > 0

    def test_type_specific_email(self) -> None:
        """EMAIL_ADDRESS entity should generate a fake email."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("jane@example.com", "EMAIL_ADDRESS")

        # Should contain @ (fake email)
        assert "@" in result
        assert not result.startswith("[REDACTED")

    def test_type_specific_phone(self) -> None:
        """PHONE_NUMBER entity should generate a fake phone number."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("555-123-4567", "PHONE_NUMBER")

        # Should be a phone-like string
        assert not result.startswith("[REDACTED")
        assert len(result) > 0

    def test_type_specific_ssn(self) -> None:
        """US_SSN entity should be redacted."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("123-45-6789", "US_SSN")

        assert result == "[REDACTED_SSN]"

    def test_type_specific_credit_card(self) -> None:
        """CREDIT_CARD entity should be redacted."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("4111111111111111", "CREDIT_CARD")

        assert result == "[REDACTED_CREDIT_CARD]"

    def test_type_specific_ip_address(self) -> None:
        """IP_ADDRESS entity should be redacted."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("192.168.1.100", "IP_ADDRESS")

        assert result == "[REDACTED_IP]"

    def test_type_specific_unknown(self) -> None:
        """Unknown entity type should use generic redaction."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("some value", "UNKNOWN_TYPE")

        assert result == "[REDACTED_UNKNOWN_TYPE]"

    def test_deterministic_with_seed(self) -> None:
        """Same seed should produce same output across instances."""
        pseudonymizer1 = ConsistentPseudonymizer(seed=42)
        pseudonymizer2 = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer1.pseudonymize("Jane Smith", "PERSON")
        result2 = pseudonymizer2.pseudonymize("Jane Smith", "PERSON")

        assert result1 == result2

    def test_different_seeds_different_outputs(self) -> None:
        """Different seeds should produce different outputs."""
        pseudonymizer1 = ConsistentPseudonymizer(seed=42)
        pseudonymizer2 = ConsistentPseudonymizer(seed=123)

        result1 = pseudonymizer1.pseudonymize("Jane Smith", "PERSON")
        result2 = pseudonymizer2.pseudonymize("Jane Smith", "PERSON")

        assert result1 != result2

    def test_cache_size_tracking(self) -> None:
        """Cache size should increase as new entities are pseudonymized."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        assert pseudonymizer.cache_size == 0

        pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        assert pseudonymizer.cache_size == 1

        pseudonymizer.pseudonymize("Jane Smith", "PERSON")  # Same input
        assert pseudonymizer.cache_size == 1

        pseudonymizer.pseudonymize("Bob Jones", "PERSON")  # Different input
        assert pseudonymizer.cache_size == 2

    def test_clear_cache(self) -> None:
        """Clearing cache should reset pseudonym mappings."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        assert pseudonymizer.cache_size == 1

        pseudonymizer.clear_cache()
        assert pseudonymizer.cache_size == 0

        # After clearing, same input may produce different output
        # (depending on Faker's internal state)
        result2 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        # The result is still a valid fake name, just might differ
        assert len(result2) > 0

    def test_whitespace_normalization(self) -> None:
        """Whitespace should be normalized in the key."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result1 = pseudonymizer.pseudonymize("Jane Smith", "PERSON")
        result2 = pseudonymizer.pseudonymize("  Jane Smith  ", "PERSON")

        assert result1 == result2

    def test_type_specific_location(self) -> None:
        """LOCATION entity should generate a fake city."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("San Francisco", "LOCATION")

        assert not result.startswith("[REDACTED")
        assert len(result) > 0

    def test_type_specific_date_time(self) -> None:
        """DATE_TIME entity should be redacted."""
        pseudonymizer = ConsistentPseudonymizer(seed=42)

        result = pseudonymizer.pseudonymize("2024-01-15", "DATE_TIME")

        assert result == "[REDACTED_DATE]"
