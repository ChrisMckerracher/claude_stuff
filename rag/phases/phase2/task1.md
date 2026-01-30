# Task 2.1: Scrubber Core

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create the main PHI scrubber using Presidio for detection and the Pseudonymizer for replacement.

## File

`rag/scrubbing/scrubber.py`

## Implementation

```python
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig
from rag.core.types import RawChunk, CleanChunk, ScrubAction
from rag.core.protocols import Scrubber, ScrubResult
from rag.scrubbing.pseudonymizer import Pseudonymizer

class PresidioScrubber:
    """PHI scrubbing using Presidio.

    Detects PII entities and replaces them with consistent
    pseudonyms to preserve referential integrity.
    """

    # Entity types to detect
    ENTITIES = ["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN", "CREDIT_CARD"]

    def __init__(self, pseudonymizer: Pseudonymizer):
        """Initialize scrubber.

        Args:
            pseudonymizer: Pseudonymizer for consistent replacement
        """
        self._analyzer = AnalyzerEngine()
        self._anonymizer = AnonymizerEngine()
        self._pseudonymizer = pseudonymizer

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Args:
            chunk: Raw chunk potentially containing PHI

        Returns:
            CleanChunk with PHI replaced and audit log

        Raises:
            ScrubError: If scrubbing fails
        """
        # Analyze for PII
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=self.ENTITIES,
            language="en",
        )

        # Build operators for pseudonymization
        operators = self._build_operators(chunk.text, results)

        # Anonymize
        anonymized = self._anonymizer.anonymize(
            text=chunk.text,
            analyzer_results=results,
            operators=operators,
        )

        # Build audit log
        scrub_log = self._build_audit_log(chunk.text, results, operators)

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
            chunks: List of raw chunks

        Returns:
            List of ScrubResult in same order as input
        """
        results = []
        for chunk in chunks:
            try:
                clean = self.scrub(chunk)
                results.append(ScrubResult(
                    chunk_id=chunk.id,
                    clean_chunk=clean,
                    error=None,
                ))
            except Exception as e:
                results.append(ScrubResult(
                    chunk_id=chunk.id,
                    clean_chunk=None,
                    error=str(e),
                ))
        return results

    def _build_operators(
        self,
        text: str,
        results: list,
    ) -> dict[str, OperatorConfig]:
        """Build pseudonymization operators for each entity type."""
        operators = {}

        for result in results:
            entity_type = result.entity_type
            original = text[result.start:result.end]
            replacement = self._pseudonymizer.get_replacement(original, entity_type)

            if entity_type not in operators:
                operators[entity_type] = OperatorConfig(
                    "custom",
                    {"lambda": lambda x, r=replacement: r}
                )

        # Default operator for unhandled types
        operators["DEFAULT"] = OperatorConfig("replace", {"new_value": "[REDACTED]"})

        return operators

    def _build_audit_log(
        self,
        original_text: str,
        results: list,
        operators: dict,
    ) -> list[ScrubAction]:
        """Build audit log of what was scrubbed."""
        log = []
        for result in results:
            original = original_text[result.start:result.end]
            replacement = self._pseudonymizer.get_replacement(original, result.entity_type)
            log.append(ScrubAction(
                entity_type=result.entity_type,
                start=result.start,
                end=result.end,
                replacement=replacement,
            ))
        return log
```

## Tests

```python
def test_scrubs_email():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("Contact john@example.com for help")
    clean = scrubber.scrub(chunk)
    assert "john@example.com" not in clean.text
    assert len(clean.scrub_log) == 1
    assert clean.scrub_log[0].entity_type == "EMAIL_ADDRESS"

def test_scrubs_phone():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("Call me at 555-123-4567")
    clean = scrubber.scrub(chunk)
    assert "555-123-4567" not in clean.text

def test_scrubs_person_name():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("John Smith wrote this code")
    clean = scrubber.scrub(chunk)
    assert "John Smith" not in clean.text

def test_preserves_code_identifiers():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = make_raw_chunk("def authenticate_user(john_doe):")
    clean = scrubber.scrub(chunk)
    # Code identifiers should be preserved
    assert "authenticate_user" in clean.text
    assert "john_doe" in clean.text  # Variable name, not person

def test_batch_handles_failures():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunks = [
        make_raw_chunk("Valid text"),
        make_raw_chunk_with_encoding_issue(),
    ]
    results = scrubber.scrub_batch(chunks)
    assert len(results) == 2
    assert results[0].success
    # Second may fail but shouldn't crash
```

## Acceptance Criteria

- [ ] Implements Scrubber protocol
- [ ] Detects PERSON, EMAIL, PHONE, SSN, CREDIT_CARD
- [ ] Uses Pseudonymizer for consistent replacement
- [ ] Builds complete audit log
- [ ] Does NOT scrub code identifiers (function names, variables)
- [ ] Batch scrubbing handles individual failures

## Dependencies

- Task 0.1 (types for RawChunk, CleanChunk, ScrubAction)
- Task 2.2 (Pseudonymizer)
- presidio-analyzer, presidio-anonymizer packages

## Estimated Time

30 minutes
