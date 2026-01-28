"""Service name resolution for building the service graph.

Resolves raw hostnames, URLs, and partial names to known service names
discovered from deployment chunks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING
from urllib.parse import urlparse

if TYPE_CHECKING:
    from rag.boundary.graph import ServiceNode


@dataclass
class ResolveResult:
    """Result of a service name resolution attempt."""

    original: str
    resolved: str | None
    confidence: float  # 0.0 to 1.0


class ServiceNameResolver:
    """Resolves raw service references to canonical service names.

    Handles:
    - Exact matches: "auth-service" -> "auth-service"
    - URL stripping: "http://auth-service:8080/api/v1" -> "auth-service"
    - Partial matches: "auth-svc" -> "auth-service" (fuzzy)
    - K8s DNS patterns: "auth-service.default.svc.cluster.local" -> "auth-service"
    """

    # Common K8s DNS suffixes to strip
    K8S_SUFFIXES = [
        ".svc.cluster.local",
        ".cluster.local",
        ".svc",
    ]

    def __init__(self, min_similarity: float = 0.6) -> None:
        """Initialize the resolver.

        Args:
            min_similarity: Minimum similarity score (0-1) for partial matches.
        """
        self._min_similarity = min_similarity

    def resolve(
        self,
        raw_target: str,
        known_services: dict[str, ServiceNode],
    ) -> str | None:
        """Resolve a raw service reference to a known service name.

        Args:
            raw_target: Raw hostname, URL, or service reference.
            known_services: Dictionary of known service names to ServiceNode.

        Returns:
            The resolved service name, or None if no match found.
        """
        if not raw_target or not known_services:
            return None

        # Normalize the raw target
        normalized = self._normalize(raw_target)
        if not normalized:
            return None

        # Exact match
        if normalized in known_services:
            return normalized

        # Partial/fuzzy match
        best_match: str | None = None
        best_score = 0.0

        for service_name in known_services:
            score = self._similarity(normalized, service_name)
            if score > best_score and score >= self._min_similarity:
                best_score = score
                best_match = service_name

        return best_match

    def resolve_with_confidence(
        self,
        raw_target: str,
        known_services: dict[str, ServiceNode],
    ) -> ResolveResult:
        """Resolve with confidence score for debugging/auditing.

        Args:
            raw_target: Raw hostname, URL, or service reference.
            known_services: Dictionary of known service names.

        Returns:
            ResolveResult with original, resolved name, and confidence.
        """
        if not raw_target or not known_services:
            return ResolveResult(original=raw_target, resolved=None, confidence=0.0)

        normalized = self._normalize(raw_target)
        if not normalized:
            return ResolveResult(original=raw_target, resolved=None, confidence=0.0)

        # Exact match
        if normalized in known_services:
            return ResolveResult(
                original=raw_target,
                resolved=normalized,
                confidence=1.0,
            )

        # Partial/fuzzy match
        best_match: str | None = None
        best_score = 0.0

        for service_name in known_services:
            score = self._similarity(normalized, service_name)
            if score > best_score and score >= self._min_similarity:
                best_score = score
                best_match = service_name

        return ResolveResult(
            original=raw_target,
            resolved=best_match,
            confidence=best_score if best_match else 0.0,
        )

    def _normalize(self, raw: str) -> str:
        """Normalize a raw service reference.

        Strips protocol, port, path, and K8s DNS suffixes.

        Args:
            raw: Raw string to normalize.

        Returns:
            Normalized service name.
        """
        # Handle URLs
        if "://" in raw:
            parsed = urlparse(raw)
            host = parsed.hostname or ""
        else:
            # Might be just hostname:port or hostname/path
            # Strip port
            host = raw.split(":")[0]
            # Strip path
            host = host.split("/")[0]

        # Strip K8s DNS suffixes
        for suffix in self.K8S_SUFFIXES:
            if host.endswith(suffix):
                host = host[: -len(suffix)]
                break

        # Strip namespace prefix if present (e.g., "namespace.service" -> "service")
        # But keep service names with hyphens intact
        parts = host.split(".")
        if len(parts) > 1:
            # Take the first part as the service name
            # (e.g., "auth-service.default" -> "auth-service")
            host = parts[0]

        return host.lower().strip()

    def _similarity(self, a: str, b: str) -> float:
        """Calculate similarity between two service names.

        Uses a combination of:
        - Substring matching
        - Common prefix/suffix
        - Abbreviation detection (e.g., "auth-svc" vs "auth-service")

        Args:
            a: First service name.
            b: Second service name.

        Returns:
            Similarity score between 0.0 and 1.0.
        """
        if a == b:
            return 1.0

        if not a or not b:
            return 0.0

        # Normalize for comparison
        a_lower = a.lower()
        b_lower = b.lower()

        # Prefix match (one starts with the other) - higher score
        if b_lower.startswith(a_lower) or a_lower.startswith(b_lower):
            shorter = min(len(a), len(b))
            longer = max(len(a), len(b))
            # Give prefix matches a boost: min 0.6 for any prefix match
            return max(0.6, shorter / longer)

        # Substring match (one contains the other)
        if a_lower in b_lower or b_lower in a_lower:
            shorter = min(len(a), len(b))
            longer = max(len(a), len(b))
            return shorter / longer

        # Check for abbreviation patterns
        # e.g., "auth-svc" vs "auth-service"
        a_parts = set(re.split(r"[-_]", a_lower))
        b_parts = set(re.split(r"[-_]", b_lower))

        if a_parts and b_parts:
            # Check if one set's parts are abbreviations of the other
            common = a_parts & b_parts
            if common:
                total = len(a_parts | b_parts)
                return len(common) / total

            # Check prefix matching for abbreviations
            for ap in a_parts:
                for bp in b_parts:
                    if len(ap) >= 3 and len(bp) >= 3:
                        # Check if one is a prefix of the other
                        if ap.startswith(bp[:3]) or bp.startswith(ap[:3]):
                            return 0.5

        return 0.0
