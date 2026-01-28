"""Pipeline stage protocols (structural interfaces).

Each pipeline stage is defined by a Protocol -- a structural interface
that any implementation must satisfy. No base classes, no inheritance.
"""

from __future__ import annotations

from typing import Iterator, Protocol

from rag.models.chunk import CleanChunk, EmbeddedChunk, RawChunk
from rag.models.types import CrawlSource


class Crawler(Protocol):
    """Discovers content in a source and yields typed RawChunks."""

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        ...

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from the source."""
        ...


class Scrubber(Protocol):
    """Detects and removes PHI/PII from chunk text."""

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Analyze text, replace PHI entities, return CleanChunk with audit trail."""
        ...


class Embedder(Protocol):
    """Encodes CleanChunks into dense vectors."""

    def embed_batch(self, chunks: list[CleanChunk]) -> list[EmbeddedChunk]:
        """Batch-encode chunks. Returns EmbeddedChunks with dense vectors."""
        ...


class Indexer(Protocol):
    """Writes EmbeddedChunks to persistent stores."""

    def index(self, chunks: list[EmbeddedChunk]) -> None:
        """Write to LanceDB (vectors + metadata) and accumulate for BM25."""
        ...

    def finalize(self) -> None:
        """Build BM25 index, write service graph, write manifest."""
        ...
