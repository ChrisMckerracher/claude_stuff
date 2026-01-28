"""PresidioScrubber: Main PHI/PII scrubbing implementation.

Satisfies the Scrubber protocol. Detects PHI/PII entities using
Microsoft Presidio NER + custom recognizers, then replaces them
with consistent pseudonyms.
"""

from __future__ import annotations

import logging

from typing import Sequence

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry

from rag.models.audit import ScrubAuditEntry
from rag.models.chunk import CleanChunk, RawChunk
from rag.scrubbing.allowlist import Allowlist, RecognizerResultProtocol
from rag.scrubbing.pseudonymizer import ConsistentPseudonymizer
from rag.scrubbing.recognizers import get_all_custom_recognizers
from rag.scrubbing.secrets import SecretFinding, detect_secrets_in_text


logger = logging.getLogger(__name__)

# Entity types we detect (HIPAA Safe Harbor coverage)
DEFAULT_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "US_SSN",
    "CREDIT_CARD",
    "IP_ADDRESS",
    "MEDICAL_LICENSE",
    "US_DRIVER_LICENSE",
    "LOCATION",
    "DATE_TIME",
    "NRP",  # Nationality, religious, political group
]


class PresidioScrubber:
    """PHI/PII scrubber using Microsoft Presidio.

    Satisfies the Scrubber protocol:
        def scrub(self, chunk: RawChunk) -> CleanChunk

    Detection pipeline:
    1. Secret Scanner (detect-secrets): API keys, tokens, connection strings
    2. Presidio Analyzer: Regex + spaCy NER for PHI
    3. Allowlist Filter: Suppress known false positives
    4. Apply replacements with consistent pseudonyms
    """

    def __init__(
        self,
        seed: int = 42,
        score_threshold: float = 0.35,
        allowlist: Allowlist | None = None,
        entities: list[str] | None = None,
    ) -> None:
        """Initialize the scrubber.

        Args:
            seed: Random seed for consistent pseudonymization
            score_threshold: Minimum confidence score for entity detection
            allowlist: Custom allowlist for false positive suppression
            entities: Entity types to detect (defaults to HIPAA Safe Harbor set)
        """
        # Set up Presidio with custom recognizers
        self._registry = RecognizerRegistry()
        self._registry.load_predefined_recognizers()

        # Add custom recognizers
        for recognizer in get_all_custom_recognizers():
            self._registry.add_recognizer(recognizer)

        self._analyzer = AnalyzerEngine(registry=self._registry)
        self._pseudonymizer = ConsistentPseudonymizer(seed=seed)
        self._allowlist = allowlist or Allowlist()
        self._threshold = score_threshold
        self._entities = entities or DEFAULT_ENTITIES

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Analyze text, replace PHI entities, return CleanChunk with audit trail.

        Args:
            chunk: RawChunk that may contain PHI

        Returns:
            CleanChunk with PHI replaced and audit trail populated
        """
        # 1. Detect secrets (API keys, tokens, etc.)
        secret_findings = detect_secrets_in_text(chunk.text)

        # 2. Detect PHI entities via Presidio
        phi_results = self._analyzer.analyze(
            text=chunk.text,
            language="en",
            score_threshold=self._threshold,
            entities=self._entities,
        )

        # 3. Filter allowlist (suppress false positives)
        filtered_results = self._allowlist.filter(phi_results, chunk.text)

        # 4. Apply replacements
        scrubbed_text = self._apply_replacements(
            chunk.text, filtered_results, secret_findings
        )

        # 5. Build audit entry
        entity_types = list({r.entity_type for r in filtered_results})
        audit = ScrubAuditEntry(
            chunk_id=chunk.id,
            tier=chunk.source_type.sensitivity,
            entities_found=len(filtered_results),
            entity_types=entity_types,
            secrets_found=len(secret_findings),
            scrubbed=bool(filtered_results or secret_findings),
        )

        # 6. Return CleanChunk with all metadata preserved
        return CleanChunk(
            id=chunk.id,
            source_uri=chunk.source_uri,
            byte_range=chunk.byte_range,
            source_type=chunk.source_type,
            text=scrubbed_text,
            context_prefix=chunk.context_prefix,
            repo_name=chunk.repo_name,
            audit=audit,
            language=chunk.language,
            symbol_name=chunk.symbol_name,
            symbol_kind=chunk.symbol_kind,
            signature=chunk.signature,
            file_path=chunk.file_path,
            git_hash=chunk.git_hash,
            section_path=chunk.section_path,
            author=chunk.author,
            timestamp=chunk.timestamp,
            channel=chunk.channel,
            thread_id=chunk.thread_id,
            imports=list(chunk.imports),
            calls_out=list(chunk.calls_out),
            called_by=list(chunk.called_by),
            service_name=chunk.service_name,
            k8s_labels=dict(chunk.k8s_labels) if chunk.k8s_labels else None,
        )

    def _apply_replacements(
        self,
        text: str,
        phi_results: Sequence[RecognizerResultProtocol],
        secret_findings: Sequence[SecretFinding],
    ) -> str:
        """Apply PHI and secret replacements to text.

        Processes replacements from end to start to preserve positions.

        Args:
            text: Original text
            phi_results: Presidio recognition results
            secret_findings: Detected secrets

        Returns:
            Text with all PHI and secrets replaced
        """
        if not phi_results and not secret_findings:
            return text

        # Build a list of all replacements (start, end, replacement_text)
        replacements: list[tuple[int, int, str]] = []

        # Add PHI replacements with consistent pseudonyms
        for phi_result in phi_results:
            original = text[phi_result.start : phi_result.end]
            replacement = self._pseudonymizer.pseudonymize(
                original, phi_result.entity_type
            )
            replacements.append((phi_result.start, phi_result.end, replacement))

        # Add secret replacements
        for finding in secret_findings:
            replacement = f"[REDACTED_{finding.secret_type.upper().replace(' ', '_')}]"
            replacements.append((finding.start, finding.end, replacement))

        # Sort by start position (descending) to process from end to start
        replacements.sort(key=lambda x: x[0], reverse=True)

        # Apply replacements
        result = text
        for start, end, replacement in replacements:
            result = result[:start] + replacement + result[end:]

        return result

    def analyze(self, text: str) -> list[RecognizerResultProtocol]:
        """Run PHI detection without applying replacements.

        Useful for testing and inspection.

        Args:
            text: Text to analyze

        Returns:
            List of Presidio RecognizerResult objects (after allowlist filtering)
        """
        results = self._analyzer.analyze(
            text=text,
            language="en",
            score_threshold=self._threshold,
            entities=self._entities,
        )
        return self._allowlist.filter(results, text)

    @property
    def pseudonymizer(self) -> ConsistentPseudonymizer:
        """Access the pseudonymizer for inspection."""
        return self._pseudonymizer

    @property
    def allowlist(self) -> Allowlist:
        """Access the allowlist for inspection."""
        return self._allowlist
