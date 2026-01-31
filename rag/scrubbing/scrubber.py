"""PHI scrubbing using Presidio with pluggable NLP backend.

See docs/NLP_BACKENDS.md for backend configuration options.
"""

from __future__ import annotations

from presidio_analyzer import AnalyzerEngine

from rag.core.protocols import ScrubResult
from rag.core.types import CleanChunk, RawChunk, ScrubAction
from rag.scrubbing.nlp_backend import create_analyzer, get_supported_entities
from rag.scrubbing.pseudonymizer import Pseudonymizer


class PresidioScrubber:
    """PHI scrubbing using Presidio.

    Detects PII entities and replaces them with consistent
    pseudonyms to preserve referential integrity.

    By default uses regex-only detection (no model downloads).
    Pass a custom analyzer for NER-based detection (PERSON, LOCATION).

    Example:
        # Default: regex-only (EMAIL, PHONE, SSN)
        scrubber = PresidioScrubber(Pseudonymizer())

        # With spaCy NER (adds PERSON, LOCATION detection)
        from rag.scrubbing.nlp_backend import create_analyzer
        analyzer = create_analyzer(backend="spacy")
        scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
    """

    def __init__(
        self,
        pseudonymizer: Pseudonymizer,
        analyzer: AnalyzerEngine | None = None,
    ):
        """Initialize scrubber.

        Args:
            pseudonymizer: Pseudonymizer for consistent replacement.
            analyzer: Presidio AnalyzerEngine. If None, creates regex-only analyzer.
        """
        self._analyzer = analyzer or create_analyzer()
        self._pseudonymizer = pseudonymizer
        self._supported_entities = get_supported_entities(
            "spacy" if analyzer else "regex"
        )

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Args:
            chunk: Raw chunk potentially containing PHI.

        Returns:
            CleanChunk with PHI replaced and audit log.

        Raises:
            ScrubError: If scrubbing fails.
        """
        # Analyze for PII
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=self._supported_entities,
            language="en",
        )

        if not results:
            # No PII found, return as-is
            return CleanChunk(
                id=chunk.id,
                text=chunk.text,
                source_uri=chunk.source_uri,
                corpus_type=chunk.corpus_type,
                context_prefix=chunk.metadata.get("context_prefix", ""),
                metadata=chunk.metadata,
                scrub_log=[],
            )

        # Sort results by start position (descending) for safe replacement
        sorted_results = sorted(results, key=lambda r: r.start, reverse=True)

        scrub_log: list[ScrubAction] = []
        text = chunk.text

        # Replace from end to start to preserve positions
        for result in sorted_results:
            original = text[result.start : result.end]
            replacement = self._pseudonymizer.get_replacement(
                original, result.entity_type
            )
            text = text[: result.start] + replacement + text[result.end :]
            scrub_log.append(
                ScrubAction(
                    entity_type=result.entity_type,
                    start=result.start,
                    end=result.end,
                    replacement=replacement,
                )
            )

        # Reverse log to match original order
        scrub_log.reverse()

        return CleanChunk(
            id=chunk.id,
            text=text,
            source_uri=chunk.source_uri,
            corpus_type=chunk.corpus_type,
            context_prefix=chunk.metadata.get("context_prefix", ""),
            metadata=chunk.metadata,
            scrub_log=scrub_log,
        )

    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing for efficiency.

        Args:
            chunks: List of raw chunks.

        Returns:
            List of ScrubResult in same order as input.
        """
        results = []
        for chunk in chunks:
            try:
                clean = self.scrub(chunk)
                results.append(
                    ScrubResult(
                        chunk_id=chunk.id,
                        clean_chunk=clean,
                        error=None,
                    )
                )
            except Exception as e:
                results.append(
                    ScrubResult(
                        chunk_id=chunk.id,
                        clean_chunk=None,
                        error=str(e),
                    )
                )
        return results
