"""Base types and protocols for service extraction.

Defines ServiceCall, PatternMatcher, and LanguageExtractor protocols.
"""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Protocol

if TYPE_CHECKING:
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

    def match(
        self, node: "tree_sitter.Node", source: bytes
    ) -> list[ServiceCall]:
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
