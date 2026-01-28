"""Tests for the ScrubGate routing logic."""

from __future__ import annotations

from unittest.mock import MagicMock

from rag.config import SOURCE_TYPES
from rag.models.audit import ScrubAuditEntry
from rag.models.chunk import CleanChunk, RawChunk, make_chunk_id
from rag.models.types import SensitivityTier
from rag.pipeline.scrub_gate import ScrubGate


def _make_raw_chunk(corpus_type: str, text: str = "sample text") -> RawChunk:
    """Helper to create a RawChunk for a given corpus type."""
    st = SOURCE_TYPES[corpus_type]
    cid = make_chunk_id(f"test/{corpus_type}.txt", 0, len(text))
    return RawChunk(
        id=cid,
        source_uri=f"test/{corpus_type}.txt",
        byte_range=(0, len(text)),
        source_type=st,
        text=text,
        context_prefix=f"test/{corpus_type}.txt",
        repo_name="test-repo",
        language="python" if corpus_type.startswith("CODE") else None,
    )


def _make_mock_scrubber() -> MagicMock:
    """Create a mock scrubber that returns a CleanChunk with audit."""
    scrubber = MagicMock()

    def fake_scrub(chunk: RawChunk) -> CleanChunk:
        audit = ScrubAuditEntry(
            chunk_id=chunk.id,
            tier=chunk.source_type.sensitivity,
            entities_found=1,
            entity_types=["PERSON"],
            secrets_found=0,
            scrubbed=True,
        )
        return CleanChunk(
            id=chunk.id,
            source_uri=chunk.source_uri,
            byte_range=chunk.byte_range,
            source_type=chunk.source_type,
            text="[SCRUBBED]",
            context_prefix=chunk.context_prefix,
            repo_name=chunk.repo_name,
            audit=audit,
            language=chunk.language,
            symbol_name=chunk.symbol_name,
            symbol_kind=chunk.symbol_kind,
            signature=chunk.signature,
            file_path=chunk.file_path,
            git_hash=chunk.git_hash,
            section_path=chunk.section_path,
            author=chunk.author,
            timestamp=chunk.timestamp,
            channel=chunk.channel,
            thread_id=chunk.thread_id,
            imports=list(chunk.imports),
            calls_out=list(chunk.calls_out),
            called_by=list(chunk.called_by),
            service_name=chunk.service_name,
            k8s_labels=chunk.k8s_labels,
        )

    scrubber.scrub = MagicMock(side_effect=fake_scrub)
    return scrubber


class TestCleanPassthrough:
    def test_code_logic_passthrough(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("CODE_LOGIC", "def hello(): pass")

        clean = gate.process(raw)

        assert clean.text == "def hello(): pass"
        assert clean.audit is None
        scrubber.scrub.assert_not_called()

    def test_code_deploy_passthrough(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("CODE_DEPLOY", "apiVersion: v1")

        clean = gate.process(raw)

        assert clean.text == "apiVersion: v1"
        assert clean.audit is None
        scrubber.scrub.assert_not_called()

    def test_doc_readme_passthrough(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("DOC_README", "# README")

        clean = gate.process(raw)

        assert clean.text == "# README"
        assert clean.audit is None
        scrubber.scrub.assert_not_called()


class TestSensitiveScrubs:
    def test_doc_google_scrubs(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("DOC_GOOGLE", "Alice sent an email to Bob")

        clean = gate.process(raw)

        assert clean.audit is not None
        assert clean.audit.scrubbed is True
        scrubber.scrub.assert_called_once_with(raw)

    def test_convo_transcript_scrubs(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("CONVO_TRANSCRIPT", "Meeting with Dr. Smith")

        clean = gate.process(raw)

        assert clean.audit is not None
        scrubber.scrub.assert_called_once_with(raw)


class TestMaybeSensitiveScrubs:
    def test_convo_slack_scrubs(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("CONVO_SLACK", "@alice escalated to Dr. Smith")

        clean = gate.process(raw)

        assert clean.audit is not None
        scrubber.scrub.assert_called_once_with(raw)

    def test_doc_runbook_scrubs(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        raw = _make_raw_chunk("DOC_RUNBOOK", "Call John at ext 1234")

        clean = gate.process(raw)

        assert clean.audit is not None
        scrubber.scrub.assert_called_once_with(raw)


class TestMetadataPreservation:
    def test_all_metadata_preserved_on_clean_passthrough(self) -> None:
        scrubber = _make_mock_scrubber()
        gate = ScrubGate(scrubber)
        st = SOURCE_TYPES["CODE_LOGIC"]
        raw = RawChunk(
            id="test123",
            source_uri="pkg/auth/service.go",
            byte_range=(0, 500),
            source_type=st,
            text="func Validate() error {}",
            context_prefix="pkg/auth/service.go > AuthService > Validate",
            repo_name="auth-service",
            language="go",
            symbol_name="Validate",
            symbol_kind="method",
            signature="func (s *AuthService) Validate() error",
            file_path="pkg/auth/service.go",
            git_hash="abc123",
            imports=["fmt", "net/http"],
            calls_out=["user-service"],
            service_name="auth-service",
        )

        clean = gate.process(raw)

        assert clean.id == raw.id
        assert clean.source_uri == raw.source_uri
        assert clean.byte_range == raw.byte_range
        assert clean.source_type is raw.source_type
        assert clean.text == raw.text
        assert clean.context_prefix == raw.context_prefix
        assert clean.repo_name == raw.repo_name
        assert clean.language == raw.language
        assert clean.symbol_name == raw.symbol_name
        assert clean.symbol_kind == raw.symbol_kind
        assert clean.signature == raw.signature
        assert clean.file_path == raw.file_path
        assert clean.git_hash == raw.git_hash
        assert clean.imports == raw.imports
        assert clean.calls_out == raw.calls_out
        assert clean.service_name == raw.service_name
