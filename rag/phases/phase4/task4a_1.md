# Task 4a.1: Base Types & Patterns

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define the base types, protocols, and pattern matchers for service call extraction.

## File

`rag/extractors/base.py`

## Implementation

```python
from dataclasses import dataclass
from typing import Protocol, Literal
import tree_sitter

class Confidence:
    """Confidence levels for extracted relationships.

    HIGH:   Exact URL match - requests.get("http://user-service/api/users")
    MEDIUM: Service name in URL - requests.get(f"{USER_SERVICE_URL}/users")
    LOW:    Inferred from variable - requests.get(service_url)
    GUESS:  Heuristic match - requests.get(url)  # comment says "user service"
    """
    HIGH = 0.9
    MEDIUM = 0.7
    LOW = 0.5
    GUESS = 0.3


@dataclass
class ServiceCall:
    """Detected inter-service communication."""
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float  # Use Confidence.HIGH/MEDIUM/LOW/GUESS

    # HTTP-specific fields (None for non-HTTP calls)
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] | None = None
    url_path: str | None = None  # /api/users/{id}
    target_host: str | None = None  # For resolving service name from URL


class PatternMatcher(Protocol):
    """Matches specific call patterns in AST nodes."""

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        """Match pattern against AST node.

        Args:
            node: tree-sitter Node (usually a call expression)
            source: Full source file bytes (for extracting text)

        Returns:
            List of ServiceCall objects. Empty if no match.
        """
        ...


class LanguageExtractor(Protocol):
    """Extracts service calls from source code in a specific language."""

    language: str

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from source code.

        Args:
            source: Source code as bytes

        Returns:
            List of all detected service calls
        """
        ...

    def get_patterns(self) -> list[PatternMatcher]:
        """Get list of pattern matchers used by this extractor."""
        ...
```

## Pattern Helpers

```python
# rag/extractors/patterns.py

import re
from dataclasses import dataclass

# Regex patterns for URL parsing
URL_REGEX = re.compile(r'https?://([^/:]+)')
PATH_REGEX = re.compile(r'https?://[^/]+(/[^"\')\s]*)')

# Service name suffixes to look for
SERVICE_SUFFIXES = ['-service', '-api', '-svc', '_service', '_api']


def extract_service_from_url(url: str) -> tuple[str | None, str | None]:
    """Extract service name and path from URL.

    Args:
        url: URL string like "http://user-service/api/users"

    Returns:
        Tuple of (service_name, path) or (None, None) if not parseable
    """
    host_match = URL_REGEX.search(url)
    if not host_match:
        return None, None

    host = host_match.group(1)

    # Skip localhost/127.0.0.1
    if host in ('localhost', '127.0.0.1', '0.0.0.0'):
        return None, None

    path_match = PATH_REGEX.search(url)
    path = path_match.group(1) if path_match else None

    return host, path


def determine_confidence(url_str: str, node_type: str) -> float:
    """Determine confidence level based on URL structure.

    Args:
        url_str: The URL string (may contain variables)
        node_type: AST node type (string, f-string, identifier)

    Returns:
        Confidence level (HIGH, MEDIUM, LOW)
    """
    if node_type == "string" and url_str.startswith(('http://', 'https://')):
        return Confidence.HIGH
    elif node_type in ("formatted_string", "template_string"):
        return Confidence.MEDIUM
    else:
        return Confidence.LOW


def is_in_comment_or_docstring(node: "tree_sitter.Node", source: bytes) -> bool:
    """Check if node is inside a comment or docstring.

    IMPORTANT: Must skip URLs in comments/docstrings to avoid false positives.
    """
    parent = node.parent
    while parent:
        if parent.type in ('comment', 'string', 'expression_statement'):
            # Check if this is a docstring (string as first statement in function/class)
            if parent.type == 'expression_statement':
                grandparent = parent.parent
                if grandparent and grandparent.type in ('function_definition', 'class_definition'):
                    first_child = grandparent.child_by_field_name('body')
                    if first_child and first_child.children and first_child.children[0] == parent:
                        return True
        parent = parent.parent
    return False
```

## Acceptance Criteria

- [ ] Confidence class defines HIGH, MEDIUM, LOW, GUESS levels
- [ ] ServiceCall dataclass has all required fields
- [ ] PatternMatcher protocol defined
- [ ] LanguageExtractor protocol defined
- [ ] URL parsing helpers work correctly
- [ ] Comment/docstring detection works

## Dependencies

- tree-sitter package
- Phase 0 types

## Estimated Time

30 minutes
