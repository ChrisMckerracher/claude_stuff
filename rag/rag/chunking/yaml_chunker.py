"""YAML chunker for Kubernetes manifests and deployment files.

Splits YAML files on document separators (---) and extracts
K8s metadata and service references from env vars.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import yaml


# URL pattern to extract service references from env vars
SERVICE_URL_PATTERN = re.compile(
    r"https?://([a-zA-Z0-9][-a-zA-Z0-9]*[a-zA-Z0-9]?)(?::\d+)?(?:/|$)"
)


@dataclass
class YamlChunkData:
    """Intermediate output of the YAML chunker.

    The DeployCrawler wraps this into a RawChunk.
    """

    text: str
    byte_start: int
    byte_end: int
    context_prefix: str
    symbol_name: str | None
    symbol_kind: str | None
    service_name: str | None
    k8s_labels: dict[str, str]
    calls_out: list[str] = field(default_factory=list)


def _extract_k8s_metadata(doc: dict[str, Any]) -> dict[str, Any]:
    """Extract Kubernetes metadata from a parsed YAML document.

    Args:
        doc: Parsed YAML document

    Returns:
        Dictionary with symbol_name, symbol_kind, service_name, k8s_labels
    """
    kind = doc.get("kind", "")
    metadata = doc.get("metadata", {})

    labels = metadata.get("labels", {})
    if not isinstance(labels, dict):
        labels = {}

    return {
        "symbol_name": metadata.get("name"),
        "symbol_kind": kind.lower() if kind else None,
        "service_name": labels.get("app"),
        "k8s_labels": labels,
    }


def _extract_env_service_refs(doc: dict[str, Any]) -> list[str]:
    """Extract service references from env var values.

    Looks for URL patterns like http://service-name:8080 in env vars
    throughout the YAML document.

    Args:
        doc: Parsed YAML document

    Returns:
        List of service names referenced in env vars
    """
    services: set[str] = set()

    def walk_dict(d: dict[str, Any]) -> None:
        for key, value in d.items():
            if key == "env" and isinstance(value, list):
                for env_item in value:
                    if isinstance(env_item, dict):
                        env_value = env_item.get("value", "")
                        if isinstance(env_value, str):
                            matches = SERVICE_URL_PATTERN.findall(env_value)
                            services.update(matches)
            elif isinstance(value, dict):
                walk_dict(value)
            elif isinstance(value, list):
                walk_list(value)

    def walk_list(lst: list[Any]) -> None:
        for item in lst:
            if isinstance(item, dict):
                walk_dict(item)
            elif isinstance(item, list):
                walk_list(item)

    if isinstance(doc, dict):
        walk_dict(doc)

    return list(services)


def _extract_service_backend_refs(doc: dict[str, Any]) -> list[str]:
    """Extract backend service references from Ingress resources.

    Args:
        doc: Parsed YAML document

    Returns:
        List of backend service names
    """
    if doc.get("kind") != "Ingress":
        return []

    services: set[str] = set()
    spec = doc.get("spec", {})

    # Default backend
    default_backend = spec.get("defaultBackend", {})
    service = default_backend.get("service", {})
    if service.get("name"):
        services.add(service["name"])

    # Rules
    rules = spec.get("rules", [])
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        http = rule.get("http", {})
        paths = http.get("paths", [])
        for path in paths:
            if not isinstance(path, dict):
                continue
            backend = path.get("backend", {})
            service = backend.get("service", {})
            if service.get("name"):
                services.add(service["name"])
            # Legacy format
            if backend.get("serviceName"):
                services.add(backend["serviceName"])

    return list(services)


def yaml_chunk(content: bytes, file_path: str) -> list[YamlChunkData]:
    """Parse YAML content and return document-based chunks.

    Splits on --- document separators. Each YAML document becomes
    one chunk with K8s metadata extracted.

    Args:
        content: Raw YAML content bytes
        file_path: Path to file for context prefix

    Returns:
        List of YamlChunkData with text, byte ranges, and metadata
    """
    text = content.decode("utf-8")

    # Split on document separators while tracking byte positions
    chunks: list[YamlChunkData] = []

    # Find document boundaries by searching for --- at line start
    # We need to track byte positions carefully
    doc_starts: list[int] = [0]
    lines = text.split("\n")
    byte_pos = 0

    for i, line in enumerate(lines):
        if line.strip() == "---" and i > 0:
            # Found a document separator
            # The next document starts after this line
            next_start = byte_pos + len(line) + 1  # +1 for newline
            if next_start < len(content):
                doc_starts.append(next_start)
        byte_pos += len(line.encode("utf-8")) + 1  # +1 for newline

    # Process each document
    for i, start in enumerate(doc_starts):
        if i + 1 < len(doc_starts):
            end = doc_starts[i + 1]
            # Find the --- line and exclude it from this doc
            doc_text = text[start:end].rstrip()
            if doc_text.endswith("---"):
                doc_text = doc_text[:-3].rstrip()
        else:
            end = len(content)
            doc_text = text[start:end]

        # Skip empty documents or documents that are only separators
        doc_text_stripped = doc_text.strip()
        if not doc_text_stripped:
            continue
        # Check if content is only separators (e.g., "---" or "---\n---")
        only_separators = all(
            line.strip() in ("", "---") for line in doc_text_stripped.split("\n")
        )
        if only_separators:
            continue

        # Parse the YAML document
        try:
            parsed = yaml.safe_load(doc_text)
            if not isinstance(parsed, dict):
                # Not a dict - store as generic chunk
                parsed = {}
        except yaml.YAMLError:
            # Invalid YAML - store raw text but skip metadata extraction
            parsed = {}

        # Extract metadata
        k8s_meta = _extract_k8s_metadata(parsed)
        env_refs = _extract_env_service_refs(parsed)
        ingress_refs = _extract_service_backend_refs(parsed)

        # Combine calls_out from env vars and ingress backends
        calls_out = list(set(env_refs + ingress_refs))

        # Build context prefix
        kind = k8s_meta["symbol_kind"] or "document"
        name = k8s_meta["symbol_name"] or f"doc{i}"
        context_prefix = f"{file_path} > {kind}/{name}"

        # Calculate actual byte positions
        byte_start = len(text[:start].encode("utf-8"))
        byte_end = byte_start + len(doc_text.encode("utf-8"))

        chunks.append(
            YamlChunkData(
                text=doc_text,
                byte_start=byte_start,
                byte_end=byte_end,
                context_prefix=context_prefix,
                symbol_name=k8s_meta["symbol_name"],
                symbol_kind=k8s_meta["symbol_kind"],
                service_name=k8s_meta["service_name"],
                k8s_labels=k8s_meta["k8s_labels"],
                calls_out=calls_out,
            )
        )

    return chunks
