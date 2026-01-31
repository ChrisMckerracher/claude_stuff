"""Route registry for storing and querying route definitions.

Provides RouteRegistry protocol and InMemoryRegistry implementation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol


@dataclass
class RouteDefinition:
    """A route defined in a service."""

    service: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"]
    path: str  # /api/users/{user_id}
    handler_file: str  # src/controllers/user_controller.py
    handler_function: str  # get_user
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

    def __init__(self) -> None:
        self._routes: dict[str, list[RouteDefinition]] = {}

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        """Store routes for a service."""
        self._routes[service] = routes

    def get_routes(self, service: str) -> list[RouteDefinition]:
        """Get all routes for a service."""
        return self._routes.get(service, [])

    def find_route_by_request(
        self,
        service: str,
        method: str,
        request_path: str,
    ) -> RouteDefinition | None:
        """Find route matching an HTTP request."""
        routes = self.get_routes(service)
        if not routes:
            return None

        # Normalize request path
        request_path = self._normalize_path(request_path)

        # Find matching routes
        matches: list[RouteDefinition] = []
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
        -> True
        """
        pattern = pattern.rstrip("/") or "/"
        request_path = request_path.rstrip("/") or "/"

        # Split into segments
        pattern_parts = pattern.split("/")
        request_parts = request_path.split("/")

        # Must have same number of segments for exact match
        if len(pattern_parts) != len(request_parts):
            return False

        # Match each segment
        for p_part, r_part in zip(pattern_parts, request_parts):
            if p_part.startswith("{") and p_part.endswith("}"):
                # Parameter segment - matches any non-empty value
                if not r_part:
                    return False
            elif p_part != r_part:
                # Literal segment must match exactly
                return False

        return True

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
        """List all services with routes."""
        return list(self._routes.keys())

    def clear(self, service: str | None = None) -> None:
        """Clear routes."""
        if service:
            self._routes.pop(service, None)
        else:
            self._routes.clear()
