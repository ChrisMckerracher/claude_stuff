# Task 0.3: Define Processing Protocols

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define the protocol interfaces for content processing: chunking, scrubbing, embedding, and crawling.

## File

`rag/core/protocols.py` (continued)

## Protocols to Implement

### Chunker Protocol

```python
class Chunker(Protocol):
    """Protocol for content chunking."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks from content.

        Args:
            content: Raw file content as bytes
            source_uri: Unique identifier for the source (e.g., file path)
            language: Programming language hint (for AST chunking)

        Yields:
            RawChunk objects with unique IDs and byte ranges

        Raises:
            ChunkingError: Content could not be parsed
        """
        ...
```

### Scrubber Protocol

```python
class Scrubber(Protocol):
    """Protocol for PHI removal."""

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Raises:
            ScrubError: Scrubbing failed (e.g., encoding issues, analyzer error)
        """
        ...

    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing for efficiency. Never raises.

        Returns:
            List of ScrubResult in same order as input chunks.
            Check result.success to determine if scrubbing succeeded.
            Failed chunks have result.error set.

        Error Handling:
            - Individual chunk failures don't affect other chunks
            - All chunks are attempted even if some fail
        """
        ...
```

### ScrubResult

```python
@dataclass
class ScrubResult:
    """Result of scrubbing a single chunk."""
    chunk_id: ChunkID
    clean_chunk: CleanChunk | None  # None if failed
    error: str | None  # None if successful

    @property
    def success(self) -> bool:
        return self.clean_chunk is not None
```

### Embedder Protocol

```python
class Embedder(Protocol):
    """Protocol for vector embedding."""

    def embed(self, text: str) -> list[float]:
        """Single text to vector.

        Returns:
            Vector of length self.dimension

        Raises:
            EmbeddingError: Embedding failed
        """
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding for efficiency.

        Returns:
            List of vectors in same order as input texts

        Raises:
            EmbeddingError: Batch embedding failed
        """
        ...

    @property
    def dimension(self) -> int:
        """Vector dimension (e.g., 768 for jina-embeddings-v3)."""
        ...
```

### Crawler Protocol

```python
class Crawler(Protocol):
    """Protocol for source crawling."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield content from source.

        Args:
            source: CrawlSource specifying what to crawl

        Yields:
            CrawlResult objects with content and metadata
        """
        ...
```

### CrawlSource and CrawlResult

```python
@dataclass
class CrawlSource:
    """Specification for what to crawl."""
    type: Literal["git_repo", "directory", "slack_export", "transcript"]
    path: str
    metadata: dict[str, Any] = field(default_factory=dict)

@dataclass
class CrawlResult:
    """Result from crawling a single source item."""
    content: bytes
    source_uri: str
    language: str | None  # Programming language if applicable
    metadata: dict[str, Any]
```

## Acceptance Criteria

- [ ] Chunker protocol defined with chunk() method
- [ ] Scrubber protocol defined with scrub() and scrub_batch() methods
- [ ] Embedder protocol defined with embed(), embed_batch(), dimension
- [ ] Crawler protocol defined with crawl() method
- [ ] CrawlSource and CrawlResult dataclasses defined
- [ ] ScrubResult dataclass defined with success property

## Dependencies

- Task 0.1 (Core Data Types) must be complete

## Estimated Time

30 minutes
