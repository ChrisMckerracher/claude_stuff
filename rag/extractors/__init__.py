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
from rag.extractors.languages.python import (
    PythonExtractor,
    PythonGrpcPattern,
    PythonQueuePattern,
)
from rag.extractors.languages.go import GoExtractor
from rag.extractors.languages.typescript import TypeScriptExtractor
from rag.extractors.languages.csharp import CSharpExtractor
from rag.extractors.patterns import (
    determine_confidence,
    extract_service_from_url,
    is_in_comment_or_docstring,
)
from rag.extractors.registry import (
    InMemoryRegistry,
    RouteDefinition,
    RouteRegistry,
    SQLiteRegistry,
)
from rag.extractors.linker import (
    CallLinker,
    LinkResult,
    ServiceRelation,
)
from rag.extractors.routes import (
    FastAPIRouteExtractor,
    FlaskRouteExtractor,
    ExpressRouteExtractor,
    GinRouteExtractor,
    AspNetRouteExtractor,
)

__all__ = [
    "Confidence",
    "ServiceCall",
    "PatternMatcher",
    "LanguageExtractor",
    # Language extractors
    "PythonExtractor",
    "GoExtractor",
    "TypeScriptExtractor",
    "CSharpExtractor",
    # Python patterns (4a.3)
    "PythonGrpcPattern",
    "PythonQueuePattern",
    # Route extractors (4d, 4f)
    "FastAPIRouteExtractor",
    "FlaskRouteExtractor",
    "ExpressRouteExtractor",
    "GinRouteExtractor",
    "AspNetRouteExtractor",
    # Pattern utilities
    "extract_service_from_url",
    "determine_confidence",
    "is_in_comment_or_docstring",
    # Registry
    "RouteDefinition",
    "RouteRegistry",
    "InMemoryRegistry",
    "SQLiteRegistry",
    # Linker
    "CallLinker",
    "LinkResult",
    "ServiceRelation",
]
