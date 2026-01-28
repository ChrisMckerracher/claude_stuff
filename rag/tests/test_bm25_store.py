"""Tests for BM25Store."""

from __future__ import annotations

from pathlib import Path

import pytest

from rag.indexing.bm25_store import BM25Store
from tests.fixtures.chunks.sample_clean_chunks import (
    make_code_chunk,
    make_doc_chunk,
    make_embedded_chunk,
)


class TestBM25StoreBuild:
    """Index building tests."""

    def test_build_index(self) -> None:
        """Building from 100 chunks succeeds."""
        store = BM25Store()

        chunks = [
            {
                "id": f"chunk-{i}",
                "text": f"func Handler{i}() {{ return process{i}() }}",
                "corpus_type": "CODE_LOGIC",
            }
            for i in range(100)
        ]

        store.build(chunks)

        assert store.doc_count == 100

    def test_build_empty(self) -> None:
        """Building from empty list creates empty index."""
        store = BM25Store()
        store.build([])

        assert store.doc_count == 0

    def test_build_mixed_corpus_types(self) -> None:
        """Building with mixed corpus types uses appropriate tokenizers."""
        store = BM25Store()

        chunks = [
            {"id": "code-1", "text": "func getUserProfile()", "corpus_type": "CODE_LOGIC"},
            {"id": "doc-1", "text": "How to get user profiles", "corpus_type": "DOC_README"},
            {"id": "deploy-1", "text": "kind: Deployment", "corpus_type": "CODE_DEPLOY"},
        ]

        store.build(chunks)
        assert store.doc_count == 3


class TestBM25StoreQuery:
    """Query tests."""

    @pytest.fixture
    def code_store(self) -> BM25Store:
        """Store with code chunks for testing."""
        store = BM25Store()
        chunks = [
            {"id": "1", "text": "func getUserProfile(ctx context.Context)", "corpus_type": "CODE_LOGIC"},
            {"id": "2", "text": "func processPayment(amount int)", "corpus_type": "CODE_LOGIC"},
            {"id": "3", "text": "func handleAuthRequest(token string)", "corpus_type": "CODE_LOGIC"},
            {"id": "4", "text": "func get_user_settings(user_id int)", "corpus_type": "CODE_LOGIC"},
        ]
        store.build(chunks)
        return store

    @pytest.fixture
    def doc_store(self) -> BM25Store:
        """Store with doc chunks for testing."""
        store = BM25Store()
        chunks = [
            {"id": "d1", "text": "Authentication is handled by the auth service", "corpus_type": "DOC_README"},
            {"id": "d2", "text": "Payment processing requires valid credentials", "corpus_type": "DOC_README"},
            {"id": "d3", "text": "User profiles are stored in the database", "corpus_type": "DOC_README"},
        ]
        store.build(chunks)
        return store

    def test_query_code_tokens(self, code_store: BM25Store) -> None:
        """Code-tokenized query finds code chunk."""
        results = code_store.query_code("getUserProfile")

        assert len(results) > 0
        # First result should be the getUserProfile function
        assert results[0][0] == "1"

    def test_query_nlp_tokens(self, doc_store: BM25Store) -> None:
        """NLP-tokenized query finds doc chunk."""
        results = doc_store.query_nlp("authentication service")

        assert len(results) > 0
        # Should find the auth doc
        assert results[0][0] == "d1"

    def test_camel_case_match(self, code_store: BM25Store) -> None:
        """Query "getUser" matches chunk containing "getUserProfile"."""
        results = code_store.query_code("getUser")

        assert len(results) > 0
        # Should find getUserProfile
        found_ids = [r[0] for r in results]
        assert "1" in found_ids

    def test_snake_case_match(self, code_store: BM25Store) -> None:
        """Query "get_user" matches chunk containing "get_user_settings"."""
        results = code_store.query_code("get_user")

        assert len(results) > 0
        # Should find get_user_settings
        found_ids = [r[0] for r in results]
        assert "4" in found_ids

    def test_top_k_limit(self, code_store: BM25Store) -> None:
        """Requesting 2 results returns <= 2."""
        results = code_store.query_code("func", top_k=2)

        assert len(results) <= 2

    def test_empty_query(self, code_store: BM25Store) -> None:
        """Empty token list returns empty results."""
        results = code_store.query([])

        assert results == []

    def test_doc_ids_match(self, code_store: BM25Store) -> None:
        """Returned IDs are valid chunk IDs from the store."""
        results = code_store.query_code("handler")

        valid_ids = {"1", "2", "3", "4"}
        for chunk_id, _ in results:
            assert chunk_id in valid_ids


class TestBM25StorePersistence:
    """Save/load tests."""

    def test_save_load_roundtrip(self, tmp_path: Path) -> None:
        """Save to disk -> load -> same query results."""
        # Build and save
        store1 = BM25Store()
        chunks = [
            {"id": "1", "text": "func handleRequest()", "corpus_type": "CODE_LOGIC"},
            {"id": "2", "text": "func processResponse()", "corpus_type": "CODE_LOGIC"},
        ]
        store1.build(chunks)

        results_before = store1.query_code("handleRequest")
        store1.save(str(tmp_path / "bm25"))

        # Load and query
        store2 = BM25Store()
        store2.load(str(tmp_path / "bm25"))

        results_after = store2.query_code("handleRequest")

        assert store2.doc_count == store1.doc_count
        assert len(results_after) == len(results_before)
        assert results_after[0][0] == results_before[0][0]

    def test_save_creates_directory(self, tmp_path: Path) -> None:
        """Save creates the index directory if it doesn't exist."""
        store = BM25Store()
        store.build([{"id": "1", "text": "test", "corpus_type": "DOC_README"}])

        save_path = tmp_path / "nested" / "bm25"
        store.save(str(save_path))

        assert save_path.exists()
        assert (save_path / "doc_ids.json").exists()

    def test_load_preserves_doc_ids(self, tmp_path: Path) -> None:
        """Loaded index has correct document ID mapping."""
        store1 = BM25Store()
        chunks = [
            {"id": "chunk-alpha", "text": "alpha content", "corpus_type": "DOC_README"},
            {"id": "chunk-beta", "text": "beta content", "corpus_type": "DOC_README"},
        ]
        store1.build(chunks)
        store1.save(str(tmp_path / "bm25"))

        store2 = BM25Store()
        store2.load(str(tmp_path / "bm25"))

        # Query should return the correct ID
        results = store2.query_nlp("alpha")
        assert len(results) > 0
        assert results[0][0] == "chunk-alpha"


class TestBM25StoreScoring:
    """Score-related tests."""

    def test_scores_are_positive(self) -> None:
        """BM25 scores should be positive for matches."""
        store = BM25Store()
        chunks = [
            {"id": "1", "text": "error handling in go", "corpus_type": "DOC_README"},
        ]
        store.build(chunks)

        results = store.query_nlp("error handling")

        assert len(results) > 0
        assert results[0][1] > 0

    def test_better_match_higher_score(self) -> None:
        """More relevant matches should have higher scores."""
        store = BM25Store()
        chunks = [
            {"id": "exact", "text": "error handling patterns", "corpus_type": "DOC_README"},
            {"id": "partial", "text": "some error occurred", "corpus_type": "DOC_README"},
        ]
        store.build(chunks)

        results = store.query_nlp("error handling")

        # Find scores for each doc
        scores = {r[0]: r[1] for r in results}

        # Exact match should score higher
        assert scores.get("exact", 0) > scores.get("partial", 0)
