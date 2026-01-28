"""Consistent pseudonymization using Faker.

Same real name → same fake name across all chunks.
This improves RAG recall because entity references remain consistent.
"""

from __future__ import annotations

from faker import Faker


class ConsistentPseudonymizer:
    """Generate consistent fake replacements for PHI entities.

    Uses a seeded Faker instance to ensure deterministic output.
    The same input text with the same entity type always produces
    the same fake replacement.

    Thread-safe after initialization (cache uses immutable keys).
    """

    def __init__(self, seed: int = 42) -> None:
        """Initialize with a seed for reproducibility.

        Args:
            seed: Random seed for Faker. Same seed = same fake outputs.
        """
        self._faker = Faker()
        self._faker.seed_instance(seed)
        self._seed = seed
        self._cache: dict[str, str] = {}

    def pseudonymize(self, entity_text: str, entity_type: str) -> str:
        """Generate a consistent fake replacement for an entity.

        Args:
            entity_text: The original text (e.g., "Jane Smith")
            entity_type: The Presidio entity type (e.g., "PERSON")

        Returns:
            A fake replacement that is consistent across calls
        """
        # Normalize key: lowercase and strip whitespace
        key = f"{entity_type}:{entity_text.lower().strip()}"

        if key not in self._cache:
            self._cache[key] = self._generate_fake(entity_type)

        return self._cache[key]

    def _generate_fake(self, entity_type: str) -> str:
        """Generate a fake value based on entity type.

        Args:
            entity_type: The Presidio entity type

        Returns:
            A fake replacement appropriate for the entity type
        """
        if entity_type == "PERSON":
            return str(self._faker.name())
        elif entity_type == "EMAIL_ADDRESS":
            return str(self._faker.email())
        elif entity_type == "PHONE_NUMBER":
            return str(self._faker.phone_number())
        elif entity_type == "US_SSN":
            return "[REDACTED_SSN]"
        elif entity_type == "CREDIT_CARD":
            return "[REDACTED_CREDIT_CARD]"
        elif entity_type == "IP_ADDRESS":
            return "[REDACTED_IP]"
        elif entity_type == "MEDICAL_LICENSE":
            return "[REDACTED_MEDICAL_LICENSE]"
        elif entity_type == "US_DRIVER_LICENSE":
            return "[REDACTED_DRIVER_LICENSE]"
        elif entity_type == "LOCATION":
            return str(self._faker.city())
        elif entity_type == "DATE_TIME":
            return "[REDACTED_DATE]"
        elif entity_type == "NRP":  # Nationality, religious, political group
            return "[REDACTED_NRP]"
        elif entity_type == "URL":
            return "[REDACTED_URL]"
        else:
            return f"[REDACTED_{entity_type}]"

    def clear_cache(self) -> None:
        """Clear the pseudonym cache.

        Useful for testing or when you want fresh pseudonyms.
        """
        self._cache.clear()

    @property
    def cache_size(self) -> int:
        """Number of cached pseudonyms."""
        return len(self._cache)
