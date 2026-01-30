# Task 0.5: Define Error Types

**Status:** [ ] Not Started  |  [ ] In Progress  |  [x] Complete

## Objective

Define the error hierarchy with retry semantics for graceful failure handling.

## File

`rag/core/errors.py`

## Error Types to Implement

### Base Error

```python
class RAGError(Exception):
    """Base error for RAG system.

    All RAG-specific errors inherit from this.
    """
    pass
```

### Chunking Errors

```python
class ChunkingError(RAGError):
    """Failed to chunk content.

    Attributes:
        source_uri: The file/source that failed to chunk
        reason: Human-readable error description
    """
    def __init__(self, source_uri: str, reason: str):
        self.source_uri = source_uri
        self.reason = reason
        super().__init__(f"Failed to chunk {source_uri}: {reason}")
```

### Scrubbing Errors

```python
class ScrubError(RAGError):
    """PHI scrubbing failed.

    Attributes:
        chunk_id: The chunk that failed to scrub
        reason: Human-readable error description
    """
    def __init__(self, chunk_id: ChunkID, reason: str):
        self.chunk_id = chunk_id
        self.reason = reason
        super().__init__(f"Failed to scrub chunk {chunk_id.value}: {reason}")
```

### Storage Errors

```python
class StorageError(RAGError):
    """Storage operation failed.

    Attributes:
        operation: The operation that failed (insert, search, delete)
        reason: Human-readable error description
        retryable: Whether the operation can be retried
        retry_after_seconds: Suggested wait time before retry (None if not retryable)
    """
    def __init__(
        self,
        operation: str,
        reason: str,
        retryable: bool = False,
        retry_after_seconds: int | None = None,
    ):
        self.operation = operation
        self.reason = reason
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"Storage {operation} failed: {reason}")


class DimensionMismatchError(StorageError):
    """Vector dimension doesn't match store configuration.

    Never retryable - the vector must be regenerated with correct dimension.
    """
    def __init__(self, expected: int, actual: int):
        self.expected = expected
        self.actual = actual
        super().__init__(
            operation="insert",
            reason=f"Expected {expected}-dim vector, got {actual}-dim",
            retryable=False,
        )


class DuplicateChunkError(StorageError):
    """Chunk ID exists with different content hash.

    Never retryable - indicates a content conflict that must be resolved.
    """
    def __init__(self, chunk_id: ChunkID, existing_hash: str, new_hash: str):
        self.chunk_id = chunk_id
        self.existing_hash = existing_hash
        self.new_hash = new_hash
        super().__init__(
            operation="insert",
            reason=f"Chunk {chunk_id.value} exists with different content",
            retryable=False,
        )


class InvalidFilterError(StorageError):
    """Filter references unknown field."""
    def __init__(self, field_name: str):
        self.field_name = field_name
        super().__init__(
            operation="search",
            reason=f"Unknown filter field: {field_name}",
            retryable=False,
        )
```

### Graph Errors

```python
class EntityNotFoundError(RAGError):
    """Referenced entity doesn't exist in graph."""
    def __init__(self, entity_id: EntityID):
        self.entity_id = entity_id
        super().__init__(f"Entity not found: {entity_id.value}")


class LLMError(RAGError):
    """LLM call failed during entity extraction.

    Attributes:
        reason: Human-readable error description
        retryable: True for rate limits/timeouts, False for invalid input
        retry_after_seconds: Wait time for rate limits
    """
    def __init__(
        self,
        reason: str,
        retryable: bool = True,
        retry_after_seconds: int | None = None,
    ):
        self.reason = reason
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"LLM error: {reason}")
```

### Embedding Errors

```python
class EmbeddingError(RAGError):
    """Embedding failed.

    Attributes:
        text_preview: First 100 chars of text that failed
        reason: Human-readable error description
    """
    def __init__(self, text: str, reason: str):
        self.text_preview = text[:100] + "..." if len(text) > 100 else text
        self.reason = reason
        super().__init__(f"Embedding failed: {reason}")
```

## Retry Semantics Summary

| Error Type | Retryable | When to Retry |
|------------|-----------|---------------|
| StorageError | Sometimes | Check .retryable flag |
| DimensionMismatchError | Never | Fix vector dimension |
| DuplicateChunkError | Never | Resolve content conflict |
| InvalidFilterError | Never | Fix filter field name |
| EntityNotFoundError | Never | Create entity first |
| LLMError | Usually | Rate limits, timeouts |
| ChunkingError | Never | Fix source content |
| ScrubError | Never | Fix scrubber config |
| EmbeddingError | Sometimes | Depends on cause |

## Acceptance Criteria

- [x] All error types defined with appropriate attributes
- [x] RetryPolicy class from config.py can use .retryable attribute
- [x] Error messages are human-readable and include context
- [x] Type checker passes with all error types
- [x] Each error type documents when it's retryable

## Dependencies

- Task 0.1 (Core Data Types) for ChunkID
- Task 0.4 (Entity Schema) for EntityID

## Estimated Time

25 minutes
