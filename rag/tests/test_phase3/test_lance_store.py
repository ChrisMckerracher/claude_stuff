"""Tests for the LanceDB vector store."""

import tempfile
from pathlib import Path

import pytest

from rag.config import EMBEDDING_DIM
from rag.core.errors import DimensionMismatchError
from rag.core.types import ChunkID, CleanChunk, CorpusType, EmbeddedChunk
from rag.indexing.embedder import MockEmbedder
from rag.indexing.lance_store import LanceStore


def make_embedded_chunk(
    text: str,
    chunk_id: str | None = None,
    corpus_type: CorpusType = CorpusType.CODE_LOGIC,
    embedder: MockEmbedder | None = None,
) -> EmbeddedChunk:
    """Helper to create EmbeddedChunk for testing."""
    if embedder is None:
        embedder = MockEmbedder()

    if chunk_id is None:
        chunk_id = f"chunk-{hash(text) % 10000}"

    clean_chunk = CleanChunk(
        id=ChunkID(chunk_id),
        text=text,
        source_uri="test://source.py",
        corpus_type=corpus_type,
        context_prefix="test > file",
        metadata={"test": True},
        scrub_log=[],
    )

    return EmbeddedChunk(
        chunk=clean_chunk,
        vector=embedder.embed(text),
    )


class TestLanceStoreInsert:
    """Tests for insert operations."""

    @pytest.fixture
    def store(self) -> LanceStore:
        """Create a temporary store for testing."""
        temp_dir = tempfile.mkdtemp()
        return LanceStore(db_path=str(Path(temp_dir) / "lance"))

    @pytest.mark.asyncio
    async def test_insert_single_chunk(self, store: LanceStore) -> None:
        """Should insert a single chunk successfully."""
        chunk = make_embedded_chunk("hello world")
        await store.insert(chunk)

        # Verify by searching
        results = await store.search(chunk.vector, limit=1)
        assert len(results) == 1
        assert results[0].chunk.text == "hello world"

    @pytest.mark.asyncio
    async def test_insert_idempotent(self, store: LanceStore) -> None:
        """Inserting same chunk twice should be idempotent."""
        chunk = make_embedded_chunk("hello world", chunk_id="chunk-123")

        await store.insert(chunk)
        await store.insert(chunk)  # Should not raise

        # Should only find one result
        results = await store.search(chunk.vector, limit=10)
        assert len(results) == 1

    @pytest.mark.asyncio
    async def test_insert_dimension_mismatch(self, store: LanceStore) -> None:
        """Should raise DimensionMismatchError for wrong dimension."""
        clean_chunk = CleanChunk(
            id=ChunkID("chunk-wrong-dim"),
            text="test",
            source_uri="test://source.py",
            corpus_type=CorpusType.CODE_LOGIC,
            context_prefix="test",
            metadata={},
            scrub_log=[],
        )

        # Create chunk with wrong dimension (512 instead of 768)
        wrong_dim_chunk = EmbeddedChunk(
            chunk=clean_chunk,
            vector=[0.1] * 512,
        )

        with pytest.raises(DimensionMismatchError) as exc_info:
            await store.insert(wrong_dim_chunk)

        assert exc_info.value.expected == EMBEDDING_DIM
        assert exc_info.value.actual == 512


class TestLanceStoreBatch:
    """Tests for batch operations."""

    @pytest.fixture
    def store(self) -> LanceStore:
        """Create a temporary store for testing."""
        temp_dir = tempfile.mkdtemp()
        return LanceStore(db_path=str(Path(temp_dir) / "lance"))

    @pytest.mark.asyncio
    async def test_batch_insert_all_succeed(self, store: LanceStore) -> None:
        """Batch insert should succeed for valid chunks."""
        chunks = [
            make_embedded_chunk(f"chunk {i}", chunk_id=f"chunk-{i}")
            for i in range(5)
        ]

        result = await store.insert_batch(chunks)

        assert result.success is True
        assert result.inserted_count == 5
        assert len(result.failed_chunks) == 0
        assert result.partial_success is False

    @pytest.mark.asyncio
    async def test_batch_insert_partial_failure(self, store: LanceStore) -> None:
        """Batch insert should handle partial failures."""
        embedder = MockEmbedder()

        # Create mix of valid and invalid chunks
        valid_chunk = make_embedded_chunk("valid", chunk_id="valid-1", embedder=embedder)
        invalid_chunk = EmbeddedChunk(
            chunk=CleanChunk(
                id=ChunkID("invalid-1"),
                text="invalid",
                source_uri="test://source.py",
                corpus_type=CorpusType.CODE_LOGIC,
                context_prefix="test",
                metadata={},
                scrub_log=[],
            ),
            vector=[0.1] * 512,  # Wrong dimension
        )

        result = await store.insert_batch([valid_chunk, invalid_chunk])

        assert result.success is False
        assert result.partial_success is True
        assert result.inserted_count == 1
        assert len(result.failed_chunks) == 1
        assert result.failed_chunks[0][0].value == "invalid-1"


class TestLanceStoreSearch:
    """Tests for search operations."""

    @pytest.fixture
    async def populated_store(self) -> LanceStore:
        """Create a store with sample data."""
        temp_dir = tempfile.mkdtemp()
        store = LanceStore(db_path=str(Path(temp_dir) / "lance"))

        embedder = MockEmbedder()
        chunks = [
            make_embedded_chunk(
                "def authenticate_user(): pass",
                chunk_id="auth-1",
                corpus_type=CorpusType.CODE_LOGIC,
                embedder=embedder,
            ),
            make_embedded_chunk(
                "def get_user(): pass",
                chunk_id="user-1",
                corpus_type=CorpusType.CODE_LOGIC,
                embedder=embedder,
            ),
            make_embedded_chunk(
                "# User guide documentation",
                chunk_id="doc-1",
                corpus_type=CorpusType.DOC_README,
                embedder=embedder,
            ),
        ]

        for chunk in chunks:
            await store.insert(chunk)

        return store

    @pytest.mark.asyncio
    async def test_search_returns_results(self, populated_store: LanceStore) -> None:
        """Search should return matching results."""
        embedder = MockEmbedder()
        query_vector = embedder.embed("user authentication")

        results = await populated_store.search(query_vector, limit=10)

        assert len(results) > 0
        assert all(hasattr(r, "chunk") for r in results)
        assert all(hasattr(r, "score") for r in results)

    @pytest.mark.asyncio
    async def test_search_respects_limit(self, populated_store: LanceStore) -> None:
        """Search should respect the limit parameter."""
        embedder = MockEmbedder()
        query_vector = embedder.embed("test")

        results = await populated_store.search(query_vector, limit=2)

        assert len(results) <= 2

    @pytest.mark.asyncio
    async def test_search_with_filter(self, populated_store: LanceStore) -> None:
        """Search should apply filters correctly."""
        embedder = MockEmbedder()
        query_vector = embedder.embed("user")

        results = await populated_store.search(
            query_vector,
            limit=10,
            filters={"corpus_type": "DOC_README"},
        )

        assert len(results) >= 1
        assert all(r.chunk.corpus_type == CorpusType.DOC_README for r in results)

    @pytest.mark.asyncio
    async def test_search_empty_store(self) -> None:
        """Search on empty store should return empty list."""
        temp_dir = tempfile.mkdtemp()
        store = LanceStore(db_path=str(Path(temp_dir) / "lance"))

        embedder = MockEmbedder()
        query_vector = embedder.embed("test")

        results = await store.search(query_vector, limit=10)

        assert results == []

    @pytest.mark.asyncio
    async def test_search_dimension_mismatch(
        self, populated_store: LanceStore
    ) -> None:
        """Search with wrong dimension should raise error."""
        wrong_dim_vector = [0.1] * 512

        with pytest.raises(DimensionMismatchError):
            await populated_store.search(wrong_dim_vector, limit=10)


class TestLanceStoreDelete:
    """Tests for delete operations."""

    @pytest.fixture
    def store(self) -> LanceStore:
        """Create a temporary store for testing."""
        temp_dir = tempfile.mkdtemp()
        return LanceStore(db_path=str(Path(temp_dir) / "lance"))

    @pytest.mark.asyncio
    async def test_delete_existing_chunk(self, store: LanceStore) -> None:
        """Delete should return True for existing chunk."""
        chunk = make_embedded_chunk("to be deleted", chunk_id="chunk-to-delete")
        await store.insert(chunk)

        result = await store.delete(ChunkID("chunk-to-delete"))

        assert result is True

        # Verify it's gone
        results = await store.search(chunk.vector, limit=10)
        assert not any(r.chunk.id.value == "chunk-to-delete" for r in results)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_chunk(self, store: LanceStore) -> None:
        """Delete should return False for non-existent chunk."""
        # Insert something first to ensure table exists
        chunk = make_embedded_chunk("existing", chunk_id="existing-chunk")
        await store.insert(chunk)

        result = await store.delete(ChunkID("non-existent"))

        assert result is False

    @pytest.mark.asyncio
    async def test_delete_empty_store(self, store: LanceStore) -> None:
        """Delete on empty store should return False."""
        result = await store.delete(ChunkID("any-id"))

        assert result is False
