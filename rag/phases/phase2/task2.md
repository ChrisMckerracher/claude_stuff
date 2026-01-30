# Task 2.2: Pseudonymizer

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create a pseudonymizer that generates consistent fake data replacements, ensuring the same input always produces the same output.

## File

`rag/scrubbing/pseudonymizer.py`

## Implementation

```python
from faker import Faker

class Pseudonymizer:
    """Consistent fake data generation.

    Uses seeded Faker to ensure:
    1. Same original value always maps to same replacement
    2. Replacements are realistic-looking fake data
    3. Deterministic across runs (same seed)
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
            "US_DRIVER_LICENSE": lambda: "DL-XXXXXXXX",
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
```

## Tests

```python
def test_same_input_same_output():
    """Same original always produces same replacement."""
    p = Pseudonymizer(seed=42)
    r1 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
    r2 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
    assert r1 == r2

def test_different_inputs_different_outputs():
    """Different originals produce different replacements."""
    p = Pseudonymizer(seed=42)
    r1 = p.get_replacement("john@example.com", "EMAIL_ADDRESS")
    r2 = p.get_replacement("jane@example.com", "EMAIL_ADDRESS")
    assert r1 != r2

def test_deterministic_across_instances():
    """Same seed produces same results."""
    p1 = Pseudonymizer(seed=42)
    p2 = Pseudonymizer(seed=42)
    r1 = p1.get_replacement("john@example.com", "EMAIL_ADDRESS")
    r2 = p2.get_replacement("john@example.com", "EMAIL_ADDRESS")
    assert r1 == r2

def test_email_looks_like_email():
    """Email replacement contains @ symbol."""
    p = Pseudonymizer()
    replacement = p.get_replacement("test@test.com", "EMAIL_ADDRESS")
    assert "@" in replacement

def test_phone_looks_like_phone():
    """Phone replacement looks like phone number."""
    p = Pseudonymizer()
    replacement = p.get_replacement("555-123-4567", "PHONE_NUMBER")
    assert len(replacement) > 5  # Has some digits

def test_person_is_name():
    """Person replacement is a name."""
    p = Pseudonymizer()
    replacement = p.get_replacement("John Smith", "PERSON")
    assert " " in replacement  # First and last name

def test_ssn_is_redacted():
    """SSN is redacted, not fake."""
    p = Pseudonymizer()
    replacement = p.get_replacement("123-45-6789", "US_SSN")
    assert "XXX" in replacement

def test_unknown_type_redacted():
    """Unknown entity types are redacted."""
    p = Pseudonymizer()
    replacement = p.get_replacement("secret", "UNKNOWN_TYPE")
    assert replacement == "[REDACTED]"

def test_reset_cache():
    """Reset clears the cache."""
    p = Pseudonymizer()
    p.get_replacement("test", "PERSON")
    assert p.get_cache_stats()["PERSON"] == 1
    p.reset_cache()
    assert p.get_cache_stats() == {}
```

## Acceptance Criteria

- [ ] Same (original, entity_type) pair always returns same replacement
- [ ] Different originals return different replacements
- [ ] Same seed produces deterministic results across instances
- [ ] EMAIL_ADDRESS replacements look like emails
- [ ] PHONE_NUMBER replacements look like phone numbers
- [ ] PERSON replacements look like names
- [ ] Sensitive types (SSN, CREDIT_CARD) are redacted, not fake
- [ ] Unknown types return [REDACTED]

## Dependencies

- Faker package: `pip install faker`

## Estimated Time

20 minutes
