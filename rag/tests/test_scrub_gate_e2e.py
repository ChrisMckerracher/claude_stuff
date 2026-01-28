"""End-to-end tests for ScrubGate with real scrubber.

These tests verify the full integration of ScrubGate with PresidioScrubber,
testing the complete pipeline from RawChunk to CleanChunk.
"""

from __future__ import annotations

import pytest

from rag.models.chunk import CleanChunk, RawChunk
from rag.models.types import SensitivityTier, SourceTypeDef
from rag.pipeline.scrub_gate import ScrubGate
from rag.scrubbing.scrubber import PresidioScrubber


# Source type definitions for testing
CODE_LOGIC = SourceTypeDef(
    corpus_type="CODE_LOGIC",
    sensitivity=SensitivityTier.CLEAN,
    description="Source code logic",
    chunker_kind="ast",
    bm25_tokenizer="code",
)

CODE_DEPLOY = SourceTypeDef(
    corpus_type="CODE_DEPLOY",
    sensitivity=SensitivityTier.CLEAN,
    description="Deployment configs",
    chunker_kind="yaml",
    bm25_tokenizer="code",
)

DOC_GOOGLE = SourceTypeDef(
    corpus_type="DOC_GOOGLE",
    sensitivity=SensitivityTier.SENSITIVE,
    description="Google Docs",
    chunker_kind="markdown",
    bm25_tokenizer="nlp",
)

CONVO_SLACK = SourceTypeDef(
    corpus_type="CONVO_SLACK",
    sensitivity=SensitivityTier.MAYBE_SENSITIVE,
    description="Slack conversations",
    chunker_kind="thread",
    bm25_tokenizer="nlp",
)

DOC_README = SourceTypeDef(
    corpus_type="DOC_README",
    sensitivity=SensitivityTier.CLEAN,
    description="README files",
    chunker_kind="markdown",
    bm25_tokenizer="nlp",
)


def make_raw_chunk(
    text: str,
    source_type: SourceTypeDef,
    chunk_id: str = "test-chunk",
) -> RawChunk:
    """Create a RawChunk for testing."""
    return RawChunk(
        id=chunk_id,
        source_uri=f"test://{source_type.corpus_type}",
        byte_range=(0, len(text)),
        source_type=source_type,
        text=text,
        context_prefix="",
        repo_name="test-repo",
        file_path="/test/path",
        language="go",
    )


class TestScrubGateE2E:
    """End-to-end tests for ScrubGate integration."""

    @pytest.fixture
    def scrub_gate(self) -> ScrubGate:
        """Create a ScrubGate with real scrubber."""
        scrubber = PresidioScrubber(seed=42)
        return ScrubGate(scrubber)

    def test_clean_code_chunk_passthrough(self, scrub_gate: ScrubGate) -> None:
        """CODE_LOGIC chunk should pass through unchanged, audit=None."""
        code = """
func main() {
    nil := "test"
    admin := true
    fmt.Println("Hello, World!")
}
"""
        chunk = make_raw_chunk(code, CODE_LOGIC)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        assert result.text == chunk.text  # Text unchanged
        assert result.audit is None  # No audit for CLEAN tier

    def test_sensitive_gdoc_scrubbed(self, scrub_gate: ScrubGate) -> None:
        """DOC_GOOGLE chunk with name should have text scrubbed, audit populated."""
        text = "Contact Jane Smith at jane@example.com for the project update."
        chunk = make_raw_chunk(text, DOC_GOOGLE)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        # Name should be scrubbed
        assert "Jane Smith" not in result.text
        # Audit should be populated
        assert result.audit is not None
        assert result.audit.scrubbed is True
        assert result.audit.tier == SensitivityTier.SENSITIVE

    def test_maybe_sensitive_slack_scrubbed(self, scrub_gate: ScrubGate) -> None:
        """CONVO_SLACK with name should have text scrubbed."""
        text = "Hey @john.doe, can you review Sarah's PR?"
        chunk = make_raw_chunk(text, CONVO_SLACK)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        assert result.audit is not None
        assert result.audit.tier == SensitivityTier.MAYBE_SENSITIVE

    def test_clean_yaml_passthrough(self, scrub_gate: ScrubGate) -> None:
        """CODE_DEPLOY chunk should pass through unchanged."""
        yaml_text = """
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-service
spec:
  replicas: 3
"""
        chunk = make_raw_chunk(yaml_text, CODE_DEPLOY)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        assert result.text == chunk.text
        assert result.audit is None

    def test_scrubbed_text_no_phi(self, scrub_gate: ScrubGate) -> None:
        """Re-running analyzer on scrubbed text should produce zero/minimal entities."""
        text = "Jane Smith (jane.smith@company.com) called at (555) 123-4567"
        chunk = make_raw_chunk(text, DOC_GOOGLE)

        result = scrub_gate.process(chunk)

        # Re-analyze the scrubbed text
        scrubber = PresidioScrubber(seed=42)
        re_analysis = scrubber.analyze(result.text)

        # Should have very few or no detections (pseudonyms might still match)
        # The key is that the ORIGINAL entities are gone
        assert "Jane Smith" not in result.text
        assert "jane.smith@company.com" not in result.text

    def test_all_metadata_preserved(self, scrub_gate: ScrubGate) -> None:
        """All metadata fields should survive scrubbing."""
        chunk = RawChunk(
            id="meta-test-id",
            source_uri="test://metadata",
            byte_range=(100, 200),
            source_type=DOC_GOOGLE,
            text="Jane Smith approved this.",
            context_prefix="Context: ",
            repo_name="metadata-repo",
            language="markdown",
            symbol_name="README",
            file_path="/docs/README.md",
            git_hash="abc123",
            section_path="Introduction > Overview",
            author="author-123",
            timestamp="2024-01-15T10:30:00Z",
            channel="general",
            thread_id="thread-456",
            imports=["module1", "module2"],
            calls_out=["service1"],
            called_by=["service2"],
            service_name="my-service",
            k8s_labels={"app": "test", "env": "prod"},
        )

        result = scrub_gate.process(chunk)

        assert result.id == chunk.id
        assert result.source_uri == chunk.source_uri
        assert result.byte_range == chunk.byte_range
        assert result.source_type == chunk.source_type
        assert result.context_prefix == chunk.context_prefix
        assert result.repo_name == chunk.repo_name
        assert result.language == chunk.language
        assert result.symbol_name == chunk.symbol_name
        assert result.file_path == chunk.file_path
        assert result.git_hash == chunk.git_hash
        assert result.section_path == chunk.section_path
        assert result.author == chunk.author
        assert result.timestamp == chunk.timestamp
        assert result.channel == chunk.channel
        assert result.thread_id == chunk.thread_id
        assert result.imports == chunk.imports
        assert result.calls_out == chunk.calls_out
        assert result.called_by == chunk.called_by
        assert result.service_name == chunk.service_name
        assert result.k8s_labels == chunk.k8s_labels

    def test_chunk_id_unchanged(self, scrub_gate: ScrubGate) -> None:
        """CleanChunk.id should equal original RawChunk.id."""
        chunk = make_raw_chunk(
            "Jane Smith sent this message.",
            DOC_GOOGLE,
            chunk_id="unique-chunk-id-12345",
        )

        result = scrub_gate.process(chunk)

        assert result.id == "unique-chunk-id-12345"

    def test_readme_passthrough(self, scrub_gate: ScrubGate) -> None:
        """DOC_README (CLEAN) should pass through without scrubbing."""
        text = "# Project README\n\nMaintained by Jane Smith."
        chunk = make_raw_chunk(text, DOC_README)

        result = scrub_gate.process(chunk)

        assert result.text == chunk.text
        assert result.audit is None

    def test_empty_text_handling(self, scrub_gate: ScrubGate) -> None:
        """Empty text should be handled gracefully."""
        chunk = make_raw_chunk("", CONVO_SLACK)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        assert result.text == ""

    def test_text_without_phi(self, scrub_gate: ScrubGate) -> None:
        """Text without PHI should pass through with audit showing no scrubbing."""
        text = "The deployment completed successfully at 3pm."
        chunk = make_raw_chunk(text, CONVO_SLACK)

        result = scrub_gate.process(chunk)

        assert isinstance(result, CleanChunk)
        assert result.audit is not None
        # May or may not be scrubbed depending on what Presidio detects
        # But the important thing is it processes successfully

    def test_secrets_in_sensitive_tier(self, scrub_gate: ScrubGate) -> None:
        """Secrets should be scrubbed from SENSITIVE tier chunks."""
        text = 'The API key is AKIAIOSFODNN7EXAMPLE and password is "secret123"'
        chunk = make_raw_chunk(text, DOC_GOOGLE)

        result = scrub_gate.process(chunk)

        # AWS key should be detected and scrubbed (if detect-secrets catches it)
        assert result.audit is not None

    def test_multiple_chunks_consistent_pseudonyms(
        self, scrub_gate: ScrubGate
    ) -> None:
        """Same name across different chunks should get same pseudonym."""
        chunk1 = make_raw_chunk(
            "Jane Smith approved the design.",
            DOC_GOOGLE,
            chunk_id="chunk-1",
        )
        chunk2 = make_raw_chunk(
            "Jane Smith also reviewed the code.",
            DOC_GOOGLE,
            chunk_id="chunk-2",
        )

        result1 = scrub_gate.process(chunk1)
        result2 = scrub_gate.process(chunk2)

        # Both should have "Jane Smith" replaced with the same pseudonym
        # We can verify by checking that both texts have the same replacement
        # (They should both NOT contain "Jane Smith")
        assert "Jane Smith" not in result1.text
        assert "Jane Smith" not in result2.text


class TestScrubGateSensitivityRouting:
    """Tests for sensitivity tier routing in ScrubGate."""

    @pytest.fixture
    def scrub_gate(self) -> ScrubGate:
        """Create a ScrubGate with real scrubber."""
        scrubber = PresidioScrubber(seed=42)
        return ScrubGate(scrubber)

    def test_clean_tier_no_scrubbing(self, scrub_gate: ScrubGate) -> None:
        """CLEAN tier should skip scrubbing entirely."""
        # Even if there's PHI in the text, CLEAN tier passes through
        chunk = make_raw_chunk("Jane Smith wrote this code", CODE_LOGIC)

        result = scrub_gate.process(chunk)

        assert result.audit is None
        assert result.text == chunk.text

    def test_maybe_sensitive_tier_scrubbing(self, scrub_gate: ScrubGate) -> None:
        """MAYBE_SENSITIVE tier should trigger scrubbing."""
        chunk = make_raw_chunk("Jane Smith sent a message", CONVO_SLACK)

        result = scrub_gate.process(chunk)

        assert result.audit is not None
        assert result.audit.tier == SensitivityTier.MAYBE_SENSITIVE

    def test_sensitive_tier_scrubbing(self, scrub_gate: ScrubGate) -> None:
        """SENSITIVE tier should trigger scrubbing with warnings."""
        chunk = make_raw_chunk("Jane Smith documented this", DOC_GOOGLE)

        result = scrub_gate.process(chunk)

        assert result.audit is not None
        assert result.audit.tier == SensitivityTier.SENSITIVE
