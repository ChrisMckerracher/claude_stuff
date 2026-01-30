# Task 4c.1: Registry Protocol & InMemory Implementation

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define the RouteRegistry protocol and provide an in-memory implementation for testing.

## File

`rag/extractors/registry.py`

## Implementation

```python
from typing import Protocol, Literal
from dataclasses import dataclass
import re

@dataclass
class RouteDefinition:
    """A route defined in a service."""
    service: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"]
    path: str                    # /api/users/{user_id}
    handler_file: str            # src/controllers/user_controller.py
    handler_function: str        # get_user
    line_number: int


class RouteRegistry(Protocol):
    """Protocol for storing and querying route definitions.

    Implementations can be in-memory (testing) or persistent (SQLite).
    """

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        """Store routes for a service. Replaces existing routes."""
        ...

    def get_routes(self, service: str) -> list[RouteDefinition]:
        """Get all routes for a service. Empty list if unknown."""
        ...

    def find_route_by_request(
        self,
        service: str,
        method: str,
        request_path: str,
    ) -> RouteDefinition | None:
        """Find route matching an HTTP request.

        COLLISION PRIORITY:
        1. Exact path > parameterized (/api/users/me > /api/users/{id})
        2. More specific > less specific (/api/users/{id}/orders > /api/users/{id})
        3. First registered if tied
        """
        ...

    def all_services(self) -> list[str]:
        """List all services with routes."""
        ...

    def clear(self, service: str | None = None) -> None:
        """Clear routes. If service provided, only that service."""
        ...


class InMemoryRegistry:
    """In-memory RouteRegistry for testing."""

    def __init__(self):
        self._routes: dict[str, list[RouteDefinition]] = {}

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        self._routes[service] = routes

    def get_routes(self, service: str) -> list[RouteDefinition]:
        return self._routes.get(service, [])

    def find_route_by_request(
        self,
        service: str,
        method: str,
        request_path: str,
    ) -> RouteDefinition | None:
        routes = self.get_routes(service)
        if not routes:
            return None

        # Normalize request path
        request_path = self._normalize_path(request_path)

        # Find matching routes
        matches = []
        for route in routes:
            if route.method.upper() != method.upper():
                continue
            if self._path_matches(route.path, request_path):
                matches.append(route)

        if not matches:
            return None

        # Return most specific match
        return self._most_specific(matches, request_path)

    def _normalize_path(self, path: str) -> str:
        """Normalize path: strip query params, trailing slash."""
        path = path.split("?")[0]
        return path.rstrip("/") or "/"

    def _path_matches(self, pattern: str, request_path: str) -> bool:
        """Match route pattern against request path.

        Pattern: /api/users/{user_id}
        Request: /api/users/123
        → True

        Also matches trailing segments:
        Pattern: /api/users/{id}
        Request: /api/users/123/orders
        → True (user resource with extension)
        """
        pattern = pattern.rstrip("/") or "/"

        # Convert {param} to regex
        regex = re.sub(r'\{[^}]+\}', r'[^/]+', re.escape(pattern))
        regex = regex.replace(r'\[^/\]+', '[^/]+')  # Fix escaped brackets

        # Allow trailing path segments
        return re.match(f"^{regex}(?:/.*)?$", request_path) is not None

    def _most_specific(
        self,
        routes: list[RouteDefinition],
        request_path: str,
    ) -> RouteDefinition:
        """Return most specific matching route.

        Specificity: More literal segments = more specific
        """
        def specificity(route: RouteDefinition) -> tuple[int, int]:
            # Count literal vs parameterized segments
            segments = route.path.strip("/").split("/")
            literal = sum(1 for s in segments if not s.startswith("{"))
            total = len(segments)
            return (literal, total)

        return max(routes, key=specificity)

    def all_services(self) -> list[str]:
        return list(self._routes.keys())

    def clear(self, service: str | None = None) -> None:
        if service:
            self._routes.pop(service, None)
        else:
            self._routes.clear()
```

## Tests

```python
def test_exact_path_match():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users', 'h.py', 'list_users', 1)
    ])
    route = registry.find_route_by_request('svc', 'GET', '/api/users')
    assert route is not None
    assert route.handler_function == 'list_users'

def test_parameterized_path():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users/{id}', 'h.py', 'get_user', 1)
    ])
    route = registry.find_route_by_request('svc', 'GET', '/api/users/123')
    assert route is not None
    assert route.handler_function == 'get_user'

def test_trailing_slash():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users/{id}', 'h.py', 'get', 1)
    ])
    route = registry.find_route_by_request('svc', 'GET', '/api/users/123/')
    assert route is not None

def test_query_params_stripped():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users/{id}', 'h.py', 'get', 1)
    ])
    route = registry.find_route_by_request('svc', 'GET', '/api/users/123?include=orders')
    assert route is not None

def test_exact_beats_parameterized():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users/me', 'h.py', 'get_me', 1),
        RouteDefinition('svc', 'GET', '/api/users/{id}', 'h.py', 'get_user', 2),
    ])
    route = registry.find_route_by_request('svc', 'GET', '/api/users/me')
    assert route.handler_function == 'get_me'

def test_method_mismatch():
    registry = InMemoryRegistry()
    registry.add_routes('svc', [
        RouteDefinition('svc', 'GET', '/api/users', 'h.py', 'list', 1)
    ])
    route = registry.find_route_by_request('svc', 'POST', '/api/users')
    assert route is None

def test_unknown_service():
    registry = InMemoryRegistry()
    route = registry.find_route_by_request('unknown', 'GET', '/api')
    assert route is None
```

## Acceptance Criteria

- [ ] RouteRegistry protocol defined
- [ ] RouteDefinition dataclass complete
- [ ] InMemoryRegistry implements protocol
- [ ] Path matching handles {param} patterns
- [ ] Query params stripped before matching
- [ ] Trailing slashes handled
- [ ] Most specific route wins collisions

## Estimated Time

35 minutes
