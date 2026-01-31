"""Pattern helpers for service call extraction.

URL parsing, confidence determination, and comment detection utilities.
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from rag.extractors.base import Confidence

if TYPE_CHECKING:
    import tree_sitter

# Regex patterns for URL parsing
URL_REGEX = re.compile(r"https?://([^/:]+)")
PATH_REGEX = re.compile(r"https?://[^/]+(/[^\"')\s]*)")

# Service name suffixes to look for
SERVICE_SUFFIXES = ["-service", "-api", "-svc", "_service", "_api"]


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
    if host in ("localhost", "127.0.0.1", "0.0.0.0"):
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
    if node_type == "string" and url_str.startswith(("http://", "https://")):
        return Confidence.HIGH
    elif node_type in ("formatted_string", "template_string"):
        return Confidence.MEDIUM
    else:
        return Confidence.LOW


def is_in_comment_or_docstring(
    node: "tree_sitter.Node", source: bytes
) -> bool:
    """Check if node is inside a comment or docstring.

    IMPORTANT: Must skip URLs in comments/docstrings to avoid false positives.

    Args:
        node: tree-sitter Node to check
        source: Full source code bytes

    Returns:
        True if node is inside a comment or docstring
    """
    parent = node.parent
    while parent:
        # Check for comment nodes
        if parent.type == "comment":
            return True

        # Check for docstring (string as first statement in function/class body)
        if parent.type == "expression_statement":
            grandparent = parent.parent
            if grandparent and grandparent.type == "block":
                # Check if this is the first statement in the block
                great_grandparent = grandparent.parent
                if great_grandparent and great_grandparent.type in (
                    "function_definition",
                    "class_definition",
                ):
                    # Get first child of block
                    for child in grandparent.children:
                        if child.type == "expression_statement":
                            if child == parent:
                                # This expression_statement is the first in block
                                # Check if it's a string (docstring)
                                for expr_child in parent.children:
                                    if expr_child.type == "string":
                                        return True
                            break

        parent = parent.parent

    return False
