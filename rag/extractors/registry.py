"""Route registry for storing and querying route definitions.

Provides RouteRegistry protocol, InMemoryRegistry, and SQLiteRegistry implementations.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
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


class SQLiteRegistry:
    """SQLite-backed RouteRegistry for persistent storage.

    Schema:
        routes(
            id INTEGER PRIMARY KEY,
            service TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            handler_file TEXT NOT NULL,
            handler_function TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            UNIQUE(service, method, path)
        )
    """

    def __init__(self, db_path: str | Path) -> None:
        """Initialize SQLite registry.

        Args:
            db_path: Path to SQLite database file. Created if doesn't exist.
        """
        self._db_path = Path(db_path)
        self._conn = sqlite3.connect(str(self._db_path))
        self._conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        """Create database tables if they don't exist."""
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS routes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service TEXT NOT NULL,
                method TEXT NOT NULL,
                path TEXT NOT NULL,
                handler_file TEXT NOT NULL,
                handler_function TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                UNIQUE(service, method, path)
            )
        """)
        self._conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_routes_service
            ON routes(service)
        """)
        self._conn.commit()

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        """Store routes for a service. Replaces existing routes."""
        # Delete existing routes for this service
        self._conn.execute("DELETE FROM routes WHERE service = ?", (service,))

        # Insert new routes
        for route in routes:
            self._conn.execute(
                """
                INSERT INTO routes (service, method, path, handler_file, handler_function, line_number)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    route.service,
                    route.method,
                    route.path,
                    route.handler_file,
                    route.handler_function,
                    route.line_number,
                ),
            )
        self._conn.commit()

    def get_routes(self, service: str) -> list[RouteDefinition]:
        """Get all routes for a service."""
        cursor = self._conn.execute(
            "SELECT * FROM routes WHERE service = ?", (service,)
        )
        return [self._row_to_route(row) for row in cursor.fetchall()]

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
        """Match route pattern against request path."""
        pattern = pattern.rstrip("/") or "/"
        request_path = request_path.rstrip("/") or "/"

        pattern_parts = pattern.split("/")
        request_parts = request_path.split("/")

        if len(pattern_parts) != len(request_parts):
            return False

        for p_part, r_part in zip(pattern_parts, request_parts):
            if p_part.startswith("{") and p_part.endswith("}"):
                if not r_part:
                    return False
            elif p_part != r_part:
                return False

        return True

    def _most_specific(
        self,
        routes: list[RouteDefinition],
        request_path: str,
    ) -> RouteDefinition:
        """Return most specific matching route."""

        def specificity(route: RouteDefinition) -> tuple[int, int]:
            segments = route.path.strip("/").split("/")
            literal = sum(1 for s in segments if not s.startswith("{"))
            total = len(segments)
            return (literal, total)

        return max(routes, key=specificity)

    def _row_to_route(self, row: sqlite3.Row) -> RouteDefinition:
        """Convert database row to RouteDefinition."""
        return RouteDefinition(
            service=row["service"],
            method=row["method"],  # type: ignore[arg-type]
            path=row["path"],
            handler_file=row["handler_file"],
            handler_function=row["handler_function"],
            line_number=row["line_number"],
        )

    def all_services(self) -> list[str]:
        """List all services with routes."""
        cursor = self._conn.execute("SELECT DISTINCT service FROM routes")
        return [row["service"] for row in cursor.fetchall()]

    def clear(self, service: str | None = None) -> None:
        """Clear routes. If service provided, only that service."""
        if service:
            self._conn.execute("DELETE FROM routes WHERE service = ?", (service,))
        else:
            self._conn.execute("DELETE FROM routes")
        self._conn.commit()

    def close(self) -> None:
        """Close database connection."""
        self._conn.close()

    def __enter__(self) -> "SQLiteRegistry":
        """Context manager entry."""
        return self

    def __exit__(self, exc_type: object, exc_val: object, exc_tb: object) -> None:
        """Context manager exit - close connection."""
        self.close()
