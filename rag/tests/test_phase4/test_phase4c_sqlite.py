"""Tests for Phase 4c.2: SQLite Registry."""

import os
import tempfile

import pytest

from rag.extractors import RouteDefinition, SQLiteRegistry


@pytest.fixture
def sqlite_registry():
    """Create a temporary SQLite registry for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "routes.db")
        registry = SQLiteRegistry(db_path)
        yield registry
        registry.close()


class TestSQLiteRegistryBasics:
    """Test basic CRUD operations."""

    def test_add_and_get_routes(self, sqlite_registry: SQLiteRegistry) -> None:
        routes = [
            RouteDefinition("user-service", "GET", "/api/users", "ctrl.py", "list_users", 10),
            RouteDefinition("user-service", "POST", "/api/users", "ctrl.py", "create_user", 20),
        ]
        sqlite_registry.add_routes("user-service", routes)

        result = sqlite_registry.get_routes("user-service")
        assert len(result) == 2
        assert result[0].handler_function == "list_users"

    def test_get_routes_empty_for_unknown_service(self, sqlite_registry: SQLiteRegistry) -> None:
        result = sqlite_registry.get_routes("unknown-service")
        assert result == []

    def test_add_routes_replaces_existing(self, sqlite_registry: SQLiteRegistry) -> None:
        routes1 = [RouteDefinition("svc", "GET", "/v1", "a.py", "v1", 1)]
        routes2 = [RouteDefinition("svc", "GET", "/v2", "b.py", "v2", 2)]

        sqlite_registry.add_routes("svc", routes1)
        sqlite_registry.add_routes("svc", routes2)

        result = sqlite_registry.get_routes("svc")
        assert len(result) == 1
        assert result[0].path == "/v2"

    def test_all_services(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc-a", [RouteDefinition("svc-a", "GET", "/a", "a.py", "a", 1)])
        sqlite_registry.add_routes("svc-b", [RouteDefinition("svc-b", "GET", "/b", "b.py", "b", 1)])

        services = sqlite_registry.all_services()
        assert set(services) == {"svc-a", "svc-b"}


class TestSQLiteRegistryPathMatching:
    """Test path matching for find_route_by_request."""

    def test_exact_path_match(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "ctrl.py", "list_users", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users")
        assert result is not None
        assert result.handler_function == "list_users"

    def test_parameterized_path(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "ctrl.py", "get_user", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/123")
        assert result is not None
        assert result.handler_function == "get_user"

    def test_multiple_params(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{user_id}/orders/{order_id}", "ctrl.py", "get_order", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/123/orders/456")
        assert result is not None
        assert result.handler_function == "get_order"

    def test_trailing_slash_handled(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "ctrl.py", "get_user", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/123/")
        assert result is not None

    def test_query_params_stripped(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "ctrl.py", "get_user", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/123?include=orders")
        assert result is not None


class TestSQLiteRegistryCollisions:
    """Test route collision handling."""

    def test_exact_beats_parameterized(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/me", "ctrl.py", "get_me", 10),
            RouteDefinition("svc", "GET", "/api/users/{id}", "ctrl.py", "get_user", 20),
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/me")
        assert result is not None
        assert result.handler_function == "get_me"

    def test_more_literal_segments_wins(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "ctrl.py", "get_user", 10),
            RouteDefinition("svc", "GET", "/api/users/{id}/profile", "ctrl.py", "get_profile", 20),
        ])

        result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users/123/profile")
        assert result is not None
        assert result.handler_function == "get_profile"


class TestSQLiteRegistryMethodMatching:
    """Test HTTP method matching."""

    def test_method_mismatch_returns_none(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "ctrl.py", "list_users", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "POST", "/api/users")
        assert result is None

    def test_method_case_insensitive(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "ctrl.py", "list_users", 10)
        ])

        result = sqlite_registry.find_route_by_request("svc", "get", "/api/users")
        assert result is not None

    def test_different_methods_same_path(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "ctrl.py", "list_users", 10),
            RouteDefinition("svc", "POST", "/api/users", "ctrl.py", "create_user", 20),
        ])

        get_result = sqlite_registry.find_route_by_request("svc", "GET", "/api/users")
        post_result = sqlite_registry.find_route_by_request("svc", "POST", "/api/users")

        assert get_result is not None
        assert get_result.handler_function == "list_users"
        assert post_result is not None
        assert post_result.handler_function == "create_user"


class TestSQLiteRegistryUnknownService:
    """Test handling of unknown services."""

    def test_unknown_service_returns_none(self, sqlite_registry: SQLiteRegistry) -> None:
        result = sqlite_registry.find_route_by_request("unknown", "GET", "/api/test")
        assert result is None


class TestSQLiteRegistryClear:
    """Test clear functionality."""

    def test_clear_all(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc-a", [RouteDefinition("svc-a", "GET", "/a", "a.py", "a", 1)])
        sqlite_registry.add_routes("svc-b", [RouteDefinition("svc-b", "GET", "/b", "b.py", "b", 1)])

        sqlite_registry.clear()

        assert sqlite_registry.all_services() == []

    def test_clear_specific_service(self, sqlite_registry: SQLiteRegistry) -> None:
        sqlite_registry.add_routes("svc-a", [RouteDefinition("svc-a", "GET", "/a", "a.py", "a", 1)])
        sqlite_registry.add_routes("svc-b", [RouteDefinition("svc-b", "GET", "/b", "b.py", "b", 1)])

        sqlite_registry.clear("svc-a")

        assert sqlite_registry.all_services() == ["svc-b"]


class TestSQLiteRegistryPersistence:
    """Test that data persists across connections."""

    def test_data_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "routes.db")

            # First connection: write data
            registry1 = SQLiteRegistry(db_path)
            registry1.add_routes("svc", [
                RouteDefinition("svc", "GET", "/api/test", "test.py", "test_handler", 1)
            ])
            registry1.close()

            # Second connection: read data
            registry2 = SQLiteRegistry(db_path)
            routes = registry2.get_routes("svc")
            registry2.close()

            assert len(routes) == 1
            assert routes[0].handler_function == "test_handler"


class TestSQLiteRegistryContextManager:
    """Test context manager functionality."""

    def test_context_manager(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "routes.db")

            with SQLiteRegistry(db_path) as registry:
                registry.add_routes("svc", [
                    RouteDefinition("svc", "GET", "/api/test", "test.py", "handler", 1)
                ])
                routes = registry.get_routes("svc")
                assert len(routes) == 1
