# Task 0.2: Define Storage Protocols

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define the protocol interfaces for vector and graph storage that all implementations must follow.

## File

`rag/core/protocols.py`

## Protocols to Implement

### VectorStore Protocol

```python
class VectorStore(Protocol):
    """Protocol for vector similarity search.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id.

        Idempotency:
            - Same ID + same content hash -> no-op
            - Same ID + different content -> raises DuplicateChunkError

        Raises:
            StorageError: Storage backend unavailable or full
            DimensionMismatchError: Vector dimension != store's configured dimension
            DuplicateChunkError: Same ID exists with different content hash
        """
        ...

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> BatchResult:
        """Batch insert. Returns detailed result.

        Partial Success: Inserts as many as possible, tracks failures individually.

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

        Raises:
            StorageError: Storage backend unavailable
        """
        ...
```

### BatchResult

```python
@dataclass
class BatchResult:
    """Result of a batch insert operation."""
    inserted_count: int
    failed_chunks: list[tuple[ChunkID, RAGError]]  # (chunk_id, error) pairs
    partial_success: bool  # True if some succeeded but not all

    @property
    def success(self) -> bool:
        """True if all chunks inserted successfully."""
        return len(self.failed_chunks) == 0
```

### SearchResult

```python
@dataclass
class SearchResult:
    """Single search result with score."""
    chunk: CleanChunk
    score: float  # Similarity score, higher is better
    distance: float  # Raw distance metric
```

### GraphStore Protocol

```python
class GraphStore(Protocol):
    """Protocol for knowledge graph operations.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add or update entity. Returns ID.

        Upsert Behavior:
            - If entity with same (type, name) exists -> update properties
            - Otherwise -> create new entity

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
        """Semantic entity search."""
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
        """
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Ingest text, extract entities via LLM. Returns extracted entities."""
        ...
```

## Acceptance Criteria

- [ ] VectorStore protocol complete with all methods
- [ ] GraphStore protocol complete with all methods
- [ ] All methods have docstrings with behavior specification
- [ ] Error types documented in Raises sections
- [ ] BatchResult and SearchResult dataclasses defined
- [ ] Type hints use Protocol from typing

## Dependencies

- Task 0.1 (Core Data Types) must be complete

## Estimated Time

45 minutes
