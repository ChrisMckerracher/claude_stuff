"""ScrubGate: routes chunks through PHI scrubbing based on sensitivity tier.

CLEAN          -> pass through (zero-cost CleanChunk conversion)
SENSITIVE      -> full scrub + audit log
MAYBE_SENSITIVE -> full scrub + audit log
"""

from __future__ import annotations

import logging

from rag.models.chunk import CleanChunk, RawChunk
from rag.models.types import SensitivityTier
from rag.pipeline.protocols import Scrubber

logger = logging.getLogger(__name__)


class ScrubGate:
    """Routes chunks through PHI scrubbing based on sensitivity tier."""

    def __init__(self, scrubber: Scrubber) -> None:
        self._scrubber = scrubber

    def process(self, chunk: RawChunk) -> CleanChunk:
        """Route a RawChunk based on its sensitivity tier."""
        tier = chunk.source_type.sensitivity

        if tier == SensitivityTier.CLEAN:
            return self._promote_clean(chunk)

        clean = self._scrubber.scrub(chunk)

        if tier == SensitivityTier.SENSITIVE:
            logger.warning(
                "scrubbed_sensitive_chunk chunk_id=%s entities=%d",
                clean.id,
                clean.audit.entities_found if clean.audit else 0,
            )
        else:  # MAYBE_SENSITIVE
            logger.info(
                "scrubbed_maybe_sensitive_chunk chunk_id=%s entities=%d",
                clean.id,
                clean.audit.entities_found if clean.audit else 0,
            )

        return clean

    @staticmethod
    def _promote_clean(raw: RawChunk) -> CleanChunk:
        """Convert RawChunk to CleanChunk without modification.

        Only valid for CLEAN tier -- enforced by the caller.
        """
        return CleanChunk(
            id=raw.id,
            source_uri=raw.source_uri,
            byte_range=raw.byte_range,
            source_type=raw.source_type,
            text=raw.text,
            context_prefix=raw.context_prefix,
            repo_name=raw.repo_name,
            audit=None,
            language=raw.language,
            symbol_name=raw.symbol_name,
            symbol_kind=raw.symbol_kind,
            signature=raw.signature,
            file_path=raw.file_path,
            git_hash=raw.git_hash,
            section_path=raw.section_path,
            author=raw.author,
            timestamp=raw.timestamp,
            channel=raw.channel,
            thread_id=raw.thread_id,
            imports=list(raw.imports),
            calls_out=list(raw.calls_out),
            called_by=list(raw.called_by),
            service_name=raw.service_name,
            k8s_labels=dict(raw.k8s_labels) if raw.k8s_labels else None,
        )
