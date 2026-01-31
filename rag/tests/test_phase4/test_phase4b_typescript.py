"""Tests for Phase 4b.2: TypeScript HTTP Extractor."""

import pytest

from rag.extractors import Confidence, TypeScriptExtractor


class TestTypeScriptFetch:
    """Test fetch() detection."""

    def test_extracts_fetch_literal(self) -> None:
        code = b'fetch("http://user-service/api/users")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].url_path == "/api/users"
        assert calls[0].method == "GET"
        assert calls[0].confidence >= Confidence.HIGH

    def test_extracts_fetch_with_options(self) -> None:
        code = b'fetch("http://billing-api/charge", { method: "POST", body: JSON.stringify(data) })'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "billing-api"
        assert calls[0].method == "POST"

    def test_extracts_fetch_template_string(self) -> None:
        code = b'fetch(`http://${SERVICE_HOST}/api/users`)'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].confidence == Confidence.MEDIUM

    def test_extracts_await_fetch(self) -> None:
        code = b'const response = await fetch("http://order-service/orders")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "order-service"


class TestTypeScriptAxios:
    """Test axios detection."""

    def test_extracts_axios_get(self) -> None:
        code = b'axios.get("http://user-service/api/users")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].method == "GET"

    def test_extracts_axios_post(self) -> None:
        code = b'axios.post("http://billing-api/charge", data)'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"

    def test_extracts_axios_put(self) -> None:
        code = b'axios.put("http://user-service/api/users/123", data)'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "PUT"

    def test_extracts_axios_delete(self) -> None:
        code = b'axios.delete("http://order-service/orders/123")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "DELETE"


class TestTypeScriptHttpClient:
    """Test http client patterns."""

    def test_extracts_http_get(self) -> None:
        code = b'http.get("http://user-service/api/users")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"

    def test_extracts_client_get(self) -> None:
        code = b'client.get("http://order-service/orders")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "order-service"

    def test_extracts_api_client_post(self) -> None:
        code = b'apiClient.post("http://billing-api/charge", payload)'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "billing-api"


class TestTypeScriptIgnore:
    """Test that non-HTTP calls are ignored."""

    def test_ignores_localhost(self) -> None:
        code = b'fetch("http://localhost:3000/api")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_127_0_0_1(self) -> None:
        code = b'fetch("http://127.0.0.1:3000/api")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_console_log(self) -> None:
        code = b'console.log("http://user-service/api")'
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 0


class TestTypeScriptMultipleCalls:
    """Test multiple calls detection."""

    def test_extracts_multiple_calls(self) -> None:
        code = b'''
fetch("http://user-service/users")
axios.post("http://billing-api/charge")
http.delete("http://order-service/orders/123")
'''
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 3
        services = {c.target_service for c in calls}
        assert services == {"user-service", "billing-api", "order-service"}

    def test_extracts_calls_in_async_function(self) -> None:
        code = b'''
async function getUser(userId) {
    const response = await fetch(`http://user-service/api/users/${userId}`)
    return response.json()
}
'''
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"


class TestTypeScriptLineNumbers:
    """Test line number detection."""

    def test_captures_line_number(self) -> None:
        code = b'''// line 1
// line 2
fetch("http://user-service/api")  // line 3
'''
        calls = TypeScriptExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].line_number == 3
