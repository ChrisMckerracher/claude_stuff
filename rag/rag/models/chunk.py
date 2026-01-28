"""Chunk dataclasses representing pipeline stages.

RawChunk -> CleanChunk -> EmbeddedChunk

The type system enforces that scrubbing happens before embedding.
The Embedder accepts CleanChunk, not RawChunk.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from rag.models.audit import ScrubAuditEntry
from rag.models.types import SourceTypeDef


def make_chunk_id(source_uri: str, byte_start: int, byte_end: int) -> str:
    """Generate a deterministic chunk ID from source URI and byte range.

    Same file re-crawled with same boundaries produces the same ID,
    which is critical for incremental diffing.
    """
    key = f"{source_uri}:{byte_start}:{byte_end}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


@dataclass
class RawChunk:
    """Output of a Crawler. May contain PHI. Cannot be embedded directly."""

    id: str
    source_uri: str
    byte_range: tuple[int, int]
    source_type: SourceTypeDef
    text: str
    context_prefix: str
    repo_name: str | None

    # Type-specific metadata (all optional)
    language: str | None = None
    symbol_name: str | None = None
    symbol_kind: str | None = None
    signature: str | None = None
    file_path: str | None = None
    git_hash: str | None = None
    section_path: str | None = None
    author: str | None = None
    timestamp: str | None = None
    channel: str | None = None
    thread_id: str | None = None
    imports: list[str] = field(default_factory=list)
    calls_out: list[str] = field(default_factory=list)
    called_by: list[str] = field(default_factory=list)
    service_name: str | None = None
    k8s_labels: dict[str, str] | None = None


@dataclass
class CleanChunk:
    """Output of the scrub gate. Guaranteed safe to embed and index.

    For CLEAN sources, this is a zero-cost wrapper (text unchanged).
    For SENSITIVE/MAYBE_SENSITIVE, text has been scrubbed.
    """

    id: str
    source_uri: str
    byte_range: tuple[int, int]
    source_type: SourceTypeDef
    text: str
    context_prefix: str
    repo_name: str | None
    audit: ScrubAuditEntry | None

    # All metadata fields carried forward from RawChunk
    language: str | None = None
    symbol_name: str | None = None
    symbol_kind: str | None = None
    signature: str | None = None
    file_path: str | None = None
    git_hash: str | None = None
    section_path: str | None = None
    author: str | None = None
    timestamp: str | None = None
    channel: str | None = None
    thread_id: str | None = None
    imports: list[str] = field(default_factory=list)
    calls_out: list[str] = field(default_factory=list)
    called_by: list[str] = field(default_factory=list)
    service_name: str | None = None
    k8s_labels: dict[str, str] | None = None


@dataclass
class EmbeddedChunk:
    """Output of the Embedder. Ready to write to LanceDB."""

    chunk: CleanChunk
    vector: list[float]
