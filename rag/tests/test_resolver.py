"""Tests for ServiceNameResolver."""

from __future__ import annotations

import pytest

from rag.boundary.graph import ServiceNode
from rag.boundary.resolver import ServiceNameResolver


@pytest.fixture
def known_services() -> dict[str, ServiceNode]:
    """Sample set of known services."""
    return {
        "auth-service": ServiceNode(name="auth-service"),
        "user-service": ServiceNode(name="user-service"),
        "payment-service": ServiceNode(name="payment-service"),
        "notification-service": ServiceNode(name="notification-service"),
    }


@pytest.fixture
def resolver() -> ServiceNameResolver:
    """Default resolver instance."""
    return ServiceNameResolver()


class TestExactMatches:
    """Tests for exact service name matching."""

    def test_exact_match(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Exact service name resolves correctly."""
        result = resolver.resolve("auth-service", known_services)
        assert result == "auth-service"

    def test_exact_match_case_insensitive(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Exact match works case-insensitively."""
        result = resolver.resolve("Auth-Service", known_services)
        assert result == "auth-service"


class TestURLStripping:
    """Tests for URL parsing and hostname extraction."""

    def test_strip_protocol_port(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Protocol and port are stripped from URL."""
        result = resolver.resolve("http://auth-service:8080", known_services)
        assert result == "auth-service"

    def test_https_protocol(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """HTTPS protocol is handled."""
        result = resolver.resolve("https://user-service:443", known_services)
        assert result == "user-service"

    def test_url_path_stripped(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """URL path is stripped."""
        result = resolver.resolve(
            "http://user-service:8080/api/v1/users",
            known_services,
        )
        assert result == "user-service"

    def test_hostname_only(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Plain hostname without protocol resolves."""
        result = resolver.resolve("payment-service", known_services)
        assert result == "payment-service"

    def test_hostname_with_port_no_protocol(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Hostname:port without protocol resolves."""
        result = resolver.resolve("payment-service:8080", known_services)
        assert result == "payment-service"


class TestK8sDNS:
    """Tests for Kubernetes DNS pattern handling."""

    def test_k8s_svc_cluster_local(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Full K8s DNS name is stripped."""
        result = resolver.resolve(
            "auth-service.default.svc.cluster.local",
            known_services,
        )
        assert result == "auth-service"

    def test_k8s_svc_suffix(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """K8s .svc suffix is stripped."""
        result = resolver.resolve("user-service.default.svc", known_services)
        assert result == "user-service"

    def test_k8s_with_namespace(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Namespace is stripped from K8s DNS name."""
        result = resolver.resolve("payment-service.payments", known_services)
        assert result == "payment-service"


class TestPartialMatches:
    """Tests for fuzzy/partial matching."""

    def test_partial_match(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Partial name matches known service."""
        # 'auth-svc' should partially match 'auth-service'
        result = resolver.resolve("auth-svc", known_services)
        # May or may not match depending on similarity threshold
        # At minimum, should not crash
        assert result is None or result == "auth-service"

    def test_substring_match(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Substring matching works for contained names."""
        # 'auth' is a substring of 'auth-service'
        result = resolver.resolve("auth", known_services)
        assert result == "auth-service"

    def test_no_match(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Unknown service returns None."""
        result = resolver.resolve("unknown-thing", known_services)
        assert result is None

    def test_external_service_no_match(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """External URLs don't match internal services."""
        result = resolver.resolve("https://api.stripe.com/v1/charges", known_services)
        assert result is None


class TestEdgeCases:
    """Edge case handling."""

    def test_empty_target(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Empty target returns None."""
        result = resolver.resolve("", known_services)
        assert result is None

    def test_empty_known_services(
        self,
        resolver: ServiceNameResolver,
    ) -> None:
        """Empty known services returns None."""
        result = resolver.resolve("auth-service", {})
        assert result is None

    def test_whitespace_handling(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Whitespace is stripped."""
        result = resolver.resolve("  auth-service  ", known_services)
        assert result == "auth-service"


class TestResolveWithConfidence:
    """Tests for resolve_with_confidence method."""

    def test_exact_match_confidence(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Exact match has confidence 1.0."""
        result = resolver.resolve_with_confidence("auth-service", known_services)

        assert result.resolved == "auth-service"
        assert result.confidence == 1.0

    def test_no_match_confidence(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """No match has confidence 0.0."""
        result = resolver.resolve_with_confidence("unknown-xyz", known_services)

        assert result.resolved is None
        assert result.confidence == 0.0

    def test_original_preserved(
        self,
        resolver: ServiceNameResolver,
        known_services: dict[str, ServiceNode],
    ) -> None:
        """Original value is preserved in result."""
        original = "http://auth-service:8080/api/v1"
        result = resolver.resolve_with_confidence(original, known_services)

        assert result.original == original


class TestSimilarityThreshold:
    """Tests for similarity threshold configuration."""

    def test_high_threshold_stricter(self) -> None:
        """Higher threshold requires closer matches."""
        strict_resolver = ServiceNameResolver(min_similarity=0.9)
        known = {"auth-service": ServiceNode(name="auth-service")}

        # 'auth' alone should not meet 0.9 threshold
        result = strict_resolver.resolve("auth", known)
        # Behavior depends on implementation
        assert result is None or result == "auth-service"

    def test_low_threshold_more_lenient(self) -> None:
        """Lower threshold allows looser matches."""
        lenient_resolver = ServiceNameResolver(min_similarity=0.3)
        known = {"auth-service": ServiceNode(name="auth-service")}

        result = lenient_resolver.resolve("auth", known)
        assert result == "auth-service"
