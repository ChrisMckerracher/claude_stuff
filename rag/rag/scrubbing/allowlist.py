"""Allowlist for suppressing false positive PHI detections.

Code and technical text often trigger false positives in NER systems.
Terms like 'nil', 'null', 'Redis', 'Docker' get flagged as names.
This module provides filtering to suppress known false positives.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence, TypeVar


class RecognizerResultProtocol(Protocol):
    """Protocol for Presidio RecognizerResult-like objects."""

    start: int
    end: int
    entity_type: str


# TypeVar bound to the protocol for generic filter method
T = TypeVar("T", bound=RecognizerResultProtocol)


@dataclass
class Allowlist:
    """Suppress known false positives from Presidio NER.

    The allowlist contains terms that are frequently flagged as PERSON
    or other entity types but are actually code keywords, technical terms,
    or common identifiers.
    """

    # Go/Python/TypeScript/C# keywords that trigger NER
    DEFAULT_TERMS: frozenset[str] = field(
        default=frozenset({
            # Null/nil variants
            "nil", "null", "none", "undefined",
            # Boolean values
            "true", "false",
            # Common code identifiers
            "admin", "root", "localhost", "master", "main",
            "user", "test", "guest", "anonymous", "system",
            # Technical terms that look like names
            "spring", "docker", "redis", "kafka", "nginx",
            "mongo", "postgres", "mysql", "elastic", "kibana",
            "grafana", "prometheus", "jenkins", "travis", "circleci",
            # Go-specific
            "func", "chan", "defer", "goroutine", "interface",
            # Python-specific
            "self", "cls", "lambda", "yield", "async", "await",
            # HTTP/API terms
            "get", "post", "put", "patch", "delete", "head", "options",
            # Common variable names
            "foo", "bar", "baz", "qux", "tmp", "temp", "ctx", "cfg",
            # Kubernetes/cloud terms
            "pod", "node", "service", "deployment", "configmap",
            "secret", "ingress", "namespace", "cluster",
        }),
        repr=False,
    )

    extra_terms: frozenset[str] = field(default_factory=frozenset)

    @property
    def all_terms(self) -> frozenset[str]:
        """All terms in the allowlist (default + extra)."""
        return self.DEFAULT_TERMS | self.extra_terms

    def is_allowed(self, text: str) -> bool:
        """Check if text is in the allowlist (case-insensitive)."""
        return text.lower().strip() in self.all_terms

    def filter(self, results: Sequence[T], text: str) -> list[T]:
        """Remove results whose matched text is in the allowlist.

        Args:
            results: Sequence of Presidio RecognizerResult-like objects
            text: The original text that was analyzed

        Returns:
            Filtered list with allowlisted terms removed
        """
        return [
            r
            for r in results
            if not self.is_allowed(text[r.start : r.end])
        ]
