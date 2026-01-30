# Task 7.1: Ingestion Orchestrator

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement the main orchestrator that coordinates the full ingestion pipeline.

## File

`rag/pipeline/orchestrator.py`

## Implementation

```python
from dataclasses import dataclass, field
from typing import Any
from rag.core.types import CrawlSource, CrawlResult, RawChunk, CleanChunk, EmbeddedChunk
from rag.core.protocols import Crawler, Chunker, Scrubber, Embedder, VectorStore, GraphStore

@dataclass
class IngestionStats:
    """Statistics from an ingestion run."""
    files_crawled: int = 0
    chunks_created: int = 0
    chunks_scrubbed: int = 0
    chunks_embedded: int = 0
    chunks_stored: int = 0
    graph_episodes: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        """True if no errors occurred."""
        return len(self.errors) == 0


class IngestionOrchestrator:
    """Orchestrate full ingestion pipeline.

    Pipeline flow:
    1. Crawl source for files
    2. Chunk each file
    3. Scrub PHI from chunks
    4. Embed clean chunks
    5. Store vectors in LanceDB
    6. Add episodes to graph store
    """

    def __init__(
        self,
        crawler: Crawler,
        chunker: Chunker,
        scrubber: Scrubber,
        embedder: Embedder,
        vector_store: VectorStore,
        graph_store: GraphStore,
    ):
        """Initialize with all pipeline components.

        Args:
            crawler: Crawler for finding source files
            chunker: Chunker for splitting content
            scrubber: Scrubber for PHI removal
            embedder: Embedder for vectorization
            vector_store: Vector store for similarity search
            graph_store: Graph store for relationships
        """
        self._crawler = crawler
        self._chunker = chunker
        self._scrubber = scrubber
        self._embedder = embedder
        self._vector = vector_store
        self._graph = graph_store

    async def ingest(self, source: CrawlSource) -> IngestionStats:
        """Run full ingestion pipeline.

        Args:
            source: CrawlSource specifying what to ingest

        Returns:
            IngestionStats with counts and any errors
        """
        stats = IngestionStats()

        for crawl_result in self._crawler.crawl(source):
            stats.files_crawled += 1

            try:
                await self._process_file(crawl_result, stats)
            except Exception as e:
                stats.errors.append(f"{crawl_result.source_uri}: {e}")

        return stats

    async def _process_file(
        self,
        crawl_result: CrawlResult,
        stats: IngestionStats,
    ) -> None:
        """Process a single file through the pipeline."""
        # 1. Chunk
        chunks = list(self._chunker.chunk(
            crawl_result.content,
            source_uri=crawl_result.source_uri,
            language=crawl_result.language,
        ))
        stats.chunks_created += len(chunks)

        # 2. Scrub
        scrub_results = self._scrubber.scrub_batch(chunks)
        clean_chunks = [r.clean_chunk for r in scrub_results if r.success]
        stats.chunks_scrubbed += len(clean_chunks)

        # Track scrub failures
        for r in scrub_results:
            if not r.success:
                stats.errors.append(f"Scrub failed for {r.chunk_id}: {r.error}")

        if not clean_chunks:
            return

        # 3. Embed
        texts = [c.text for c in clean_chunks]
        vectors = self._embedder.embed_batch(texts)
        embedded = [
            EmbeddedChunk(chunk=c, vector=v)
            for c, v in zip(clean_chunks, vectors)
        ]
        stats.chunks_embedded += len(embedded)

        # 4. Store vectors
        result = await self._vector.insert_batch(embedded)
        stats.chunks_stored += result.inserted_count

        for chunk_id, error in result.failed_chunks:
            stats.errors.append(f"Store failed for {chunk_id}: {error}")

        # 5. Add to graph
        await self._ingest_to_graph(crawl_result, clean_chunks, stats)

    async def _ingest_to_graph(
        self,
        crawl_result: CrawlResult,
        chunks: list[CleanChunk],
        stats: IngestionStats,
    ) -> None:
        """Add content to knowledge graph."""
        if crawl_result.language:
            # Code: create episode about the file
            await self._graph.add_episode(
                f"File {crawl_result.source_uri} contains code in {crawl_result.language}",
                source=crawl_result.source_uri,
            )
            stats.graph_episodes += 1
        else:
            # Documentation/conversation: extract entities from each chunk
            for chunk in chunks:
                try:
                    await self._graph.add_episode(
                        chunk.text,
                        source=chunk.source_uri,
                    )
                    stats.graph_episodes += 1
                except Exception as e:
                    stats.errors.append(f"Graph episode failed: {e}")


class BatchIngestionOrchestrator(IngestionOrchestrator):
    """Orchestrator optimized for batch processing."""

    def __init__(self, *args, batch_size: int = 100, **kwargs):
        super().__init__(*args, **kwargs)
        self._batch_size = batch_size

    async def ingest(self, source: CrawlSource) -> IngestionStats:
        """Batch-optimized ingestion."""
        stats = IngestionStats()
        batch: list[CrawlResult] = []

        for crawl_result in self._crawler.crawl(source):
            batch.append(crawl_result)

            if len(batch) >= self._batch_size:
                await self._process_batch(batch, stats)
                batch = []

        # Process remaining
        if batch:
            await self._process_batch(batch, stats)

        return stats

    async def _process_batch(
        self,
        batch: list[CrawlResult],
        stats: IngestionStats,
    ) -> None:
        """Process a batch of files."""
        for crawl_result in batch:
            stats.files_crawled += 1
            try:
                await self._process_file(crawl_result, stats)
            except Exception as e:
                stats.errors.append(f"{crawl_result.source_uri}: {e}")
```

## Tests

```python
@pytest.fixture
def orchestrator(mock_components):
    return IngestionOrchestrator(**mock_components)

async def test_ingest_single_file(orchestrator, tmp_path):
    (tmp_path / "main.py").write_text("def foo(): pass")
    source = CrawlSource("directory", str(tmp_path), {})

    stats = await orchestrator.ingest(source)

    assert stats.files_crawled == 1
    assert stats.chunks_created > 0
    assert stats.success

async def test_collects_errors(orchestrator_with_failing_scrubber, tmp_path):
    (tmp_path / "main.py").write_text("some code")
    source = CrawlSource("directory", str(tmp_path), {})

    stats = await orchestrator_with_failing_scrubber.ingest(source)

    assert len(stats.errors) > 0
    assert not stats.success

async def test_continues_after_file_error(orchestrator, tmp_path):
    (tmp_path / "good.py").write_text("def foo(): pass")
    (tmp_path / "bad.py").write_bytes(b'\xff\xfe')  # Invalid UTF-8

    source = CrawlSource("directory", str(tmp_path), {})
    stats = await orchestrator.ingest(source)

    # Should have processed good.py despite bad.py
    assert stats.files_crawled >= 1
    assert stats.chunks_created > 0
```

## Acceptance Criteria

- [ ] Coordinates all pipeline components
- [ ] Tracks statistics for each stage
- [ ] Collects errors without stopping pipeline
- [ ] Processes both code and text content
- [ ] Adds entries to graph store
- [ ] BatchIngestionOrchestrator handles large datasets

## Estimated Time

45 minutes
