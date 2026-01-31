"""Consistent pseudonymization for PHI replacement.

Generates realistic fake data that is deterministic:
same input always maps to same output within a session.
"""

from __future__ import annotations

from faker import Faker


class Pseudonymizer:
    """Consistent fake data generation.

    Uses seeded Faker to ensure:
    1. Same original value always maps to same replacement
    2. Replacements are realistic-looking fake data
    3. Deterministic across runs (same seed)

    Example:
        p = Pseudonymizer(seed=42)
        r1 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        r2 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
        assert r1 == r2  # Always the same
    """

    def __init__(self, seed: int = 42):
        """Initialize with seed for determinism.

        Args:
            seed: Random seed for Faker (default: 42)
        """
        self._faker = Faker()
        self._faker.seed_instance(seed)
        self._cache: dict[str, str] = {}  # (type:original) -> replacement

    def get_replacement(self, original: str, entity_type: str) -> str:
        """Get consistent replacement for original value.

        Args:
            original: Original PII value (e.g., "john@example.com")
            entity_type: Presidio entity type (e.g., "EMAIL_ADDRESS")

        Returns:
            Fake replacement that is consistent for this (original, entity_type) pair
        """
        cache_key = f"{entity_type}:{original}"

        if cache_key not in self._cache:
            self._cache[cache_key] = self._generate(entity_type)

        return self._cache[cache_key]

    def _generate(self, entity_type: str) -> str:
        """Generate fake data by entity type.

        Args:
            entity_type: Presidio entity type

        Returns:
            Appropriate fake data for the type
        """
        generators = {
            "PERSON": self._faker.name,
            "EMAIL_ADDRESS": self._faker.email,
            "PHONE_NUMBER": self._faker.phone_number,
            "US_SSN": lambda: "XXX-XX-XXXX",
            "CREDIT_CARD": lambda: "XXXX-XXXX-XXXX-XXXX",
            "DATE_TIME": self._faker.date,
            "LOCATION": self._faker.city,
            "IP_ADDRESS": lambda: "XXX.XXX.XXX.XXX",
            "US_DRIVER_LICENSE": lambda: "DL-XXXXXXXX",
            "IBAN_CODE": lambda: "XXXX-XXXX-XXXX-XXXX",
            "US_BANK_NUMBER": lambda: "XXXX-XXXX",
            "US_PASSPORT": lambda: "XXXXXXXXX",
            "CRYPTO": lambda: "XXXX...XXXX",
        }

        generator = generators.get(entity_type, lambda: "[REDACTED]")
        return generator()

    def reset_cache(self) -> None:
        """Clear the replacement cache.

        Use this when starting a new document/batch where
        you want fresh pseudonyms.
        """
        self._cache.clear()

    def get_cache_stats(self) -> dict[str, int]:
        """Get cache statistics for debugging.

        Returns:
            Dict with entity type -> count of cached replacements
        """
        stats: dict[str, int] = {}
        for key in self._cache:
            entity_type = key.split(":")[0]
            stats[entity_type] = stats.get(entity_type, 0) + 1
        return stats
