"""Core type definitions: enums, source type registry entry, crawl source."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class SensitivityTier(Enum):
    """Determines whether PHI scrubbing is applied during ingestion.

    This is fixed per source type -- not configurable at runtime.
    """

    CLEAN = "clean"
    SENSITIVE = "sensitive"
    MAYBE_SENSITIVE = "maybe_sensitive"


class SourceKind(Enum):
    """What the CLI argument points to.

    One source kind may produce multiple corpus types (e.g., a REPO
    produces CODE_LOGIC + CODE_DEPLOY + CODE_CONFIG + DOC_README chunks).
    """

    REPO = "repo"
    SLACK_EXPORT = "slack_export"
    TRANSCRIPT_DIR = "transcript_dir"
    RUNBOOK_DIR = "runbook_dir"
    GOOGLE_DOCS_DIR = "gdocs_dir"


@dataclass(frozen=True)
class SourceTypeDef:
    """Immutable definition of a data source type.

    This is the first-class citizen. Every chunk carries a reference
    to its SourceTypeDef, which determines how it flows through the
    pipeline (which crawler, whether scrubbing runs, audit level).
    """

    corpus_type: str
    sensitivity: SensitivityTier
    description: str
    chunker_kind: str  # "ast", "yaml", "markdown", "thread", "sliding"
    bm25_tokenizer: str  # "code" or "nlp"


@dataclass
class CrawlSource:
    """A single source to ingest. Provided via CLI args."""

    source_kind: SourceKind
    path: Path
    repo_name: str | None = None
