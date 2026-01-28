"""Ingest manifest types for tracking crawl state."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SourceManifest:
    """Per-source tracking in manifest.json.

    Every CrawlSource that has been ingested gets an entry.
    This is how the pipeline knows what's already indexed.
    """

    source_kind: str
    path_hash: str
    repo_name: str | None
    last_git_hash: str | None
    last_file_hash: str | None
    last_ingest_at: str
    chunk_count: int
    corpus_types_indexed: list[str]


@dataclass
class IngestManifest:
    """Root manifest. Serialized to data/manifest.json."""

    version: int = 1
    created_at: str = ""
    updated_at: str = ""
    total_chunk_count: int = 0
    sources: dict[str, SourceManifest] = field(default_factory=dict)
    corpus_counts: dict[str, int] = field(default_factory=dict)
    service_count: int = 0
    edge_count: int = 0
