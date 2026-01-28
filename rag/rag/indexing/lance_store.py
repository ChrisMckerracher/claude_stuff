"""LanceDB storage layer for vector search.

Provides CRUD operations for EmbeddedChunks with full metadata preservation.
Supports filtering by corpus_type, service_name, and repo_name.
"""

from __future__ import annotations

from typing import Any, cast

import lancedb
import pyarrow as pa

from rag.indexing.embedder import CodeRankEmbedder
from rag.models.chunk import EmbeddedChunk


# PyArrow schema matching all CleanChunk fields plus vector
CHUNKS_SCHEMA = pa.schema([
    pa.field("id", pa.string()),
    pa.field("source_uri", pa.string()),
    pa.field("byte_start", pa.int64()),
    pa.field("byte_end", pa.int64()),
    pa.field("corpus_type", pa.string()),
    pa.field("text", pa.string()),
    pa.field("context_prefix", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), CodeRankEmbedder.VECTOR_DIM)),
    pa.field("repo_name", pa.string()),
    pa.field("language", pa.string()),
    pa.field("symbol_name", pa.string()),
    pa.field("symbol_kind", pa.string()),
    pa.field("signature", pa.string()),
    pa.field("file_path", pa.string()),
    pa.field("git_hash", pa.string()),
    pa.field("section_path", pa.string()),
    pa.field("author", pa.string()),
    pa.field("timestamp", pa.string()),
    pa.field("channel", pa.string()),
    pa.field("thread_id", pa.string()),
    pa.field("imports", pa.list_(pa.string())),
    pa.field("calls_out", pa.list_(pa.string())),
    pa.field("called_by", pa.list_(pa.string())),
    pa.field("service_name", pa.string()),
])


class LanceStore:
    """LanceDB wrapper for vector storage and retrieval.

    Handles table creation, insertion, deletion, and vector search
    with metadata filtering.
    """

    TABLE_NAME = "chunks"

    def __init__(self, db_path: str) -> None:
        """Initialize connection to LanceDB.

        Args:
            db_path: Path to the LanceDB database directory.
        """
        self._db: lancedb.DBConnection = lancedb.connect(db_path)
        self._table: lancedb.table.Table | None = None

    def create_or_open(self) -> None:
        """Create the chunks table if it doesn't exist, or open existing."""
        existing_tables = self._db.list_tables().tables
        if self.TABLE_NAME in existing_tables:
            self._table = self._db.open_table(self.TABLE_NAME)
        else:
            self._table = self._db.create_table(
                self.TABLE_NAME,
                schema=CHUNKS_SCHEMA,
            )

    def insert(self, chunks: list[EmbeddedChunk]) -> None:
        """Insert embedded chunks into the table.

        Args:
            chunks: List of EmbeddedChunks to insert.
        """
        if not chunks:
            return
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")
        records = [self._to_record(c) for c in chunks]
        self._table.add(records)

    def delete_by_repo(self, repo_name: str) -> int:
        """Delete all chunks from a specific repository.

        Args:
            repo_name: The repository name to delete.

        Returns:
            Number of deleted chunks.
        """
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")
        count_before: int = self._table.count_rows()
        self._table.delete(f"repo_name = '{repo_name}'")
        count_after: int = self._table.count_rows()
        return count_before - count_after

    def delete_by_source_uri_prefix(self, prefix: str) -> int:
        """Delete all chunks whose source_uri starts with the given prefix.

        Args:
            prefix: The source URI prefix to match.

        Returns:
            Number of deleted chunks.
        """
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")
        count_before: int = self._table.count_rows()
        self._table.delete(f"source_uri LIKE '{prefix}%'")
        count_after: int = self._table.count_rows()
        return count_before - count_after

    def search(
        self,
        vector: list[float],
        top_k: int = 40,
        corpus_filter: list[str] | None = None,
        service_filter: str | None = None,
        repo_filter: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Search for similar chunks using vector similarity.

        Args:
            vector: Query vector (768-dim).
            top_k: Maximum number of results to return.
            corpus_filter: Only return chunks with these corpus_types.
            service_filter: Only return chunks from this service.
            repo_filter: Only return chunks from these repositories.

        Returns:
            List of chunk records with distance scores.
        """
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")

        q = self._table.search(vector).limit(top_k)

        filters: list[str] = []
        if corpus_filter:
            types = ", ".join(f"'{t}'" for t in corpus_filter)
            filters.append(f"corpus_type IN ({types})")
        if service_filter:
            filters.append(f"service_name = '{service_filter}'")
        if repo_filter:
            repos = ", ".join(f"'{r}'" for r in repo_filter)
            filters.append(f"repo_name IN ({repos})")

        if filters:
            q = q.where(" AND ".join(filters))

        results: list[dict[str, Any]] = q.to_list()
        return results

    def all_chunks(self) -> list[dict[str, Any]]:
        """Retrieve all chunks from the table.

        Returns:
            List of all chunk records as dictionaries.
        """
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")
        records: list[dict[str, Any]] = self._table.to_pandas().to_dict("records")
        return records

    def count(self) -> int:
        """Return the number of chunks in the table.

        Returns:
            Total count of chunks.
        """
        if self._table is None:
            raise RuntimeError("Table not initialized. Call create_or_open() first.")
        count: int = self._table.count_rows()
        return count

    def _to_record(self, chunk: EmbeddedChunk) -> dict[str, Any]:
        """Convert an EmbeddedChunk to a LanceDB record.

        Args:
            chunk: The EmbeddedChunk to convert.

        Returns:
            Dictionary matching CHUNKS_SCHEMA.
        """
        c = chunk.chunk
        return {
            "id": c.id,
            "source_uri": c.source_uri,
            "byte_start": c.byte_range[0],
            "byte_end": c.byte_range[1],
            "corpus_type": c.source_type.corpus_type,
            "text": c.text,
            "context_prefix": c.context_prefix,
            "vector": chunk.vector,
            "repo_name": c.repo_name or "",
            "language": c.language or "",
            "symbol_name": c.symbol_name or "",
            "symbol_kind": c.symbol_kind or "",
            "signature": c.signature or "",
            "file_path": c.file_path or "",
            "git_hash": c.git_hash or "",
            "section_path": c.section_path or "",
            "author": c.author or "",
            "timestamp": c.timestamp or "",
            "channel": c.channel or "",
            "thread_id": c.thread_id or "",
            "imports": c.imports or [],
            "calls_out": c.calls_out or [],
            "called_by": c.called_by or [],
            "service_name": c.service_name or "",
        }
