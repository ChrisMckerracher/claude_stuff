# Task 3.1: LanceDB Store Implementation

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement the VectorStore protocol using LanceDB for embedded vector storage.

## File

`rag/indexing/lance_store.py`

## Implementation

```python
import lancedb
from lancedb.table import Table
from typing import Any
from rag.core.types import EmbeddedChunk, ChunkID, CleanChunk, CorpusType
from rag.core.protocols import VectorStore, BatchResult, SearchResult
from rag.core.errors import StorageError, DimensionMismatchError, DuplicateChunkError
from rag.config import EMBEDDING_DIM

class LanceStore:
    """LanceDB implementation of VectorStore protocol.

    Uses embedded LanceDB for zero-config vector storage.
    """

    def __init__(self, db_path: str = "./data/lance"):
        """Initialize LanceDB connection.

        Args:
            db_path: Path to LanceDB database directory
        """
        self._db = lancedb.connect(db_path)
        self._table: Table | None = None
        self._dimension = EMBEDDING_DIM

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id."""
        # Validate dimension
        if len(chunk.vector) != self._dimension:
            raise DimensionMismatchError(self._dimension, len(chunk.vector))

        await self._ensure_table()

        # Check for duplicate with different content
        existing = self._table.search().where(f"id = '{chunk.chunk.id.value}'").limit(1).to_list()
        if existing:
            # Idempotent - same ID means no-op
            return

        record = self._to_record(chunk)
        self._table.add([record])

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> BatchResult:
        """Batch insert with partial success handling."""
        await self._ensure_table()

        inserted = 0
        failed: list[tuple[ChunkID, Exception]] = []

        for chunk in chunks:
            try:
                await self.insert(chunk)
                inserted += 1
            except Exception as e:
                failed.append((chunk.chunk.id, e))

        return BatchResult(
            inserted_count=inserted,
            failed_chunks=failed,
            partial_success=len(failed) > 0 and inserted > 0,
        )

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Vector similarity search."""
        if len(query_vector) != self._dimension:
            raise DimensionMismatchError(self._dimension, len(query_vector))

        if self._table is None:
            return []

        query = self._table.search(query_vector).limit(limit)

        if filters:
            where_clause = self._build_filter(filters)
            if where_clause:
                query = query.where(where_clause)

        results = query.to_list()
        return [self._to_search_result(r) for r in results]

    async def delete(self, chunk_id: ChunkID) -> bool:
        """Delete by ID. Returns True if existed."""
        if self._table is None:
            return False

        # Check existence
        existing = self._table.search().where(f"id = '{chunk_id.value}'").limit(1).to_list()
        if not existing:
            return False

        self._table.delete(f"id = '{chunk_id.value}'")
        return True

    async def _ensure_table(self) -> None:
        """Create table if it doesn't exist."""
        if self._table is not None:
            return

        try:
            self._table = self._db.open_table("chunks")
        except Exception:
            # Table doesn't exist, create it
            import pyarrow as pa
            schema = pa.schema([
                pa.field("id", pa.string()),
                pa.field("text", pa.string()),
                pa.field("vector", pa.list_(pa.float32(), self._dimension)),
                pa.field("source_uri", pa.string()),
                pa.field("corpus_type", pa.string()),
                pa.field("context_prefix", pa.string()),
                pa.field("metadata", pa.string()),  # JSON serialized
            ])
            self._table = self._db.create_table("chunks", schema=schema)

    def _to_record(self, chunk: EmbeddedChunk) -> dict:
        """Convert EmbeddedChunk to LanceDB record."""
        import json
        return {
            "id": chunk.chunk.id.value,
            "text": chunk.chunk.text,
            "vector": chunk.vector,
            "source_uri": chunk.chunk.source_uri,
            "corpus_type": chunk.chunk.corpus_type.value,
            "context_prefix": chunk.chunk.context_prefix,
            "metadata": json.dumps(chunk.chunk.metadata),
        }

    def _to_search_result(self, record: dict) -> SearchResult:
        """Convert LanceDB record to SearchResult."""
        import json
        chunk = CleanChunk(
            id=ChunkID(record["id"]),
            text=record["text"],
            source_uri=record["source_uri"],
            corpus_type=CorpusType(record["corpus_type"]),
            context_prefix=record["context_prefix"],
            metadata=json.loads(record.get("metadata", "{}")),
            scrub_log=[],
        )
        return SearchResult(
            chunk=chunk,
            score=1.0 - record.get("_distance", 0),  # Convert distance to similarity
            distance=record.get("_distance", 0),
        )

    def _build_filter(self, filters: dict[str, Any]) -> str:
        """Build SQL-like filter clause."""
        clauses = []
        for key, value in filters.items():
            if isinstance(value, list):
                values = ", ".join(f"'{v}'" for v in value)
                clauses.append(f"{key} IN ({values})")
            else:
                clauses.append(f"{key} = '{value}'")
        return " AND ".join(clauses)
```

## Acceptance Criteria

- [ ] Implements VectorStore protocol
- [ ] Insert validates vector dimension
- [ ] Insert is idempotent on chunk ID
- [ ] Search returns results sorted by similarity
- [ ] Search supports filters (corpus_type, etc.)
- [ ] Delete returns True if chunk existed
- [ ] Table is created lazily on first insert
- [ ] Batch insert handles partial failures

## Dependencies

- Task 0.2 (VectorStore protocol)
- lancedb, pyarrow packages

## Estimated Time

40 minutes
