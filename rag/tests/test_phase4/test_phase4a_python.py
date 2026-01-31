"""Tests for Phase 4a.2: Python HTTP Extractor."""

import pytest

from rag.extractors import Confidence, PythonExtractor


class TestPythonExtractorRequests:
    """Test requests library detection."""

    def test_extracts_requests_get_literal(self) -> None:
        code = b'requests.get("http://user-service/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].url_path == "/api/users"
        assert calls[0].method == "GET"
        assert calls[0].confidence >= Confidence.HIGH

    def test_extracts_requests_post(self) -> None:
        code = b'requests.post("http://billing-api/charge", json={"amount": 100})'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"

    def test_extracts_requests_put(self) -> None:
        code = b'requests.put("http://user-service/api/users/123", json=data)'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "PUT"

    def test_extracts_requests_delete(self) -> None:
        code = b'requests.delete("http://order-service/orders/123")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "DELETE"


class TestPythonExtractorHttpx:
    """Test httpx library detection."""

    def test_extracts_httpx_get(self) -> None:
        code = b'httpx.get("http://user-service/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].method == "GET"

    def test_extracts_httpx_post(self) -> None:
        code = b'httpx.post("http://billing-api/charge", json={"amount": 100})'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].method == "POST"
        assert calls[0].target_service == "billing-api"


class TestPythonExtractorConfidence:
    """Test confidence levels."""

    def test_literal_url_high_confidence(self) -> None:
        code = b'requests.get("http://user-service/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].confidence == Confidence.HIGH

    def test_fstring_medium_confidence(self) -> None:
        code = b'requests.get(f"http://{SERVICE_HOST}/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].confidence == Confidence.MEDIUM


class TestPythonExtractorIgnore:
    """Test that non-HTTP calls are ignored."""

    def test_ignores_docstring_urls(self) -> None:
        code = b'''
def fetch():
    """Example: http://user-service/api"""
    pass
'''
        calls = PythonExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_comment_urls(self) -> None:
        code = b'# TODO: call http://user-service/api\npass'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_localhost(self) -> None:
        code = b'requests.get("http://localhost:8000/api")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_127_0_0_1(self) -> None:
        code = b'requests.get("http://127.0.0.1:8000/api")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 0

    def test_ignores_non_http_method(self) -> None:
        code = b'requests.Session()'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 0


class TestPythonExtractorMultipleCalls:
    """Test multiple calls in one file."""

    def test_extracts_multiple_calls(self) -> None:
        code = b'''
requests.get("http://user-service/users")
requests.post("http://billing-api/charge")
httpx.delete("http://order-service/orders/123")
'''
        calls = PythonExtractor().extract(code)
        assert len(calls) == 3
        services = {c.target_service for c in calls}
        assert services == {"user-service", "billing-api", "order-service"}

    def test_extracts_calls_in_function(self) -> None:
        code = b'''
def get_user(user_id):
    response = requests.get(f"http://user-service/api/users/{user_id}")
    return response.json()
'''
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"


class TestPythonExtractorSessionClient:
    """Test session/client object detection."""

    def test_extracts_session_call(self) -> None:
        code = b'session.get("http://user-service/api/users")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"

    def test_extracts_client_call(self) -> None:
        code = b'client.post("http://billing-api/charge")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "billing-api"

    def test_extracts_http_client_call(self) -> None:
        code = b'http_client.get("http://order-service/orders")'
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "order-service"


class TestPythonExtractorLineNumbers:
    """Test line number detection."""

    def test_captures_line_number(self) -> None:
        code = b'''# line 1
# line 2
requests.get("http://user-service/api")  # line 3
'''
        calls = PythonExtractor().extract(code)
        assert len(calls) == 1
        assert calls[0].line_number == 3
