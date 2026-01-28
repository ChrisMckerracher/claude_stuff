"""Composite indexer orchestrating LanceDB, BM25, and service graph.

Satisfies the Indexer protocol from pipeline/protocols.py.
Coordinates vector storage, keyword indexing, and graph construction.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from rag.boundary.graph import ServiceGraph
from rag.boundary.resolver import ServiceNameResolver
from rag.indexing.bm25_store import BM25Store
from rag.indexing.lance_store import LanceStore
from rag.models.chunk import EmbeddedChunk
from rag.models.types import CrawlSource, SourceKind


class CompositeIndexer:
    """Satisfies the Indexer protocol by composing LanceStore + BM25Store + ServiceGraph.

    Handles:
    - Inserting embedded chunks into LanceDB
    - Rebuilding BM25 index on finalize
    - Building service dependency graph on finalize
    - Deleting chunks by source for incremental updates
    """

    LANCE_DIR = "rag.lance"
    BM25_DIR = "bm25_index"
    GRAPH_FILE = "service_graph.json"

    def __init__(
        self,
        output_dir: Path,
        resolver: ServiceNameResolver | None = None,
    ) -> None:
        """Initialize the composite indexer.

        Args:
            output_dir: Directory for storing index files.
            resolver: ServiceNameResolver for graph construction.
                     Creates a default one if not provided.
        """
        self._output_dir = output_dir
        self._output_dir.mkdir(parents=True, exist_ok=True)

        self._lance = LanceStore(str(output_dir / self.LANCE_DIR))
        self._bm25 = BM25Store()
        self._graph = ServiceGraph()
        self._resolver = resolver or ServiceNameResolver()

        # Initialize LanceDB table
        self._lance.create_or_open()

    def index(self, chunks: list[EmbeddedChunk]) -> None:
        """Write embedded chunks to LanceDB.

        BM25 and service graph are built on finalize() to ensure
        they reflect the complete state after all insertions.

        Args:
            chunks: List of EmbeddedChunks to index.
        """
        self._lance.insert(chunks)

    def delete_by_source(self, source: CrawlSource) -> int:
        """Delete all chunks from a crawl source.

        For repos, deletes by repo_name.
        For other sources, deletes by source_uri prefix.

        Args:
            source: The CrawlSource to delete chunks for.

        Returns:
            Number of deleted chunks.
        """
        if source.source_kind == SourceKind.REPO:
            repo_name = source.repo_name or source.path.name
            return self._lance.delete_by_repo(repo_name)
        return self._lance.delete_by_source_uri_prefix(str(source.path))

    def finalize(self) -> None:
        """Build BM25 index and service graph from all indexed chunks.

        Should be called after all chunks have been indexed.
        """
        all_chunks = self._lance.all_chunks()

        # Rebuild BM25 from all chunks
        self._bm25.build(all_chunks)
        self._bm25.save(str(self._output_dir / self.BM25_DIR))

        # Rebuild service graph from all chunks
        self._graph.build_from_chunks(all_chunks, self._resolver)
        self._graph.save(str(self._output_dir / self.GRAPH_FILE))

    def all_chunks(self) -> list[dict[str, Any]]:
        """Retrieve all chunks from the vector store.

        Returns:
            List of all chunk records.
        """
        return self._lance.all_chunks()

    def count(self) -> int:
        """Return the number of indexed chunks.

        Returns:
            Total count of chunks in LanceDB.
        """
        return self._lance.count()

    @property
    def lance_store(self) -> LanceStore:
        """Access the underlying LanceStore."""
        return self._lance

    @property
    def bm25_store(self) -> BM25Store:
        """Access the underlying BM25Store."""
        return self._bm25

    @property
    def service_graph(self) -> ServiceGraph:
        """Access the underlying ServiceGraph."""
        return self._graph
