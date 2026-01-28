"""Tests for service reference extraction."""

import pytest

from rag.boundary.service_refs import (
    extract_service_refs,
    extract_urls,
    extract_service_names_from_urls,
)


class TestExactMatch:
    """Test exact service name matching."""

    def test_exact_match(self) -> None:
        """Exact service name is matched."""
        text = "auth-service is down"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == ["auth-service"]

    def test_case_insensitive(self) -> None:
        """Matching is case-insensitive."""
        text = "Auth-Service is responding slowly"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == ["auth-service"]

    def test_multiple_refs(self) -> None:
        """Multiple service references are all found."""
        text = "auth-service calls user-service which depends on payment-service"
        known = {"auth-service", "user-service", "payment-service"}

        result = extract_service_refs(text, known)

        assert len(result) == 3
        assert "auth-service" in result
        assert "user-service" in result
        assert "payment-service" in result


class TestUrlPattern:
    """Test URL-based service detection."""

    def test_url_pattern(self) -> None:
        """Service name extracted from URL."""
        text = "calling http://user-service:8080/api/users"
        known = {"user-service"}

        result = extract_service_refs(text, known)

        assert result == ["user-service"]

    def test_https_url(self) -> None:
        """HTTPS URLs are also matched."""
        text = "connect to https://api-gateway:443/v1"
        known = {"api-gateway"}

        result = extract_service_refs(text, known)

        assert result == ["api-gateway"]

    def test_url_without_port(self) -> None:
        """URLs without port are matched."""
        text = "fetch from http://data-service/records"
        known = {"data-service"}

        result = extract_service_refs(text, known)

        assert result == ["data-service"]


class TestNoFalsePositives:
    """Test that false positives are avoided."""

    def test_no_false_substring(self) -> None:
        """Substring doesn't match - 'service' alone doesn't match 'auth-service'."""
        text = "the service is running"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == []

    def test_no_partial_match(self) -> None:
        """Partial match doesn't trigger - 'auth' doesn't match 'auth-service'."""
        text = "auth module is loaded"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == []

    def test_embedded_in_word(self) -> None:
        """Service name embedded in larger word is not matched."""
        text = "the preauth-servicer is working"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == []


class TestEdgeCases:
    """Test edge cases."""

    def test_no_known_services(self) -> None:
        """Empty known_services returns empty result."""
        text = "auth-service is down"
        known: set[str] = set()

        result = extract_service_refs(text, known)

        assert result == []

    def test_empty_text(self) -> None:
        """Empty text returns empty result."""
        text = ""
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == []

    def test_service_at_start(self) -> None:
        """Service name at start of text is matched."""
        text = "auth-service started successfully"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == ["auth-service"]

    def test_service_at_end(self) -> None:
        """Service name at end of text is matched."""
        text = "error from auth-service"
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == ["auth-service"]

    def test_service_with_quotes(self) -> None:
        """Service name in quotes is matched."""
        text = 'the "auth-service" returned an error'
        known = {"auth-service"}

        result = extract_service_refs(text, known)

        assert result == ["auth-service"]


class TestResultOrdering:
    """Test result ordering."""

    def test_results_sorted(self) -> None:
        """Results are returned in sorted order."""
        text = "z-service, a-service, and m-service"
        known = {"z-service", "a-service", "m-service"}

        result = extract_service_refs(text, known)

        assert result == ["a-service", "m-service", "z-service"]


class TestUrlExtraction:
    """Test URL extraction helper."""

    def test_extract_urls(self) -> None:
        """URLs are extracted from text."""
        text = "call http://foo:8080 and https://bar:443/path"

        urls = extract_urls(text)

        assert len(urls) == 2
        assert "http://foo:8080" in urls
        assert "https://bar:443/path" in urls

    def test_extract_service_names_from_urls(self) -> None:
        """Service names are extracted from URLs."""
        urls = [
            "http://user-service:8080/api",
            "http://auth-service:9000",
        ]

        services = extract_service_names_from_urls(urls)

        assert "user-service" in services
        assert "auth-service" in services


class TestRealWorldScenarios:
    """Test real-world text scenarios."""

    def test_incident_message(self) -> None:
        """Incident-style message has refs extracted."""
        text = (
            "ALERT: auth-service is returning 503 errors. "
            "Checking user-service dependency. "
            "Possible issue with http://payment-service:9000/health"
        )
        known = {"auth-service", "user-service", "payment-service", "order-service"}

        result = extract_service_refs(text, known)

        assert "auth-service" in result
        assert "user-service" in result
        assert "payment-service" in result
        assert "order-service" not in result

    def test_code_snippet(self) -> None:
        """Code-like text has refs extracted."""
        text = '''
        fetch("http://api-gateway:8080/users")
            .then(resp => resp.json())
            .then(data => callAuthService(data))
        '''
        known = {"api-gateway", "auth-service"}

        result = extract_service_refs(text, known)

        # api-gateway should be found via URL
        assert "api-gateway" in result
