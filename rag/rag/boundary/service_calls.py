"""Service call detection using regex patterns.

Detects outbound HTTP, queue, and database calls in source code.
Each pattern returns matches with byte offsets and edge types.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ServiceCall:
    """A detected outbound service call."""

    byte_offset: int
    match_text: str
    edge_type: str  # "http", "queue", "db"
    target: str  # extracted URL or service identifier


# Regex patterns per language for detecting service calls
SERVICE_CALL_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "go": [
        (r"http\.(Get|Post|Put|Delete|Head|Patch)\s*\(", "http"),
        (r"http\.Do\s*\(", "http"),
        (r"\.NewRequest\s*\(", "http"),
        (r"\.(Publish|Subscribe)\s*\(", "queue"),
        (r"sql\.Open\s*\(", "db"),
        (r"\.(QueryRow|Query|Exec)\s*\(", "db"),
        (r"nats\.(Publish|Subscribe)\s*\(", "queue"),
        (r"amqp\.(Publish|Consume)\s*\(", "queue"),
    ],
    "c_sharp": [
        (r"HttpClient\.\w+Async\s*\(", "http"),
        (r"\.PostAsJsonAsync\s*\(", "http"),
        (r"\.GetFromJsonAsync\s*\(", "http"),
        (r"\.GetAsync\s*\(", "http"),
        (r"\.PostAsync\s*\(", "http"),
        (r"\.PutAsync\s*\(", "http"),
        (r"\.DeleteAsync\s*\(", "http"),
        (r"\.SendAsync\s*\(", "http"),
        (r"IServiceBus\.(Publish|Send)\s*\(", "queue"),
        (r"\.PublishAsync\s*\(", "queue"),
        (r"DbContext\.", "db"),
        (r"\.ExecuteSqlRaw\s*\(", "db"),
        (r"\.FromSqlRaw\s*\(", "db"),
        (r"SqlCommand", "db"),
    ],
    "python": [
        (r"requests\.(get|post|put|delete|patch|head)\s*\(", "http"),
        (r"httpx\.(get|post|put|delete|patch)\s*\(", "http"),
        (r"aiohttp\.ClientSession\(\)", "http"),
        (r"\.request\s*\(", "http"),
        (r"urllib\.request\.urlopen\s*\(", "http"),
        (r"pika\..*\.(publish|basic_publish)\s*\(", "queue"),
        (r"kombu\..*\.(publish|send)\s*\(", "queue"),
        (r"cursor\.(execute|executemany)\s*\(", "db"),
        (r"session\.(execute|query)\s*\(", "db"),
        (r"\.raw\s*\(", "db"),
    ],
    "typescript": [
        (r"fetch\s*\(", "http"),
        (r"axios\.(get|post|put|delete|patch|head)\s*\(", "http"),
        (r"axios\s*\(", "http"),
        (r"\.request\s*\(", "http"),
        (r"got\.(get|post|put|delete)\s*\(", "http"),
        (r"superagent\.(get|post|put|delete)\s*\(", "http"),
        (r"amqplib\..*\.(publish|sendToQueue)\s*\(", "queue"),
        (r"\.query\s*\(", "db"),
        (r"\.execute\s*\(", "db"),
        (r"prisma\.\w+\.(find|create|update|delete)", "db"),
    ],
}

# Patterns to extract URL-like targets from surrounding context
URL_PATTERN = re.compile(
    r"""
    (?:
        https?://[^\s"'`\)]+  |           # Full URL
        /api/[^\s"'`\)]+  |               # API path
        /v\d+/[^\s"'`\)]+  |              # Versioned path
        ["'`]([^"'`\s]+)["`']             # Quoted string that might be a path
    )
    """,
    re.VERBOSE,
)


def _extract_target(source: bytes, match_start: int, match_end: int) -> str:
    """Extract the likely target URL or service from surrounding context."""
    # Look at the following 200 chars for URL-like patterns
    context_end = min(match_end + 200, len(source))
    context = source[match_start:context_end].decode("utf-8", errors="replace")

    url_match = URL_PATTERN.search(context)
    if url_match:
        # Return the full match or the captured group
        if url_match.group(1):
            return url_match.group(1)
        return url_match.group(0)

    return "unknown"


def detect_service_calls(source: bytes, language: str) -> list[ServiceCall]:
    """Detect outbound service calls in source code.

    Args:
        source: Raw source code bytes
        language: Language name ("go", "c_sharp", "python", "typescript")

    Returns:
        List of ServiceCall objects with byte offsets and edge types
    """
    patterns = SERVICE_CALL_PATTERNS.get(language, [])
    if not patterns:
        return []

    source_text = source.decode("utf-8", errors="replace")
    calls: list[ServiceCall] = []

    for pattern, edge_type in patterns:
        for match in re.finditer(pattern, source_text):
            byte_offset = len(source_text[: match.start()].encode("utf-8"))
            match_text = match.group(0)
            target = _extract_target(source, byte_offset, byte_offset + len(match_text))

            calls.append(
                ServiceCall(
                    byte_offset=byte_offset,
                    match_text=match_text,
                    edge_type=edge_type,
                    target=target,
                )
            )

    # Sort by byte offset
    calls.sort(key=lambda c: c.byte_offset)
    return calls
