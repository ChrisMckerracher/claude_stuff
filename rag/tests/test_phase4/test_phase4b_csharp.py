"""Tests for Phase 4b.3: C# HTTP Extractor."""

import pytest

from rag.extractors import Confidence, CSharpExtractor


def cs_wrap(code: str) -> bytes:
    """Wrap C# code in a class/method context for proper parsing."""
    return f"""
using System;
using System.Net.Http;

class Program {{
    async Task Main() {{
        {code}
    }}
}}
""".encode()


class TestCSharpHttpClientGet:
    """Test HttpClient.GetAsync detection."""

    def test_extracts_get_async_literal(self) -> None:
        code = cs_wrap('var response = await client.GetAsync("http://user-service/api/users");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].url_path == "/api/users"
        assert calls[0].method == "GET"
        assert calls[0].confidence >= Confidence.HIGH

    def test_extracts_get_string_async(self) -> None:
        code = cs_wrap('var content = await client.GetStringAsync("http://user-service/api/users");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].method == "GET"

    def test_extracts_get_stream_async(self) -> None:
        code = cs_wrap('var stream = await httpClient.GetStreamAsync("http://file-service/download");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "file-service"
        assert calls[0].method == "GET"


class TestCSharpHttpClientPost:
    """Test HttpClient.PostAsync detection."""

    def test_extracts_post_async(self) -> None:
        code = cs_wrap('var response = await client.PostAsync("http://billing-api/charge", content);')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"


class TestCSharpHttpClientOther:
    """Test other HttpClient methods."""

    def test_extracts_put_async(self) -> None:
        code = cs_wrap('var response = await client.PutAsync("http://user-service/api/users/123", content);')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "PUT"

    def test_extracts_delete_async(self) -> None:
        code = cs_wrap('var response = await client.DeleteAsync("http://order-service/orders/123");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "DELETE"


class TestCSharpInterpolatedString:
    """Test interpolated string detection."""

    def test_extracts_interpolated_url(self) -> None:
        code = cs_wrap('var response = await client.GetAsync($"http://{serviceHost}/api/users");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].confidence == Confidence.MEDIUM


class TestCSharpClientVariants:
    """Test different client naming patterns."""

    def test_extracts_httpclient(self) -> None:
        code = cs_wrap('var response = await httpClient.GetAsync("http://user-service/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1

    def test_extracts_underscore_client(self) -> None:
        code = cs_wrap('var response = await _client.GetAsync("http://user-service/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1

    def test_extracts_api_client(self) -> None:
        code = cs_wrap('var response = await apiClient.GetAsync("http://user-service/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1


class TestCSharpIgnore:
    """Test that non-HTTP calls are ignored."""

    def test_ignores_localhost(self) -> None:
        code = cs_wrap('var response = await client.GetAsync("http://localhost:5000/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_127_0_0_1(self) -> None:
        code = cs_wrap('var response = await client.GetAsync("http://127.0.0.1:5000/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_console_write(self) -> None:
        code = cs_wrap('Console.WriteLine("http://user-service/api");')
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 0


class TestCSharpMultipleCalls:
    """Test multiple calls detection."""

    def test_extracts_multiple_calls(self) -> None:
        code = b"""
using System.Net.Http;

class Service {
    async Task FetchAll() {
        var r1 = await client.GetAsync("http://user-service/users");
        var r2 = await client.PostAsync("http://billing-api/charge", null);
        var r3 = await client.DeleteAsync("http://order-service/orders/123");
    }
}
"""
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 3
        services = {c.target_service for c in calls}
        assert services == {"user-service", "billing-api", "order-service"}


class TestCSharpLineNumbers:
    """Test line number detection."""

    def test_captures_line_number(self) -> None:
        code = b"""using System;
class Program {
    async Task Main() {
        // line 4
        var r = await client.GetAsync("http://user-service/api");
    }
}
"""
        calls = CSharpExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].line_number == 5
