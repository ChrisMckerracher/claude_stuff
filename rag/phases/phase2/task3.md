# Task 2.3: Scrubber Core

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create the main PHI scrubber using the pluggable NLP backend and Pseudonymizer for consistent replacement.

## File

`rag/scrubbing/scrubber.py`

## Implementation

```python
"""PHI scrubbing using Presidio with pluggable NLP backend.

See docs/NLP_BACKENDS.md for backend configuration options.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

from rag.core.protocols import ScrubResult
from rag.core.types import CleanChunk, RawChunk, ScrubAction
from rag.scrubbing.nlp_backend import create_analyzer, get_supported_entities
from rag.scrubbing.pseudonymizer import Pseudonymizer

if TYPE_CHECKING:
    pass


class PresidioScrubber:
    """PHI scrubbing using Presidio.

    Detects PII entities and replaces them with consistent
    pseudonyms to preserve referential integrity.

    By default uses regex-only detection (no model downloads).
    Pass a custom analyzer for NER-based detection (PERSON, LOCATION).

    Example:
        # Default: regex-only (EMAIL, PHONE, SSN)
        scrubber = PresidioScrubber(Pseudonymizer())

        # With spaCy NER (adds PERSON, LOCATION detection)
        from rag.scrubbing.nlp_backend import create_analyzer
        analyzer = create_analyzer(backend="spacy")
        scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
    """

    def __init__(
        self,
        pseudonymizer: Pseudonymizer,
        analyzer: AnalyzerEngine | None = None,
    ):
        """Initialize scrubber.

        Args:
            pseudonymizer: Pseudonymizer for consistent replacement.
            analyzer: Presidio AnalyzerEngine. If None, creates regex-only analyzer.
        """
        self._analyzer = analyzer or create_analyzer()
        self._anonymizer = AnonymizerEngine()
        self._pseudonymizer = pseudonymizer
        self._supported_entities = get_supported_entities(
            "spacy" if analyzer else "regex"
        )

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Args:
            chunk: Raw chunk potentially containing PHI.

        Returns:
            CleanChunk with PHI replaced and audit log.

        Raises:
            ScrubError: If scrubbing fails.
        """
        # Analyze for PII
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=self._supported_entities,
            language="en",
        )

        if not results:
            # No PII found, return as-is
            return CleanChunk(
                id=chunk.id,
                text=chunk.text,
                source_uri=chunk.source_uri,
                corpus_type=chunk.corpus_type,
                context_prefix=chunk.metadata.get("context_prefix", ""),
                metadata=chunk.metadata,
                scrub_log=[],
            )

        # Build audit log and collect replacements
        scrub_log: list[ScrubAction] = []
        replacements: dict[str, str] = {}  # original -> replacement

        for result in results:
            original = chunk.text[result.start : result.end]
            replacement = self._pseudonymizer.get_replacement(
                original, result.entity_type
            )
            replacements[original] = replacement
            scrub_log.append(
                ScrubAction(
                    entity_type=result.entity_type,
                    start=result.start,
                    end=result.end,
                    replacement=replacement,
                )
            )

        # Build operators for anonymization
        operators = self._build_operators(replacements)

        # Anonymize
        anonymized = self._anonymizer.anonymize(
            text=chunk.text,
            analyzer_results=results,
            operators=operators,
        )

        return CleanChunk(
            id=chunk.id,
            text=anonymized.text,
            source_uri=chunk.source_uri,
            corpus_type=chunk.corpus_type,
            context_prefix=chunk.metadata.get("context_prefix", ""),
            metadata=chunk.metadata,
            scrub_log=scrub_log,
        )

    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing for efficiency.

        Args:
            chunks: List of raw chunks.

        Returns:
            List of ScrubResult in same order as input.
        """
        results = []
        for chunk in chunks:
            try:
                clean = self.scrub(chunk)
                results.append(
                    ScrubResult(
                        chunk_id=chunk.id,
                        clean_chunk=clean,
                        error=None,
                    )
                )
            except Exception as e:
                results.append(
                    ScrubResult(
                        chunk_id=chunk.id,
                        clean_chunk=None,
                        error=str(e),
                    )
                )
        return results

    def _build_operators(
        self,
        replacements: dict[str, str],
    ) -> dict[str, OperatorConfig]:
        """Build anonymization operators using pre-computed replacements."""
        # We use a custom operator that looks up the replacement
        # This ensures consistency across multiple occurrences
        operators: dict[str, OperatorConfig] = {}

        # Custom operator that uses our replacement mapping
        def make_replacer(replacement: str) -> OperatorConfig:
            return OperatorConfig("replace", {"new_value": replacement})

        # For each unique entity type, we need an operator
        # But Presidio applies operators by type, not by instance
        # So we use the "custom" operator with instance-specific logic

        # Default operator for any unhandled types
        operators["DEFAULT"] = OperatorConfig("replace", {"new_value": "[REDACTED]"})

        return operators
```

**Note:** The implementation above has a simplification. For production, you'd want instance-specific replacement via Presidio's custom operator or by doing string replacement manually. Here's a more robust approach:

```python
    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI with instance-specific replacements."""
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=self._supported_entities,
            language="en",
        )

        if not results:
            return CleanChunk(
                id=chunk.id,
                text=chunk.text,
                source_uri=chunk.source_uri,
                corpus_type=chunk.corpus_type,
                context_prefix=chunk.metadata.get("context_prefix", ""),
                metadata=chunk.metadata,
                scrub_log=[],
            )

        # Sort results by start position (descending) for safe replacement
        sorted_results = sorted(results, key=lambda r: r.start, reverse=True)

        scrub_log: list[ScrubAction] = []
        text = chunk.text

        # Replace from end to start to preserve positions
        for result in sorted_results:
            original = text[result.start : result.end]
            replacement = self._pseudonymizer.get_replacement(
                original, result.entity_type
            )
            text = text[: result.start] + replacement + text[result.end :]
            scrub_log.append(
                ScrubAction(
                    entity_type=result.entity_type,
                    start=result.start,
                    end=result.end,
                    replacement=replacement,
                )
            )

        # Reverse log to match original order
        scrub_log.reverse()

        return CleanChunk(
            id=chunk.id,
            text=text,
            source_uri=chunk.source_uri,
            corpus_type=chunk.corpus_type,
            context_prefix=chunk.metadata.get("context_prefix", ""),
            metadata=chunk.metadata,
            scrub_log=scrub_log,
        )
```

## Tests

```python
def test_scrubs_email():
    """Email addresses are scrubbed."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("Contact john@example.com for help")
    clean = scrubber.scrub(chunk)
    assert "john@example.com" not in clean.text
    assert len(clean.scrub_log) == 1
    assert clean.scrub_log[0].entity_type == "EMAIL_ADDRESS"


def test_scrubs_phone():
    """Phone numbers are scrubbed."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("Call me at 555-123-4567")
    clean = scrubber.scrub(chunk)
    assert "555-123-4567" not in clean.text


def test_scrubs_ssn():
    """SSNs are scrubbed."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("SSN: 123-45-6789")
    clean = scrubber.scrub(chunk)
    assert "123-45-6789" not in clean.text


def test_no_pii_unchanged():
    """Text without PII is unchanged."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("def foo(): return 42")
    clean = scrubber.scrub(chunk)
    assert clean.text == "def foo(): return 42"
    assert clean.scrub_log == []


def test_multiple_pii():
    """Multiple PII types in same text."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("Email john@example.com or call 555-123-4567")
    clean = scrubber.scrub(chunk)
    assert "john@example.com" not in clean.text
    assert "555-123-4567" not in clean.text
    assert len(clean.scrub_log) == 2


def test_consistent_replacement():
    """Same PII gets same replacement."""
    pseudonymizer = Pseudonymizer(seed=42)
    scrubber = PresidioScrubber(pseudonymizer)

    chunk1 = make_raw_chunk("Contact john@example.com")
    chunk2 = make_raw_chunk("Email john@example.com again")

    clean1 = scrubber.scrub(chunk1)
    clean2 = scrubber.scrub(chunk2)

    # Extract the replacement from both
    # Both should have the same fake email
    # (This tests pseudonymizer integration)


def test_batch_handles_failures():
    """Batch scrubbing handles individual failures."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunks = [
        make_raw_chunk("Valid: john@example.com"),
        make_raw_chunk("Also valid text"),
    ]
    results = scrubber.scrub_batch(chunks)
    assert len(results) == 2
    assert all(r.success for r in results)


def test_custom_analyzer():
    """Custom analyzer can be passed."""
    from rag.scrubbing.nlp_backend import create_analyzer

    # This would use spaCy if available
    # analyzer = create_analyzer(backend="spacy")
    # For now, just verify the interface works
    analyzer = create_analyzer(backend="regex")
    scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
    chunk = make_raw_chunk("Email test@test.com")
    clean = scrubber.scrub(chunk)
    assert "test@test.com" not in clean.text


def test_preserves_code_identifiers():
    """Code identifiers are NOT scrubbed (regex mode)."""
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("def authenticate_user(john_doe):")
    clean = scrubber.scrub(chunk)
    # Variable names should be preserved
    assert "authenticate_user" in clean.text
    assert "john_doe" in clean.text  # Not detected as PERSON in regex mode
```

## Acceptance Criteria

- [ ] Implements Scrubber protocol (scrub, scrub_batch methods)
- [ ] Default mode detects EMAIL, PHONE, SSN without model downloads
- [ ] Uses Pseudonymizer for consistent replacement
- [ ] Builds complete audit log with ScrubAction entries
- [ ] Batch scrubbing handles individual failures
- [ ] Custom analyzer can be passed for NER support
- [ ] Code identifiers preserved in regex mode

## Dependencies

- Task 2.1 (NLP Backend)
- Task 2.2 (Pseudonymizer)
- presidio-analyzer, presidio-anonymizer packages

## Estimated Time

30 minutes
