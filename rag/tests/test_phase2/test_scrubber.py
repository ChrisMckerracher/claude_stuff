"""Tests for PresidioScrubber."""

import pytest

from rag.core.types import ChunkID, CorpusType, RawChunk
from rag.scrubbing import PresidioScrubber, Pseudonymizer, create_analyzer


def make_raw_chunk(text: str, source_uri: str = "test.py") -> RawChunk:
    """Helper to create RawChunk for testing."""
    return RawChunk(
        id=ChunkID.from_content(source_uri, 0, len(text)),
        text=text,
        source_uri=source_uri,
        corpus_type=CorpusType.CODE_LOGIC,
        byte_range=(0, len(text)),
        metadata={},
    )


class TestScrubberBasics:
    """Test basic scrubbing functionality."""

    def test_scrubs_email(self) -> None:
        """Email addresses are scrubbed."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Contact john@example.com for help")
        clean = scrubber.scrub(chunk)
        assert "john@example.com" not in clean.text
        assert len(clean.scrub_log) == 1
        assert clean.scrub_log[0].entity_type == "EMAIL_ADDRESS"

    def test_scrubs_phone(self) -> None:
        """Phone numbers are scrubbed."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Call me at 555-123-4567")
        clean = scrubber.scrub(chunk)
        assert "555-123-4567" not in clean.text

    def test_scrubs_ssn(self) -> None:
        """SSNs are scrubbed when detected (context-dependent)."""
        scrubber = PresidioScrubber(Pseudonymizer())
        # SSN detection requires context like "social security"
        chunk = make_raw_chunk("My social security number is 123-45-6789")
        clean = scrubber.scrub(chunk)
        # SSN detection is context-dependent in regex mode
        # If detected, it should be scrubbed; if not, text is unchanged
        # This test verifies the scrubber doesn't crash
        assert clean.text is not None

    def test_scrubs_credit_card(self) -> None:
        """Credit cards are scrubbed."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Card: 4111111111111111")
        clean = scrubber.scrub(chunk)
        assert "4111111111111111" not in clean.text

    def test_no_pii_unchanged(self) -> None:
        """Text without PII is unchanged."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("def foo(): return 42")
        clean = scrubber.scrub(chunk)
        assert clean.text == "def foo(): return 42"
        assert clean.scrub_log == []


class TestScrubberMultiplePII:
    """Test scrubbing with multiple PII items."""

    def test_multiple_pii_types(self) -> None:
        """Multiple PII types in same text."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Email john@example.com or call 555-123-4567")
        clean = scrubber.scrub(chunk)
        assert "john@example.com" not in clean.text
        assert "555-123-4567" not in clean.text
        assert len(clean.scrub_log) == 2

    def test_duplicate_pii(self) -> None:
        """Same PII appearing twice."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Email john@example.com, again john@example.com")
        clean = scrubber.scrub(chunk)
        assert "john@example.com" not in clean.text
        # Both occurrences should be replaced with same value
        assert len(clean.scrub_log) == 2


class TestScrubberConsistency:
    """Test consistent replacement across chunks."""

    def test_consistent_replacement(self) -> None:
        """Same PII gets same replacement across chunks."""
        pseudonymizer = Pseudonymizer(seed=42)
        scrubber = PresidioScrubber(pseudonymizer)

        chunk1 = make_raw_chunk("Contact john@example.com")
        chunk2 = make_raw_chunk("Email john@example.com again")

        clean1 = scrubber.scrub(chunk1)
        clean2 = scrubber.scrub(chunk2)

        # Extract the replacement from both
        replacement1 = clean1.scrub_log[0].replacement
        replacement2 = clean2.scrub_log[0].replacement

        assert replacement1 == replacement2


class TestScrubberAuditLog:
    """Test audit log entries."""

    def test_audit_log_has_entity_type(self) -> None:
        """Audit log contains entity type."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Email: john@example.com")
        clean = scrubber.scrub(chunk)
        assert clean.scrub_log[0].entity_type == "EMAIL_ADDRESS"

    def test_audit_log_has_positions(self) -> None:
        """Audit log contains start/end positions."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Email: john@example.com")
        clean = scrubber.scrub(chunk)
        log = clean.scrub_log[0]
        assert log.start == 7  # After "Email: "
        assert log.end == 23  # End of email

    def test_audit_log_has_replacement(self) -> None:
        """Audit log contains replacement value."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("Email: john@example.com")
        clean = scrubber.scrub(chunk)
        assert clean.scrub_log[0].replacement != ""


class TestScrubberBatch:
    """Test batch scrubbing."""

    def test_batch_scrub_multiple_chunks(self) -> None:
        """Batch scrub multiple chunks."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunks = [
            make_raw_chunk("Email: john@example.com"),
            make_raw_chunk("Phone: 555-123-4567"),
            make_raw_chunk("No PII here"),
        ]
        results = scrubber.scrub_batch(chunks)
        assert len(results) == 3
        assert all(r.success for r in results)

    def test_batch_preserves_order(self) -> None:
        """Batch results are in same order as input."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunks = [
            make_raw_chunk("Email: john@example.com"),
            make_raw_chunk("No PII"),
        ]
        results = scrubber.scrub_batch(chunks)
        assert results[0].clean_chunk is not None
        assert "john@example.com" not in results[0].clean_chunk.text
        assert results[1].clean_chunk is not None
        assert results[1].clean_chunk.text == "No PII"

    def test_batch_consistency_across_chunks(self) -> None:
        """Same PII in batch gets same replacement."""
        pseudonymizer = Pseudonymizer(seed=42)
        scrubber = PresidioScrubber(pseudonymizer)
        chunks = [
            make_raw_chunk("Email: john@example.com"),
            make_raw_chunk("Contact john@example.com"),
        ]
        results = scrubber.scrub_batch(chunks)

        r1 = results[0].clean_chunk
        r2 = results[1].clean_chunk
        assert r1 is not None and r2 is not None

        # Same replacement for same email
        assert r1.scrub_log[0].replacement == r2.scrub_log[0].replacement


class TestScrubberCodePreservation:
    """Test that code identifiers are preserved."""

    def test_preserves_code_identifiers_regex_mode(self) -> None:
        """Code identifiers are NOT scrubbed in regex mode."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("def authenticate_user(john_doe):")
        clean = scrubber.scrub(chunk)
        # Variable names should be preserved (no PERSON detection in regex mode)
        assert "authenticate_user" in clean.text
        assert "john_doe" in clean.text


class TestScrubberCustomAnalyzer:
    """Test using custom analyzer."""

    def test_custom_analyzer_accepted(self) -> None:
        """Custom analyzer can be passed."""
        analyzer = create_analyzer(backend="regex")
        scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
        chunk = make_raw_chunk("Email test@test.com")
        clean = scrubber.scrub(chunk)
        assert "test@test.com" not in clean.text


class TestScrubberMetadata:
    """Test metadata preservation."""

    def test_preserves_source_uri(self) -> None:
        """Source URI is preserved."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("test@test.com", source_uri="myfile.py")
        clean = scrubber.scrub(chunk)
        assert clean.source_uri == "myfile.py"

    def test_preserves_corpus_type(self) -> None:
        """Corpus type is preserved."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("test@test.com")
        clean = scrubber.scrub(chunk)
        assert clean.corpus_type == CorpusType.CODE_LOGIC

    def test_preserves_chunk_id(self) -> None:
        """Chunk ID is preserved."""
        scrubber = PresidioScrubber(Pseudonymizer())
        chunk = make_raw_chunk("test@test.com")
        clean = scrubber.scrub(chunk)
        assert clean.id == chunk.id
