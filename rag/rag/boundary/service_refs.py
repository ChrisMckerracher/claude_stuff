"""Service reference extraction from freeform text.

Finds mentions of known services in conversations and documentation.
"""

from __future__ import annotations

import re


# URL pattern to extract service names from URLs
URL_PATTERN = re.compile(
    r"https?://([a-zA-Z0-9][-a-zA-Z0-9]*[a-zA-Z0-9]?)(?::\d+)?(?:/|$)"
)


def extract_service_refs(text: str, known_services: set[str]) -> list[str]:
    """Find mentions of known services in freeform text.

    Matches:
    - Exact service names (case-insensitive)
    - URL patterns: http://service-name:port/...
    - Hyphenated references: "the auth-service is down"

    Does NOT match:
    - Substrings (e.g., "service" alone doesn't match "auth-service")
    - Service names embedded in longer words

    Args:
        text: Text to search for service references
        known_services: Set of known service names to look for

    Returns:
        List of matched service names (in their canonical form from known_services)
    """
    if not known_services:
        return []

    found: set[str] = set()
    text_lower = text.lower()

    # Check for URL patterns first
    url_matches = URL_PATTERN.findall(text)
    for service_name in url_matches:
        service_lower = service_name.lower()
        # Find the canonical name from known_services
        for known in known_services:
            if known.lower() == service_lower:
                found.add(known)
                break

    # Build word boundary patterns for each known service
    for service in known_services:
        service_lower = service.lower()

        # Use word boundaries to avoid substring matches
        # Service names often have hyphens, so we need to be careful
        # about what constitutes a word boundary

        # Pattern matches the service name surrounded by non-word chars
        # or start/end of string
        pattern = re.compile(
            r"(?:^|[^a-zA-Z0-9-])" + re.escape(service_lower) + r"(?:[^a-zA-Z0-9-]|$)",
            re.IGNORECASE,
        )

        if pattern.search(text):
            found.add(service)

    return sorted(found)


def extract_urls(text: str) -> list[str]:
    """Extract all URLs from text.

    Args:
        text: Text to search for URLs

    Returns:
        List of found URLs
    """
    url_pattern = re.compile(
        r"https?://[a-zA-Z0-9][-a-zA-Z0-9.]*(?::\d+)?(?:/[^\s]*)?"
    )
    return url_pattern.findall(text)


def extract_service_names_from_urls(urls: list[str]) -> list[str]:
    """Extract service names from a list of URLs.

    Args:
        urls: List of URLs

    Returns:
        List of extracted service names
    """
    services: set[str] = set()

    for url in urls:
        matches = URL_PATTERN.findall(url)
        services.update(matches)

    return sorted(services)
