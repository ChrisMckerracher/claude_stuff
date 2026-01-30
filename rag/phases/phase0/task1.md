# Task 0.1: Define Core Data Types

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create the foundational data types that flow through the entire RAG pipeline.

## File

`rag/core/types.py`

## Types to Implement

### ChunkID

```python
@dataclass(frozen=True)
class ChunkID:
    """Immutable chunk identifier.

    Created by hashing source_uri + byte_range to ensure uniqueness.
    Immutable (frozen) to be usable as dict key.
    """
    value: str  # SHA256(source_uri + byte_range)

    @staticmethod
    def from_content(source_uri: str, start: int, end: int) -> "ChunkID":
        """Create ChunkID from source location.

        Returns: ChunkID(SHA256(f"{source_uri}:{start}:{end}"))
        """
```

### CorpusType

```python
class CorpusType(Enum):
    CODE_LOGIC = "CODE_LOGIC"
    CODE_TEST = "CODE_TEST"
    DOC_README = "DOC_README"
    DOC_DESIGN = "DOC_DESIGN"
    CONVO_SLACK = "CONVO_SLACK"
    CONVO_TRANSCRIPT = "CONVO_TRANSCRIPT"
```

### RawChunk

```python
@dataclass
class RawChunk:
    """Pre-scrubbing chunk. May contain PHI."""
    id: ChunkID
    text: str
    source_uri: str
    corpus_type: CorpusType
    byte_range: tuple[int, int]
    metadata: dict[str, Any]
```

### CleanChunk

```python
@dataclass
class CleanChunk:
    """Post-scrubbing chunk, safe for storage."""
    id: ChunkID
    text: str  # PHI removed
    source_uri: str
    corpus_type: CorpusType
    context_prefix: str  # file > class > function
    metadata: dict[str, Any]
    scrub_log: list[ScrubAction]  # Audit trail
```

### EmbeddedChunk

```python
@dataclass
class EmbeddedChunk:
    """Chunk with vector embedding."""
    chunk: CleanChunk
    vector: list[float]  # 768-dim (from config.EMBEDDING_DIM)
```

### ScrubAction

```python
@dataclass
class ScrubAction:
    """Audit log entry for PHI scrubbing."""
    entity_type: str  # PERSON, EMAIL, etc.
    start: int
    end: int
    replacement: str
```

## Acceptance Criteria

- [ ] All dataclasses defined with type hints
- [ ] ChunkID is frozen (immutable)
- [ ] ChunkID.from_content() uses SHA256
- [ ] CorpusType enum covers all corpus types from design
- [ ] Type checker (mypy/pyright) passes with strict mode

## Dependencies

None - this is the foundation.

## Estimated Time

30 minutes
