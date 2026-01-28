"""Integration tests for CompositeIndexer."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rag.boundary.resolver import ServiceNameResolver
from rag.indexing.indexer import CompositeIndexer
from rag.models.types import CrawlSource, SourceKind
from tests.fixtures.chunks.sample_clean_chunks import (
    make_batch_chunks,
    make_code_chunk,
    make_deploy_chunk,
    make_embedded_chunk,
)


class TestFullIndexFlow:
    """End-to-end indexing tests."""

    def test_full_index_flow(self, tmp_path: Path) -> None:
        """Create indexer -> index 50 chunks -> finalize -> data/ has all files."""
        indexer = CompositeIndexer(tmp_path)

        # Create and index chunks
        chunks = make_batch_chunks(50, repo_name="test-repo", service_name="test-service")
        embedded = [make_embedded_chunk(c) for c in chunks]

        indexer.index(embedded)
        indexer.finalize()

        # Verify data files exist
        assert (tmp_path / "rag.lance").exists()
        assert (tmp_path / "bm25_index").exists()
        assert (tmp_path / "service_graph.json").exists()

    def test_lance_file_exists(self, tmp_path: Path) -> None:
        """LanceDB directory is created."""
        indexer = CompositeIndexer(tmp_path)

        chunk = make_embedded_chunk(make_code_chunk("func Test() {}"))
        indexer.index([chunk])

        assert (tmp_path / "rag.lance").is_dir()

    def test_bm25_files_exist(self, tmp_path: Path) -> None:
        """BM25 index directory with required files is created."""
        indexer = CompositeIndexer(tmp_path)

        chunk = make_embedded_chunk(make_code_chunk("func Test() {}"))
        indexer.index([chunk])
        indexer.finalize()

        bm25_path = tmp_path / "bm25_index"
        assert bm25_path.is_dir()
        assert (bm25_path / "doc_ids.json").exists()

    def test_service_graph_exists(self, tmp_path: Path) -> None:
        """Service graph JSON file exists and is valid."""
        indexer = CompositeIndexer(tmp_path)

        chunks = [
            make_embedded_chunk(make_deploy_chunk("kind: Service", service_name="svc-a")),
            make_embedded_chunk(make_code_chunk("func A() {}", service_name="svc-a")),
        ]
        indexer.index(chunks)
        indexer.finalize()

        graph_path = tmp_path / "service_graph.json"
        assert graph_path.exists()

        with open(graph_path) as f:
            data = json.load(f)
        assert "nodes" in data
        assert "edges" in data


class TestIncrementalIndexing:
    """Tests for delete and re-index functionality."""

    def test_delete_and_reindex(self, tmp_path: Path) -> None:
        """Delete repo -> re-index -> counts correct."""
        indexer = CompositeIndexer(tmp_path)

        # Initial index
        chunks_a = [
            make_embedded_chunk(make_code_chunk(f"func A{i}() {{}}", repo_name="repo-a"))
            for i in range(5)
        ]
        chunks_b = [
            make_embedded_chunk(make_code_chunk(f"func B{i}() {{}}", repo_name="repo-b"))
            for i in range(3)
        ]
        indexer.index(chunks_a + chunks_b)
        assert indexer.count() == 8

        # Delete repo-a
        source_a = CrawlSource(
            source_kind=SourceKind.REPO,
            path=Path("/repos/repo-a"),
            repo_name="repo-a",
        )
        deleted = indexer.delete_by_source(source_a)

        assert deleted == 5
        assert indexer.count() == 3

        # Re-index with new chunks
        new_chunks = [
            make_embedded_chunk(make_code_chunk(f"func New{i}() {{}}", repo_name="repo-a"))
            for i in range(2)
        ]
        indexer.index(new_chunks)

        assert indexer.count() == 5  # 3 from repo-b + 2 new from repo-a

    def test_finalize_rebuilds_bm25(self, tmp_path: Path) -> None:
        """After delete + add, BM25 reflects new state."""
        indexer = CompositeIndexer(tmp_path)

        # Initial chunks - use distinct text to avoid token overlap
        chunk1 = make_embedded_chunk(
            make_code_chunk("func ProcessAlpha() {}", repo_name="repo-a")
        )
        old_chunk_id = chunk1.chunk.id
        indexer.index([chunk1])
        indexer.finalize()

        # Check BM25 can find old chunk
        results = indexer.bm25_store.query_code("ProcessAlpha")
        assert len(results) > 0
        assert results[0][0] == old_chunk_id

        # Delete and add new
        source = CrawlSource(
            source_kind=SourceKind.REPO,
            path=Path("/repo-a"),
            repo_name="repo-a",
        )
        indexer.delete_by_source(source)

        chunk2 = make_embedded_chunk(
            make_code_chunk("func HandleBeta() {}", repo_name="repo-a")
        )
        new_chunk_id = chunk2.chunk.id
        indexer.index([chunk2])
        indexer.finalize()

        # BM25 should now have only the new chunk
        # Old chunk ID should not appear in any results
        old_results = indexer.bm25_store.query_code("ProcessAlpha")
        new_results = indexer.bm25_store.query_code("HandleBeta")

        old_ids = [r[0] for r in old_results]
        assert old_chunk_id not in old_ids
        assert len(new_results) > 0
        assert new_results[0][0] == new_chunk_id


class TestAccessors:
    """Tests for accessing underlying stores."""

    def test_lance_store_accessible(self, tmp_path: Path) -> None:
        """Can access LanceStore for direct queries."""
        indexer = CompositeIndexer(tmp_path)

        chunk = make_embedded_chunk(make_code_chunk("func Test() {}"))
        indexer.index([chunk])

        # Access lance store directly
        assert indexer.lance_store.count() == 1

    def test_bm25_store_accessible(self, tmp_path: Path) -> None:
        """Can access BM25Store for direct queries."""
        indexer = CompositeIndexer(tmp_path)

        chunk = make_embedded_chunk(make_code_chunk("func HandleRequest() {}"))
        indexer.index([chunk])
        indexer.finalize()

        # Access BM25 store directly
        results = indexer.bm25_store.query_code("HandleRequest")
        assert len(results) > 0

    def test_service_graph_accessible(self, tmp_path: Path) -> None:
        """Can access ServiceGraph for direct queries."""
        indexer = CompositeIndexer(tmp_path)

        chunks = [
            make_embedded_chunk(make_deploy_chunk("kind: Service", service_name="test-svc")),
        ]
        indexer.index(chunks)
        indexer.finalize()

        # Access graph directly
        assert indexer.service_graph.node_count >= 1


class TestAllChunks:
    """Tests for all_chunks retrieval."""

    def test_all_chunks_returns_all(self, tmp_path: Path) -> None:
        """all_chunks() returns all indexed chunks."""
        indexer = CompositeIndexer(tmp_path)

        chunks = [
            make_embedded_chunk(make_code_chunk(f"func F{i}() {{}}", symbol_name=f"F{i}"))
            for i in range(10)
        ]
        indexer.index(chunks)

        all_chunks = indexer.all_chunks()
        assert len(all_chunks) == 10

    def test_all_chunks_empty(self, tmp_path: Path) -> None:
        """all_chunks() returns empty list for empty index."""
        indexer = CompositeIndexer(tmp_path)

        all_chunks = indexer.all_chunks()
        assert all_chunks == []


class TestCustomResolver:
    """Tests for custom resolver configuration."""

    def test_custom_resolver_used(self, tmp_path: Path) -> None:
        """Custom resolver is used for graph building."""
        # Create a strict resolver
        strict_resolver = ServiceNameResolver(min_similarity=0.95)
        indexer = CompositeIndexer(tmp_path, resolver=strict_resolver)

        chunks = [
            make_embedded_chunk(make_deploy_chunk("kind: Service", service_name="auth-service")),
            make_embedded_chunk(make_deploy_chunk("kind: Service", service_name="user-service")),
            # This call uses a partial name that won't match with strict resolver
            make_embedded_chunk(
                make_code_chunk(
                    "func Handler() {}",
                    service_name="auth-service",
                    calls_out=["usr"],  # Won't match "user-service" with strict threshold
                )
            ),
        ]
        indexer.index(chunks)
        indexer.finalize()

        # With strict resolver, the partial name shouldn't create an edge
        # (depends on resolver implementation details)
        assert indexer.service_graph.node_count == 2


class TestDirectoryCreation:
    """Tests for output directory handling."""

    def test_creates_output_directory(self, tmp_path: Path) -> None:
        """Output directory is created if it doesn't exist."""
        output_dir = tmp_path / "new" / "nested" / "dir"
        indexer = CompositeIndexer(output_dir)

        chunk = make_embedded_chunk(make_code_chunk("func Test() {}"))
        indexer.index([chunk])

        assert output_dir.exists()

    def test_works_with_existing_directory(self, tmp_path: Path) -> None:
        """Works with pre-existing output directory."""
        output_dir = tmp_path / "existing"
        output_dir.mkdir()

        indexer = CompositeIndexer(output_dir)
        chunk = make_embedded_chunk(make_code_chunk("func Test() {}"))
        indexer.index([chunk])

        assert indexer.count() == 1
