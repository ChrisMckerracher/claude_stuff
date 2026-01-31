"""Route extraction from web framework decorators/handlers.

Extracts RouteDefinition objects from:
- Python: FastAPI, Flask
- TypeScript/JavaScript: Express
- Go: Gin
- C#: ASP.NET Core
"""

from rag.extractors.routes.python_routes import (
    FastAPIRouteExtractor,
    FlaskRouteExtractor,
)
from rag.extractors.routes.typescript_routes import ExpressRouteExtractor
from rag.extractors.routes.go_routes import GinRouteExtractor
from rag.extractors.routes.csharp_routes import AspNetRouteExtractor

__all__ = [
    "FastAPIRouteExtractor",
    "FlaskRouteExtractor",
    "ExpressRouteExtractor",
    "GinRouteExtractor",
    "AspNetRouteExtractor",
]
