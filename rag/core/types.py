"""Core data types for the RAG pipeline.

These types flow through the entire pipeline:
RawChunk -> CleanChunk -> EmbeddedChunk -> stored in VectorStore
"""

from dataclasses import dataclass, field
from enum import Enum
from hashlib import sha256
from typing import Any


@dataclass(frozen=True)
class ChunkID:
    """Immutable chunk identifier.

    Created by hashing source_uri + byte_range to ensure uniqueness.
    Immutable (frozen) to be usable as dict key.
    """

    value: str

    @staticmethod
    def from_content(source_uri: str, start: int, end: int) -> "ChunkID":
        """Create ChunkID from source location.

        Args:
            source_uri: Unique identifier for the source file/document
            start: Start byte offset
            end: End byte offset

        Returns:
            ChunkID with SHA256 hash of the location
        """
        content = f"{source_uri}:{start}:{end}"
        hash_value = sha256(content.encode()).hexdigest()
        return ChunkID(value=hash_value)


class CorpusType(Enum):
    """Type of content corpus for categorization."""

    CODE_LOGIC = "CODE_LOGIC"
    CODE_TEST = "CODE_TEST"
    DOC_README = "DOC_README"
    DOC_DESIGN = "DOC_DESIGN"
    CONVO_SLACK = "CONVO_SLACK"
    CONVO_TRANSCRIPT = "CONVO_TRANSCRIPT"


@dataclass
class ScrubAction:
    """Audit log entry for PHI scrubbing.

    Records what was replaced during scrubbing for compliance audit trail.
    """

    entity_type: str  # PERSON, EMAIL, PHONE, etc.
    start: int  # Start offset in original text
    end: int  # End offset in original text
    replacement: str  # What it was replaced with (e.g., "[PERSON]")


@dataclass
class RawChunk:
    """Pre-scrubbing chunk. May contain PHI.

    This is the output of the chunking phase, before PHI scrubbing.
    Should not be persisted to long-term storage.
    """

    id: ChunkID
    text: str
    source_uri: str
    corpus_type: CorpusType
    byte_range: tuple[int, int]
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CleanChunk:
    """Post-scrubbing chunk, safe for storage.

    PHI has been removed and an audit trail is maintained.
    This is the canonical chunk format for storage and retrieval.
    """

    id: ChunkID
    text: str  # PHI removed
    source_uri: str
    corpus_type: CorpusType
    context_prefix: str  # Hierarchical context: file > class > function
    metadata: dict[str, Any] = field(default_factory=dict)
    scrub_log: list[ScrubAction] = field(default_factory=list)


@dataclass
class EmbeddedChunk:
    """Chunk with vector embedding, ready for vector storage.

    Contains the clean chunk plus its vector representation.
    """

    chunk: CleanChunk
    vector: list[float]  # 768-dim default (configurable via EMBEDDING_DIM)
