"""Service extraction and call linking.

Phase 4 implementation: Multi-language service call extraction,
route registry, and call-to-handler linking.
"""

from rag.extractors.base import (
    Confidence,
    LanguageExtractor,
    PatternMatcher,
    ServiceCall,
)
from rag.extractors.languages.python import PythonExtractor
from rag.extractors.patterns import (
    determine_confidence,
    extract_service_from_url,
    is_in_comment_or_docstring,
)
from rag.extractors.registry import (
    InMemoryRegistry,
    RouteDefinition,
    RouteRegistry,
)
from rag.extractors.linker import (
    CallLinker,
    LinkResult,
    ServiceRelation,
)

__all__ = [
    "Confidence",
    "ServiceCall",
    "PatternMatcher",
    "LanguageExtractor",
    "PythonExtractor",
    "extract_service_from_url",
    "determine_confidence",
    "is_in_comment_or_docstring",
    "RouteDefinition",
    "RouteRegistry",
    "InMemoryRegistry",
    "CallLinker",
    "LinkResult",
    "ServiceRelation",
]
