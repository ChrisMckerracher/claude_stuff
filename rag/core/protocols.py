"""Protocol interfaces for the RAG system.

Defines the contracts that all implementations must follow:
- Storage: VectorStore, GraphStore
- Processing: Chunker, Scrubber, Embedder, Crawler
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, Iterator, Literal, Protocol

if TYPE_CHECKING:
    from rag.core.schema import (
        Entity,
        EntityID,
        EntityType,
        Relationship,
        RelationshipID,
        RelationType,
    )

from rag.core.types import ChunkID, CleanChunk, EmbeddedChunk, RawChunk


# =============================================================================
# Result Types
# =============================================================================


@dataclass
class SearchResult:
    """Single search result with similarity score."""

    chunk: CleanChunk
    score: float  # Similarity score, higher is better
    distance: float  # Raw distance metric from vector store


@dataclass
class BatchResult:
    """Result of a batch insert operation."""

    inserted_count: int
    failed_chunks: list[tuple[ChunkID, Exception]] = field(default_factory=list)
    partial_success: bool = False  # True if some succeeded but not all

    @property
    def success(self) -> bool:
        """True if all chunks inserted successfully."""
        return len(self.failed_chunks) == 0


@dataclass
class ScrubResult:
    """Result of scrubbing a single chunk."""

    chunk_id: ChunkID
    clean_chunk: CleanChunk | None = None  # None if failed
    error: str | None = None  # None if successful

    @property
    def success(self) -> bool:
        """True if scrubbing succeeded."""
        return self.clean_chunk is not None


@dataclass
class CrawlSource:
    """Specification for what to crawl."""

    type: Literal["git_repo", "directory", "slack_export", "transcript"]
    path: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class CrawlResult:
    """Result from crawling a single source item."""

    content: bytes
    source_uri: str
    language: str | None = None  # Programming language if applicable
    metadata: dict[str, Any] = field(default_factory=dict)


# =============================================================================
# Storage Protocols
# =============================================================================


class VectorStore(Protocol):
    """Protocol for vector similarity search.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id.

        Idempotency:
            - Same ID + same content hash -> no-op
            - Same ID + different content -> raises DuplicateChunkError

        Args:
            chunk: The embedded chunk to insert

        Raises:
            StorageError: Storage backend unavailable or full
            DimensionMismatchError: Vector dimension != store's configured dimension
            DuplicateChunkError: Same ID exists with different content hash
        """
        ...

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> BatchResult:
        """Batch insert. Returns detailed result.

        Partial Success: Inserts as many as possible, tracks failures individually.

        Args:
            chunks: List of embedded chunks to insert

        Returns:
            BatchResult with inserted_count, failed_chunks, and partial_success flag.

        Raises:
            StorageError: Storage backend completely unavailable (no chunks attempted)
        """
        ...

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Similarity search. Returns ranked results.

        Args:
            query_vector: The query vector to search for
            limit: Maximum number of results to return
            filters: Optional field filters (e.g., {"corpus_type": "CODE_LOGIC"})

        Returns:
            List of results sorted by descending similarity score.
            Empty list if no matches (not an error).

        Raises:
            StorageError: Storage backend unavailable
            DimensionMismatchError: Query vector dimension != store's dimension
            InvalidFilterError: Filter references unknown field
        """
        ...

    async def delete(self, chunk_id: ChunkID) -> bool:
        """Delete by ID. Returns True if existed.

        Args:
            chunk_id: The ID of the chunk to delete

        Returns:
            True if the chunk existed and was deleted, False otherwise

        Raises:
            StorageError: Storage backend unavailable
        """
        ...


class GraphStore(Protocol):
    """Protocol for knowledge graph operations.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add or update entity. Returns ID.

        Upsert Behavior:
            - If entity with same (type, name) exists -> update properties
            - Otherwise -> create new entity

        Args:
            entity: The entity to add or update

        Returns:
            The EntityID of the created/updated entity

        Raises:
            StorageError: Graph backend unavailable
        """
        ...

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add directed edge. Returns ID.

        Upsert Behavior:
            - If edge (source, target, rel_type) exists -> update properties
            - Otherwise -> create new edge

        Args:
            source: Source entity ID
            target: Target entity ID
            rel_type: Type of relationship
            properties: Relationship properties

        Returns:
            The RelationshipID of the created/updated relationship

        Raises:
            StorageError: Graph backend unavailable
            EntityNotFoundError: Source or target entity doesn't exist
        """
        ...

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Semantic entity search.

        Args:
            query: Search query string
            entity_types: Optional filter by entity types
            limit: Maximum results to return

        Returns:
            List of matching entities

        Raises:
            StorageError: Graph backend unavailable
        """
        ...

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """Graph traversal. BFS from entity.

        Direction Semantics (for edge: source --[rel]--> target):
            - "out": Return targets where entity_id is the source
            - "in":  Return sources where entity_id is the target
            - "both": Return neighbors in either direction

        Args:
            entity_id: Starting entity for traversal
            rel_types: Optional filter by relationship types
            direction: Traversal direction
            max_hops: Maximum graph distance to traverse

        Returns:
            List of (entity, relationship) tuples found in traversal

        Raises:
            StorageError: Graph backend unavailable
            EntityNotFoundError: Starting entity doesn't exist
        """
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Ingest text, extract entities via LLM.

        Args:
            text: Text to process for entity extraction
            source: Source identifier for provenance
            timestamp: Optional timestamp for the episode

        Returns:
            List of entities extracted from the text

        Raises:
            StorageError: Graph backend unavailable
            LLMError: Entity extraction failed
        """
        ...


# =============================================================================
# Processing Protocols
# =============================================================================


class Chunker(Protocol):
    """Protocol for content chunking."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks from content.

        Args:
            content: Raw file content as bytes
            source_uri: Unique identifier for the source (e.g., file path)
            language: Programming language hint (for AST chunking)

        Yields:
            RawChunk objects with unique IDs and byte ranges

        Raises:
            ChunkingError: Content could not be parsed
        """
        ...


class Scrubber(Protocol):
    """Protocol for PHI removal."""

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Args:
            chunk: Raw chunk potentially containing PHI

        Returns:
            Clean chunk with PHI removed and scrub_log populated

        Raises:
            ScrubError: Scrubbing failed (e.g., encoding issues, analyzer error)
        """
        ...

    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing for efficiency. Never raises.

        Args:
            chunks: List of raw chunks to scrub

        Returns:
            List of ScrubResult in same order as input chunks.
            Check result.success to determine if scrubbing succeeded.
            Failed chunks have result.error set.

        Error Handling:
            - Individual chunk failures don't affect other chunks
            - All chunks are attempted even if some fail
        """
        ...


class Embedder(Protocol):
    """Protocol for vector embedding."""

    def embed(self, text: str) -> list[float]:
        """Single text to vector.

        Args:
            text: Text to embed

        Returns:
            Vector of length self.dimension

        Raises:
            EmbeddingError: Embedding failed
        """
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding for efficiency.

        Args:
            texts: List of texts to embed

        Returns:
            List of vectors in same order as input texts

        Raises:
            EmbeddingError: Batch embedding failed
        """
        ...

    @property
    def dimension(self) -> int:
        """Vector dimension (e.g., 768 for jina-embeddings-v3)."""
        ...


class Crawler(Protocol):
    """Protocol for source crawling."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield content from source.

        Args:
            source: CrawlSource specifying what to crawl

        Yields:
            CrawlResult objects with content and metadata

        Raises:
            CrawlError: Source could not be accessed
        """
        ...
