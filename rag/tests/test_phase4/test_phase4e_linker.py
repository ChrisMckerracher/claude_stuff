"""Tests for Phase 4e.1: Call Linker Implementation."""

import pytest

from rag.extractors import (
    CallLinker,
    InMemoryRegistry,
    RouteDefinition,
    ServiceCall,
)


@pytest.fixture
def registry() -> InMemoryRegistry:
    """Create a test registry with sample routes."""
    r = InMemoryRegistry()
    r.add_routes(
        "user-service",
        [
            RouteDefinition(
                "user-service",
                "GET",
                "/api/users/{id}",
                "user_ctrl.py",
                "get_user",
                10,
            ),
            RouteDefinition(
                "user-service",
                "POST",
                "/api/users",
                "user_ctrl.py",
                "create_user",
                20,
            ),
        ],
    )
    r.add_routes(
        "billing-service",
        [
            RouteDefinition(
                "billing-service",
                "POST",
                "/charge",
                "billing.py",
                "charge",
                5,
            ),
        ],
    )
    return r


@pytest.fixture
def linker(registry: InMemoryRegistry) -> CallLinker:
    """Create a linker with the test registry."""
    return CallLinker(registry)


class TestCallLinkerSuccess:
    """Test successful linking."""

    def test_links_exact_match(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="user-service",
            call_type="http",
            line_number=5,
            confidence=0.9,
            method="GET",
            url_path="/api/users/123",
            target_host=None,
        )
        result = linker.link(call)
        assert result.linked
        assert result.relation is not None
        assert result.relation.target_function == "get_user"
        assert result.relation.target_file == "user-service/user_ctrl.py"

    def test_links_post_request(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="billing-service",
            call_type="http",
            line_number=10,
            confidence=0.9,
            method="POST",
            url_path="/charge",
            target_host=None,
        )
        result = linker.link(call)
        assert result.linked
        assert result.relation is not None
        assert result.relation.target_function == "charge"

    def test_relation_has_correct_fields(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="user-service",
            call_type="http",
            line_number=42,
            confidence=0.9,
            method="GET",
            url_path="/api/users/123",
            target_host=None,
        )
        result = linker.link(call)
        assert result.linked
        relation = result.relation
        assert relation is not None
        assert relation.source_file == "auth.py"
        assert relation.source_line == 42
        assert relation.target_line == 10
        assert relation.relation_type == "HTTP_CALL"
        assert relation.route_path == "/api/users/{id}"


class TestCallLinkerFailure:
    """Test failure cases."""

    def test_no_routes_reason(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="unknown-service",
            call_type="http",
            line_number=5,
            confidence=0.9,
            method="GET",
            url_path="/api",
            target_host=None,
        )
        result = linker.link(call)
        assert not result.linked
        assert result.miss_reason == "no_routes"
        assert result.unlinked_call == call

    def test_method_mismatch_reason(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="user-service",
            call_type="http",
            line_number=5,
            confidence=0.9,
            method="DELETE",
            url_path="/api/users/123",
            target_host=None,
        )
        result = linker.link(call)
        assert not result.linked
        assert result.miss_reason == "method_mismatch"

    def test_path_mismatch_reason(self, linker: CallLinker) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="user-service",
            call_type="http",
            line_number=5,
            confidence=0.9,
            method="GET",
            url_path="/api/orders",
            target_host=None,
        )
        result = linker.link(call)
        assert not result.linked
        assert result.miss_reason == "path_mismatch"


class TestCallLinkerBatch:
    """Test batch linking."""

    def test_link_batch(self, linker: CallLinker) -> None:
        calls = [
            ServiceCall(
                source_file="auth.py",
                target_service="user-service",
                call_type="http",
                line_number=5,
                confidence=0.9,
                method="GET",
                url_path="/api/users/1",
                target_host=None,
            ),
            ServiceCall(
                source_file="auth.py",
                target_service="billing-service",
                call_type="http",
                line_number=10,
                confidence=0.9,
                method="POST",
                url_path="/charge",
                target_host=None,
            ),
        ]
        results = linker.link_batch(calls)
        assert len(results) == 2
        assert all(r.linked for r in results)

    def test_batch_preserves_order(self, linker: CallLinker) -> None:
        calls = [
            ServiceCall(
                source_file="a.py",
                target_service="user-service",
                call_type="http",
                line_number=1,
                confidence=0.9,
                method="GET",
                url_path="/api/users/1",
                target_host=None,
            ),
            ServiceCall(
                source_file="b.py",
                target_service="unknown",
                call_type="http",
                line_number=2,
                confidence=0.9,
                method="GET",
                url_path="/api",
                target_host=None,
            ),
            ServiceCall(
                source_file="c.py",
                target_service="billing-service",
                call_type="http",
                line_number=3,
                confidence=0.9,
                method="POST",
                url_path="/charge",
                target_host=None,
            ),
        ]
        results = linker.link_batch(calls)
        assert len(results) == 3
        assert results[0].linked  # user-service
        assert not results[1].linked  # unknown
        assert results[2].linked  # billing-service


class TestLinkResultFactory:
    """Test LinkResult factory methods."""

    def test_success_factory(self) -> None:
        from rag.extractors import LinkResult, ServiceRelation

        relation = ServiceRelation(
            source_file="a.py",
            source_line=1,
            target_file="b.py",
            target_function="handler",
            target_line=10,
            relation_type="HTTP_CALL",
            route_path="/api",
        )
        result = LinkResult.success(relation)
        assert result.linked
        assert result.relation == relation
        assert result.unlinked_call is None
        assert result.miss_reason is None

    def test_failure_factory(self) -> None:
        from rag.extractors import LinkResult

        call = ServiceCall(
            source_file="a.py",
            target_service="svc",
            call_type="http",
            line_number=1,
            confidence=0.9,
            method="GET",
            url_path="/api",
            target_host=None,
        )
        result = LinkResult.failure(call, "no_routes")
        assert not result.linked
        assert result.relation is None
        assert result.unlinked_call == call
        assert result.miss_reason == "no_routes"
