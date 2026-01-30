"""Error hierarchy for the RAG system.

All errors include retry semantics to enable graceful failure handling.
Check the .retryable attribute to determine if an operation can be retried.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from rag.core.schema import EntityID
    from rag.core.types import ChunkID


class RAGError(Exception):
    """Base error for RAG system.

    All RAG-specific errors inherit from this.
    """

    pass


# =============================================================================
# Chunking Errors
# =============================================================================


class ChunkingError(RAGError):
    """Failed to chunk content.

    Attributes:
        source_uri: The file/source that failed to chunk
        reason: Human-readable error description

    Retry: Never retryable - fix source content or chunker config.
    """

    def __init__(self, source_uri: str, reason: str) -> None:
        self.source_uri = source_uri
        self.reason = reason
        super().__init__(f"Failed to chunk {source_uri}: {reason}")


# =============================================================================
# Scrubbing Errors
# =============================================================================


class ScrubError(RAGError):
    """PHI scrubbing failed.

    Attributes:
        chunk_id: The chunk that failed to scrub
        reason: Human-readable error description

    Retry: Never retryable - fix scrubber config or chunk encoding.
    """

    def __init__(self, chunk_id: ChunkID, reason: str) -> None:
        self.chunk_id = chunk_id
        self.reason = reason
        super().__init__(f"Failed to scrub chunk {chunk_id.value}: {reason}")


# =============================================================================
# Storage Errors
# =============================================================================


class StorageError(RAGError):
    """Storage operation failed.

    Attributes:
        operation: The operation that failed (insert, search, delete)
        reason: Human-readable error description
        retryable: Whether the operation can be retried
        retry_after_seconds: Suggested wait time before retry (None if not retryable)

    Retry: Check .retryable - True for transient failures like timeouts.
    """

    def __init__(
        self,
        operation: str,
        reason: str,
        retryable: bool = False,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.operation = operation
        self.reason = reason
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"Storage {operation} failed: {reason}")


class DimensionMismatchError(StorageError):
    """Vector dimension doesn't match store configuration.

    Attributes:
        expected: Expected vector dimension
        actual: Actual vector dimension received

    Retry: Never retryable - regenerate vector with correct dimension.
    """

    def __init__(self, expected: int, actual: int) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            operation="insert",
            reason=f"Expected {expected}-dim vector, got {actual}-dim",
            retryable=False,
        )


class DuplicateChunkError(StorageError):
    """Chunk ID exists with different content hash.

    Attributes:
        chunk_id: The conflicting chunk ID
        existing_hash: Hash of existing content
        new_hash: Hash of new content being inserted

    Retry: Never retryable - resolve content conflict manually.
    """

    def __init__(self, chunk_id: ChunkID, existing_hash: str, new_hash: str) -> None:
        self.chunk_id = chunk_id
        self.existing_hash = existing_hash
        self.new_hash = new_hash
        super().__init__(
            operation="insert",
            reason=f"Chunk {chunk_id.value} exists with different content",
            retryable=False,
        )


class InvalidFilterError(StorageError):
    """Filter references unknown field.

    Attributes:
        field_name: The invalid field name

    Retry: Never retryable - fix filter field name.
    """

    def __init__(self, field_name: str) -> None:
        self.field_name = field_name
        super().__init__(
            operation="search",
            reason=f"Unknown filter field: {field_name}",
            retryable=False,
        )


# =============================================================================
# Graph Errors
# =============================================================================


class EntityNotFoundError(RAGError):
    """Referenced entity doesn't exist in graph.

    Attributes:
        entity_id: The missing entity ID

    Retry: Never retryable - create the entity first.
    """

    def __init__(self, entity_id: EntityID) -> None:
        self.entity_id = entity_id
        super().__init__(f"Entity not found: {entity_id.value}")


class LLMError(RAGError):
    """LLM call failed during entity extraction.

    Attributes:
        reason: Human-readable error description
        retryable: True for rate limits/timeouts, False for invalid input
        retry_after_seconds: Wait time for rate limits

    Retry: Usually retryable for rate limits and timeouts.
    """

    def __init__(
        self,
        reason: str,
        retryable: bool = True,
        retry_after_seconds: int | None = None,
    ) -> None:
        self.reason = reason
        self.retryable = retryable
        self.retry_after_seconds = retry_after_seconds
        super().__init__(f"LLM error: {reason}")


# =============================================================================
# Embedding Errors
# =============================================================================


class EmbeddingError(RAGError):
    """Embedding failed.

    Attributes:
        text_preview: First 100 chars of text that failed
        reason: Human-readable error description

    Retry: Sometimes retryable - depends on cause (rate limit vs invalid input).
    """

    def __init__(self, text: str, reason: str) -> None:
        self.text_preview = text[:100] + "..." if len(text) > 100 else text
        self.reason = reason
        super().__init__(f"Embedding failed: {reason}")


# =============================================================================
# Crawl Errors
# =============================================================================


class CrawlError(RAGError):
    """Source crawling failed.

    Attributes:
        source_path: The source that failed to crawl
        reason: Human-readable error description

    Retry: Sometimes retryable - depends on cause (network vs permission).
    """

    def __init__(self, source_path: str, reason: str) -> None:
        self.source_path = source_path
        self.reason = reason
        super().__init__(f"Failed to crawl {source_path}: {reason}")
