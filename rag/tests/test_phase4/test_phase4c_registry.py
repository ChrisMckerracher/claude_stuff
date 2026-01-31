"""Tests for Phase 4c.1: Registry Protocol & InMemory."""

import pytest

from rag.extractors import InMemoryRegistry, RouteDefinition


class TestInMemoryRegistryBasics:
    """Test basic registry operations."""

    def test_add_and_get_routes(self) -> None:
        registry = InMemoryRegistry()
        routes = [
            RouteDefinition("svc", "GET", "/api/users", "h.py", "list_users", 1)
        ]
        registry.add_routes("svc", routes)
        assert registry.get_routes("svc") == routes

    def test_get_routes_empty_for_unknown_service(self) -> None:
        registry = InMemoryRegistry()
        assert registry.get_routes("unknown") == []

    def test_add_routes_replaces_existing(self) -> None:
        registry = InMemoryRegistry()
        routes1 = [
            RouteDefinition("svc", "GET", "/v1", "h.py", "v1", 1)
        ]
        routes2 = [
            RouteDefinition("svc", "GET", "/v2", "h.py", "v2", 1)
        ]
        registry.add_routes("svc", routes1)
        registry.add_routes("svc", routes2)
        assert registry.get_routes("svc") == routes2

    def test_all_services(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc1", [
            RouteDefinition("svc1", "GET", "/api", "h.py", "h", 1)
        ])
        registry.add_routes("svc2", [
            RouteDefinition("svc2", "GET", "/api", "h.py", "h", 1)
        ])
        services = registry.all_services()
        assert set(services) == {"svc1", "svc2"}


class TestInMemoryRegistryPathMatching:
    """Test path matching logic."""

    def test_exact_path_match(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "h.py", "list_users", 1)
        ])
        route = registry.find_route_by_request("svc", "GET", "/api/users")
        assert route is not None
        assert route.handler_function == "list_users"

    def test_parameterized_path(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "h.py", "get_user", 1)
        ])
        route = registry.find_route_by_request("svc", "GET", "/api/users/123")
        assert route is not None
        assert route.handler_function == "get_user"

    def test_multiple_params(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition(
                "svc", "GET", "/api/users/{user_id}/orders/{order_id}",
                "h.py", "get_order", 1
            )
        ])
        route = registry.find_route_by_request(
            "svc", "GET", "/api/users/123/orders/456"
        )
        assert route is not None
        assert route.handler_function == "get_order"

    def test_trailing_slash_handled(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "h.py", "get", 1)
        ])
        route = registry.find_route_by_request("svc", "GET", "/api/users/123/")
        assert route is not None

    def test_query_params_stripped(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/{id}", "h.py", "get", 1)
        ])
        route = registry.find_route_by_request(
            "svc", "GET", "/api/users/123?include=orders"
        )
        assert route is not None


class TestInMemoryRegistryCollisions:
    """Test collision resolution."""

    def test_exact_beats_parameterized(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users/me", "h.py", "get_me", 1),
            RouteDefinition("svc", "GET", "/api/users/{id}", "h.py", "get_user", 2),
        ])
        route = registry.find_route_by_request("svc", "GET", "/api/users/me")
        assert route is not None
        assert route.handler_function == "get_me"

    def test_more_literal_segments_wins(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition(
                "svc", "GET", "/api/{resource}",
                "h.py", "generic", 1
            ),
            RouteDefinition(
                "svc", "GET", "/api/users",
                "h.py", "users", 2
            ),
        ])
        route = registry.find_route_by_request("svc", "GET", "/api/users")
        assert route is not None
        assert route.handler_function == "users"


class TestInMemoryRegistryMethodMatching:
    """Test HTTP method matching."""

    def test_method_mismatch_returns_none(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "h.py", "list", 1)
        ])
        route = registry.find_route_by_request("svc", "POST", "/api/users")
        assert route is None

    def test_method_case_insensitive(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "h.py", "list", 1)
        ])
        route = registry.find_route_by_request("svc", "get", "/api/users")
        assert route is not None

    def test_different_methods_same_path(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc", [
            RouteDefinition("svc", "GET", "/api/users", "h.py", "list_users", 1),
            RouteDefinition("svc", "POST", "/api/users", "h.py", "create_user", 2),
        ])
        get_route = registry.find_route_by_request("svc", "GET", "/api/users")
        post_route = registry.find_route_by_request("svc", "POST", "/api/users")
        assert get_route is not None
        assert get_route.handler_function == "list_users"
        assert post_route is not None
        assert post_route.handler_function == "create_user"


class TestInMemoryRegistryUnknownService:
    """Test unknown service handling."""

    def test_unknown_service_returns_none(self) -> None:
        registry = InMemoryRegistry()
        route = registry.find_route_by_request("unknown", "GET", "/api")
        assert route is None


class TestInMemoryRegistryClear:
    """Test clearing routes."""

    def test_clear_all(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc1", [
            RouteDefinition("svc1", "GET", "/api", "h.py", "h", 1)
        ])
        registry.add_routes("svc2", [
            RouteDefinition("svc2", "GET", "/api", "h.py", "h", 1)
        ])
        registry.clear()
        assert registry.all_services() == []

    def test_clear_specific_service(self) -> None:
        registry = InMemoryRegistry()
        registry.add_routes("svc1", [
            RouteDefinition("svc1", "GET", "/api", "h.py", "h", 1)
        ])
        registry.add_routes("svc2", [
            RouteDefinition("svc2", "GET", "/api", "h.py", "h", 1)
        ])
        registry.clear("svc1")
        assert registry.all_services() == ["svc2"]
