"""Scrub audit trail types."""

from __future__ import annotations

from dataclasses import dataclass

from rag.models.types import SensitivityTier


@dataclass
class ScrubAuditEntry:
    """Record of what PHI scrubbing found and replaced."""

    chunk_id: str
    tier: SensitivityTier
    entities_found: int
    entity_types: list[str]
    secrets_found: int
    scrubbed: bool
