"""LanceDB vector store implementation.

Provides embedded vector storage with similarity search using LanceDB.
"""

from __future__ import annotations

import json
from typing import Any

import lancedb
from lancedb.table import Table

from rag.config import EMBEDDING_DIM
from rag.core.errors import DimensionMismatchError, StorageError
from rag.core.protocols import BatchResult, SearchResult
from rag.core.types import ChunkID, CleanChunk, CorpusType, EmbeddedChunk


class LanceStore:
    """LanceDB implementation of VectorStore protocol.

    Uses embedded LanceDB for zero-config vector storage.
    """

    def __init__(self, db_path: str = "./data/lance") -> None:
        """Initialize LanceDB connection.

        Args:
            db_path: Path to LanceDB database directory
        """
        self._db = lancedb.connect(db_path)
        self._table: Table | None = None
        self._dimension = EMBEDDING_DIM

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id.

        Args:
            chunk: The embedded chunk to insert

        Raises:
            DimensionMismatchError: If vector dimension doesn't match store
            StorageError: If storage operation fails
        """
        # Validate dimension
        if len(chunk.vector) != self._dimension:
            raise DimensionMismatchError(self._dimension, len(chunk.vector))

        record = self._to_record(chunk)

        try:
            if self._table is None:
                # Try to open existing table or create new one with first record
                try:
                    self._table = self._db.open_table("chunks")
                except Exception:
                    # Table doesn't exist, create with first record
                    self._table = self._db.create_table("chunks", [record])
                    return

            # Check for duplicate - idempotent on same ID
            existing = (
                self._table.search(record["vector"])
                .where(f"id = '{chunk.chunk.id.value}'")
                .limit(1)
                .to_list()
            )
            if existing:
                # Idempotent - same ID means no-op
                return

            self._table.add([record])
        except Exception as e:
            if isinstance(e, DimensionMismatchError):
                raise
            raise StorageError("insert", str(e), retryable=True)

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> BatchResult:
        """Batch insert with partial success handling.

        Args:
            chunks: List of chunks to insert

        Returns:
            BatchResult with success/failure details
        """
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
        """Vector similarity search.

        Args:
            query_vector: Query vector to search for
            limit: Maximum number of results
            filters: Optional field filters

        Returns:
            List of results sorted by similarity

        Raises:
            DimensionMismatchError: If query vector dimension doesn't match
            StorageError: If search operation fails
        """
        if len(query_vector) != self._dimension:
            raise DimensionMismatchError(self._dimension, len(query_vector))

        if self._table is None:
            return []

        try:
            query = self._table.search(query_vector).limit(limit)

            if filters:
                where_clause = self._build_filter(filters)
                if where_clause:
                    query = query.where(where_clause)

            results = query.to_list()
            return [self._to_search_result(r) for r in results]
        except Exception as e:
            if isinstance(e, DimensionMismatchError):
                raise
            raise StorageError("search", str(e), retryable=True)

    async def delete(self, chunk_id: ChunkID) -> bool:
        """Delete by ID. Returns True if existed.

        Args:
            chunk_id: ID of chunk to delete

        Returns:
            True if chunk existed and was deleted
        """
        if self._table is None:
            return False

        try:
            # Check existence using count before delete
            count_before = self._table.count_rows(f"id = '{chunk_id.value}'")
            if count_before == 0:
                return False

            self._table.delete(f"id = '{chunk_id.value}'")
            return True
        except Exception as e:
            raise StorageError("delete", str(e), retryable=True)

    def _to_record(self, chunk: EmbeddedChunk) -> dict[str, Any]:
        """Convert EmbeddedChunk to LanceDB record."""
        return {
            "id": chunk.chunk.id.value,
            "text": chunk.chunk.text,
            "vector": chunk.vector,
            "source_uri": chunk.chunk.source_uri,
            "corpus_type": chunk.chunk.corpus_type.value,
            "context_prefix": chunk.chunk.context_prefix,
            "metadata": json.dumps(chunk.chunk.metadata),
        }

    def _to_search_result(self, record: dict[str, Any]) -> SearchResult:
        """Convert LanceDB record to SearchResult."""
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
