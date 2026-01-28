"""Tests for chunk dataclasses and chunk ID generation."""

from __future__ import annotations

from rag.config import SOURCE_TYPES
from rag.models.audit import ScrubAuditEntry
from rag.models.chunk import (
    CleanChunk,
    EmbeddedChunk,
    RawChunk,
    make_chunk_id,
)
from rag.models.types import SensitivityTier


class TestMakeChunkId:
    def test_deterministic(self) -> None:
        id1 = make_chunk_id("file.py", 0, 100)
        id2 = make_chunk_id("file.py", 0, 100)
        assert id1 == id2

    def test_different_inputs_produce_different_ids(self) -> None:
        id1 = make_chunk_id("file.py", 0, 100)
        id2 = make_chunk_id("file.py", 0, 200)
        id3 = make_chunk_id("other.py", 0, 100)
        assert id1 != id2
        assert id1 != id3
        assert id2 != id3

    def test_id_length(self) -> None:
        cid = make_chunk_id("pkg/auth/service.go", 0, 512)
        assert len(cid) == 16

    def test_id_is_hex(self) -> None:
        cid = make_chunk_id("test.py", 10, 20)
        int(cid, 16)  # raises ValueError if not valid hex


class TestRawChunk:
    def test_construction(self) -> None:
        st = SOURCE_TYPES["CODE_LOGIC"]
        chunk = RawChunk(
            id=make_chunk_id("test.py", 0, 100),
            source_uri="test.py",
            byte_range=(0, 100),
            source_type=st,
            text="def hello(): pass",
            context_prefix="test.py > hello",
            repo_name="my-repo",
            language="python",
            symbol_name="hello",
            symbol_kind="function",
        )
        assert chunk.source_type.sensitivity == SensitivityTier.CLEAN
        assert chunk.language == "python"
        assert chunk.symbol_name == "hello"

    def test_optional_fields_default_none(self) -> None:
        st = SOURCE_TYPES["CODE_LOGIC"]
        chunk = RawChunk(
            id="abc",
            source_uri="test.py",
            byte_range=(0, 100),
            source_type=st,
            text="code",
            context_prefix="",
            repo_name=None,
        )
        assert chunk.language is None
        assert chunk.signature is None
        assert chunk.imports == []
        assert chunk.k8s_labels is None


class TestCleanChunk:
    def test_clean_chunk_with_no_audit(self) -> None:
        st = SOURCE_TYPES["CODE_LOGIC"]
        chunk = CleanChunk(
            id="abc",
            source_uri="test.py",
            byte_range=(0, 100),
            source_type=st,
            text="def hello(): pass",
            context_prefix="test.py > hello",
            repo_name=None,
            audit=None,
        )
        assert chunk.audit is None

    def test_clean_chunk_with_audit(self) -> None:
        st = SOURCE_TYPES["DOC_GOOGLE"]
        audit = ScrubAuditEntry(
            chunk_id="abc",
            tier=SensitivityTier.SENSITIVE,
            entities_found=2,
            entity_types=["PERSON", "EMAIL"],
            secrets_found=0,
            scrubbed=True,
        )
        chunk = CleanChunk(
            id="abc",
            source_uri="doc.md",
            byte_range=(0, 500),
            source_type=st,
            text="[REDACTED] sent an email to [REDACTED]",
            context_prefix="doc.md > Overview",
            repo_name=None,
            audit=audit,
        )
        assert chunk.audit is not None
        assert chunk.audit.entities_found == 2
        assert chunk.audit.scrubbed is True


class TestEmbeddedChunk:
    def test_wraps_clean_chunk(self) -> None:
        st = SOURCE_TYPES["CODE_LOGIC"]
        clean = CleanChunk(
            id="abc",
            source_uri="test.py",
            byte_range=(0, 100),
            source_type=st,
            text="def hello(): pass",
            context_prefix="test.py > hello",
            repo_name=None,
            audit=None,
        )
        embedded = EmbeddedChunk(chunk=clean, vector=[0.1] * 768)
        assert embedded.chunk is clean
        assert len(embedded.vector) == 768
        assert isinstance(embedded.chunk, CleanChunk)
