"""Query and result dataclasses for the retrieval pipeline.

Defines QueryRequest for specifying queries and QueryResult for returning
scored chunks with retrieval metadata.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class QueryRequest:
    """A query request with filtering and configuration options."""

    text: str
    corpus_filter: list[str] | None = None
    service_filter: str | None = None
    repo_filter: list[str] | None = None
    top_k: int = 20
    expand_graph: bool = False
    freshness_half_life_days: float = 90.0
    freshness_weight: float = 0.1
    rerank: bool = True


@dataclass
class ScoredChunk:
    """A chunk with its retrieval scores at each stage."""

    id: str
    text: str
    context_prefix: str
    corpus_type: str
    source_uri: str
    service_name: str | None
    repo_name: str | None
    file_path: str | None
    language: str | None
    symbol_name: str | None
    signature: str | None
    section_path: str | None
    author: str | None
    timestamp: str | None
    channel: str | None
    # Scores at different stages
    dense_score: float | None = None
    bm25_code_score: float | None = None
    bm25_nlp_score: float | None = None
    rrf_score: float | None = None
    rerank_score: float | None = None
    final_score: float = 0.0


@dataclass
class ServiceContext:
    """Graph neighborhood for a service."""

    service_name: str
    calls: list[str] = field(default_factory=list)
    called_by: list[str] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class QueryResult:
    """Result of a retrieval query."""

    chunks: list[ScoredChunk]
    service_context: dict[str, ServiceContext] | None = None
    query_metadata: dict[str, Any] | None = None
