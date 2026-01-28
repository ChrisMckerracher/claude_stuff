"""Tests for LanceStore."""

from __future__ import annotations

from pathlib import Path

import pytest

from rag.indexing.lance_store import LanceStore
from tests.fixtures.chunks.sample_clean_chunks import (
    make_code_chunk,
    make_deploy_chunk,
    make_doc_chunk,
    make_embedded_chunk,
    make_slack_chunk,
)


class TestLanceStoreBasics:
    """Basic CRUD operations."""

    def test_create_table(self, tmp_path: Path) -> None:
        """Table created with correct schema."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        assert store.count() == 0

    def test_insert_and_count(self, tmp_path: Path) -> None:
        """Insert 10 chunks -> count is 10."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            make_embedded_chunk(
                make_code_chunk(f"func H{i}() {{}}", symbol_name=f"H{i}")
            )
            for i in range(10)
        ]
        store.insert(chunks)

        assert store.count() == 10

    def test_insert_all_fields(self, tmp_path: Path) -> None:
        """All metadata fields survive roundtrip."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunk = make_code_chunk(
            "func Test() {}",
            source_uri="repo://my-repo/src/test.go",
            repo_name="my-repo",
            language="go",
            service_name="test-service",
            symbol_name="Test",
            symbol_kind="function",
            signature="func Test()",
            file_path="src/test.go",
            git_hash="deadbeef",
            imports=["fmt", "net/http"],
            calls_out=["http://other-service:8080"],
            called_by=["HandleRequest"],
        )
        embedded = make_embedded_chunk(chunk)
        store.insert([embedded])

        records = store.all_chunks()
        assert len(records) == 1

        r = records[0]
        assert r["id"] == chunk.id
        assert r["source_uri"] == "repo://my-repo/src/test.go"
        assert r["repo_name"] == "my-repo"
        assert r["language"] == "go"
        assert r["service_name"] == "test-service"
        assert r["symbol_name"] == "Test"
        assert r["symbol_kind"] == "function"
        assert r["signature"] == "func Test()"
        assert r["file_path"] == "src/test.go"
        assert r["git_hash"] == "deadbeef"
        assert "fmt" in r["imports"]
        assert "http://other-service:8080" in r["calls_out"]

    def test_empty_table(self, tmp_path: Path) -> None:
        """Operations on empty table don't crash."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        assert store.count() == 0
        assert store.all_chunks() == []

    def test_idempotent_create_or_open(self, tmp_path: Path) -> None:
        """Calling create_or_open twice doesn't drop data."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            make_embedded_chunk(make_code_chunk("func Test() {}"))
        ]
        store.insert(chunks)
        assert store.count() == 1

        # Open again
        store.create_or_open()
        assert store.count() == 1

    def test_insert_empty_list(self, tmp_path: Path) -> None:
        """Inserting empty list is a no-op."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        store.insert([])
        assert store.count() == 0


class TestLanceStoreSearch:
    """Vector search tests."""

    @pytest.fixture
    def populated_store(self, tmp_path: Path) -> LanceStore:
        """Create a store with diverse chunks."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            # Code chunks
            make_embedded_chunk(
                make_code_chunk(
                    "func HandleAuth() {}",
                    service_name="auth-service",
                    repo_name="auth-repo",
                ),
                vector=[1.0] + [0.0] * 767,  # Distinctive vector
            ),
            make_embedded_chunk(
                make_code_chunk(
                    "func ProcessPayment() {}",
                    service_name="payment-service",
                    repo_name="payment-repo",
                ),
                vector=[0.0, 1.0] + [0.0] * 766,
            ),
            # Deploy chunk
            make_embedded_chunk(
                make_deploy_chunk(
                    "apiVersion: v1\nkind: Deployment",
                    service_name="auth-service",
                    repo_name="auth-repo",
                ),
                vector=[0.0, 0.0, 1.0] + [0.0] * 765,
            ),
            # Doc chunk
            make_embedded_chunk(
                make_doc_chunk(
                    "# Authentication\n\nHow to authenticate.",
                    repo_name="auth-repo",
                ),
                vector=[0.0] * 3 + [1.0] + [0.0] * 764,
            ),
        ]
        store.insert(chunks)
        return store

    def test_search_returns_results(self, populated_store: LanceStore) -> None:
        """Dense search on inserted vectors returns matches."""
        # Query vector similar to first chunk
        query_vec = [0.9] + [0.1] * 767

        results = populated_store.search(query_vec, top_k=10)

        assert len(results) > 0
        # First result should be the auth handler (most similar)
        assert "HandleAuth" in results[0]["text"]

    def test_search_top_k(self, populated_store: LanceStore) -> None:
        """Requesting top_k=2 returns <= 2 results."""
        query_vec = [0.5] * 768

        results = populated_store.search(query_vec, top_k=2)

        assert len(results) <= 2

    def test_search_corpus_filter(self, populated_store: LanceStore) -> None:
        """Filter by CODE_LOGIC -> only code chunks returned."""
        query_vec = [0.5] * 768

        results = populated_store.search(
            query_vec,
            top_k=10,
            corpus_filter=["CODE_LOGIC"],
        )

        for r in results:
            assert r["corpus_type"] == "CODE_LOGIC"

    def test_search_service_filter(self, populated_store: LanceStore) -> None:
        """Filter by service_name -> only that service."""
        query_vec = [0.5] * 768

        results = populated_store.search(
            query_vec,
            top_k=10,
            service_filter="auth-service",
        )

        for r in results:
            assert r["service_name"] == "auth-service"

    def test_search_repo_filter(self, populated_store: LanceStore) -> None:
        """Filter by repo_name -> only that repo."""
        query_vec = [0.5] * 768

        results = populated_store.search(
            query_vec,
            top_k=10,
            repo_filter=["payment-repo"],
        )

        for r in results:
            assert r["repo_name"] == "payment-repo"


class TestLanceStoreDelete:
    """Delete operations."""

    def test_delete_by_repo(self, tmp_path: Path) -> None:
        """Delete by repo_name -> only those chunks removed."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            make_embedded_chunk(
                make_code_chunk("func A() {}", repo_name="repo-a")
            ),
            make_embedded_chunk(
                make_code_chunk("func B() {}", repo_name="repo-b")
            ),
            make_embedded_chunk(
                make_code_chunk("func A2() {}", repo_name="repo-a")
            ),
        ]
        store.insert(chunks)
        assert store.count() == 3

        deleted = store.delete_by_repo("repo-a")

        assert deleted == 2
        assert store.count() == 1

        remaining = store.all_chunks()
        assert remaining[0]["repo_name"] == "repo-b"

    def test_delete_returns_count(self, tmp_path: Path) -> None:
        """Delete returns correct number of removed chunks."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            make_embedded_chunk(
                make_code_chunk(f"func F{i}() {{}}", repo_name="test-repo")
            )
            for i in range(5)
        ]
        store.insert(chunks)

        deleted = store.delete_by_repo("test-repo")

        assert deleted == 5
        assert store.count() == 0

    def test_delete_by_source_uri_prefix(self, tmp_path: Path) -> None:
        """Delete by source_uri prefix removes matching chunks."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        chunks = [
            make_embedded_chunk(
                make_slack_chunk("msg 1", source_uri="slack://workspace/C123/t1")
            ),
            make_embedded_chunk(
                make_slack_chunk("msg 2", source_uri="slack://workspace/C123/t2")
            ),
            make_embedded_chunk(
                make_slack_chunk("msg 3", source_uri="slack://workspace/C456/t1")
            ),
        ]
        store.insert(chunks)
        assert store.count() == 3

        deleted = store.delete_by_source_uri_prefix("slack://workspace/C123")

        assert deleted == 2
        assert store.count() == 1


class TestLanceStoreRoundtrip:
    """Data integrity tests."""

    def test_all_chunks_roundtrip(self, tmp_path: Path) -> None:
        """Insert -> all_chunks() -> matches original data."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        original_chunks = [
            make_code_chunk("func A() {}", symbol_name="A"),
            make_deploy_chunk("kind: Service", service_name="svc-a"),
            make_doc_chunk("# Docs", section_path="Root"),
        ]
        embedded = [make_embedded_chunk(c) for c in original_chunks]
        store.insert(embedded)

        records = store.all_chunks()

        assert len(records) == 3
        ids = {r["id"] for r in records}
        original_ids = {c.id for c in original_chunks}
        assert ids == original_ids

    def test_vector_preserved(self, tmp_path: Path) -> None:
        """Vector values survive roundtrip."""
        store = LanceStore(str(tmp_path / "test.lance"))
        store.create_or_open()

        original_vector = [float(i) / 768 for i in range(768)]
        chunk = make_embedded_chunk(
            make_code_chunk("func Test() {}"),
            vector=original_vector,
        )
        store.insert([chunk])

        records = store.all_chunks()
        stored_vector = records[0]["vector"]

        for orig, stored in zip(original_vector, stored_vector):
            assert abs(orig - stored) < 1e-5
