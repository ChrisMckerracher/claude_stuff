"""Tests for Phase 4b.1: Go HTTP Extractor."""

import pytest

from rag.extractors import Confidence, GoExtractor


def go_wrap(code: str) -> bytes:
    """Wrap Go code in a package/func context for proper parsing."""
    return f"""
package main

func main() {{
    {code}
}}
""".encode()


class TestGoExtractorHttpGet:
    """Test http.Get detection."""

    def test_extracts_http_get_literal(self) -> None:
        code = go_wrap('resp, _ := http.Get("http://user-service/api/users")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].url_path == "/api/users"
        assert calls[0].method == "GET"
        assert calls[0].confidence >= Confidence.HIGH

    def test_extracts_http_get_with_path_params(self) -> None:
        code = go_wrap('resp, _ := http.Get("http://user-service/api/users/123")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].url_path == "/api/users/123"


class TestGoExtractorHttpPost:
    """Test http.Post detection."""

    def test_extracts_http_post(self) -> None:
        code = go_wrap('resp, _ := http.Post("http://billing-api/charge", "application/json", body)')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"


class TestGoExtractorNewRequest:
    """Test http.NewRequest detection."""

    def test_extracts_new_request_get(self) -> None:
        code = go_wrap('req, _ := http.NewRequest("GET", "http://user-service/api/users", nil)')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "GET"
        assert calls[0].target_service == "user-service"

    def test_extracts_new_request_delete(self) -> None:
        code = go_wrap('req, _ := http.NewRequest("DELETE", "http://order-service/orders/123", nil)')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "DELETE"
        assert calls[0].target_service == "order-service"

    def test_extracts_new_request_post(self) -> None:
        code = go_wrap('req, _ := http.NewRequest("POST", "http://billing-api/charge", bytes.NewBuffer(data))')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"


class TestGoExtractorClientCalls:
    """Test client.Get/Post patterns."""

    def test_extracts_client_get(self) -> None:
        code = go_wrap('resp, _ := client.Get("http://user-service/api/users")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"

    def test_extracts_http_client_get(self) -> None:
        code = go_wrap('resp, _ := httpClient.Get("http://order-service/orders")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "order-service"


class TestGoExtractorIgnore:
    """Test that non-HTTP calls are ignored."""

    def test_ignores_localhost(self) -> None:
        code = go_wrap('resp, _ := http.Get("http://localhost:8080/api")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_127_0_0_1(self) -> None:
        code = go_wrap('resp, _ := http.Get("http://127.0.0.1:8080/api")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_non_http_calls(self) -> None:
        code = go_wrap('result := fmt.Sprintf("http://user-service/api")')
        calls = GoExtractor().extract(code)
        assert len(calls) == 0


class TestGoExtractorMultipleCalls:
    """Test multiple calls detection."""

    def test_extracts_multiple_calls(self) -> None:
        code = b"""
package main

func fetchAll() {
    resp1, _ := http.Get("http://user-service/users")
    resp2, _ := http.Post("http://billing-api/charge", "application/json", nil)
    req, _ := http.NewRequest("DELETE", "http://order-service/orders/123", nil)
    _ = resp1
    _ = resp2
    _ = req
}
"""
        calls = GoExtractor().extract(code)
        assert len(calls) == 3
        services = {c.target_service for c in calls}
        assert services == {"user-service", "billing-api", "order-service"}


class TestGoExtractorLineNumbers:
    """Test line number detection."""

    def test_captures_line_number(self) -> None:
        code = b"""package main

func main() {
    // line 4
    resp, _ := http.Get("http://user-service/api")
    _ = resp
}
"""
        calls = GoExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].line_number == 5
