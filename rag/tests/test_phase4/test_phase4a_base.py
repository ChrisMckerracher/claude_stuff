"""Tests for Phase 4a.1: Base Types & Patterns."""

import pytest

from rag.extractors.base import Confidence, ServiceCall
from rag.extractors.patterns import (
    determine_confidence,
    extract_service_from_url,
)


class TestConfidence:
    """Test Confidence levels."""

    def test_high_is_highest(self) -> None:
        assert Confidence.HIGH > Confidence.MEDIUM
        assert Confidence.HIGH > Confidence.LOW
        assert Confidence.HIGH > Confidence.GUESS

    def test_medium_between_high_and_low(self) -> None:
        assert Confidence.MEDIUM < Confidence.HIGH
        assert Confidence.MEDIUM > Confidence.LOW

    def test_low_above_guess(self) -> None:
        assert Confidence.LOW > Confidence.GUESS

    def test_values_are_floats(self) -> None:
        assert isinstance(Confidence.HIGH, float)
        assert isinstance(Confidence.MEDIUM, float)
        assert isinstance(Confidence.LOW, float)
        assert isinstance(Confidence.GUESS, float)


class TestServiceCall:
    """Test ServiceCall dataclass."""

    def test_create_http_call(self) -> None:
        call = ServiceCall(
            source_file="auth.py",
            target_service="user-service",
            call_type="http",
            line_number=10,
            confidence=Confidence.HIGH,
            method="GET",
            url_path="/api/users",
            target_host="user-service",
        )
        assert call.source_file == "auth.py"
        assert call.target_service == "user-service"
        assert call.call_type == "http"
        assert call.method == "GET"

    def test_create_grpc_call(self) -> None:
        call = ServiceCall(
            source_file="client.py",
            target_service="order-service",
            call_type="grpc",
            line_number=25,
            confidence=Confidence.MEDIUM,
        )
        assert call.call_type == "grpc"
        assert call.method is None
        assert call.url_path is None

    def test_create_queue_call(self) -> None:
        call = ServiceCall(
            source_file="worker.py",
            target_service="notification-queue",
            call_type="queue_publish",
            line_number=50,
            confidence=Confidence.HIGH,
        )
        assert call.call_type == "queue_publish"


class TestExtractServiceFromUrl:
    """Test URL parsing."""

    def test_extract_simple_service(self) -> None:
        service, path = extract_service_from_url("http://user-service/api/users")
        assert service == "user-service"
        assert path == "/api/users"

    def test_extract_with_port(self) -> None:
        service, path = extract_service_from_url("http://billing-api:8080/charge")
        assert service == "billing-api"
        assert path == "/charge"

    def test_extract_https(self) -> None:
        service, path = extract_service_from_url("https://order-service/api/orders")
        assert service == "order-service"
        assert path == "/api/orders"

    def test_skip_localhost(self) -> None:
        service, path = extract_service_from_url("http://localhost/api")
        assert service is None
        assert path is None

    def test_skip_127_0_0_1(self) -> None:
        service, path = extract_service_from_url("http://127.0.0.1:8000/api")
        assert service is None
        assert path is None

    def test_no_path(self) -> None:
        service, path = extract_service_from_url("http://user-service")
        assert service == "user-service"
        assert path is None

    def test_invalid_url(self) -> None:
        service, path = extract_service_from_url("not a url")
        assert service is None
        assert path is None


class TestDetermineConfidence:
    """Test confidence determination."""

    def test_literal_string_high(self) -> None:
        conf = determine_confidence("http://user-service/api", "string")
        assert conf == Confidence.HIGH

    def test_fstring_medium(self) -> None:
        conf = determine_confidence("f'http://{host}/api'", "formatted_string")
        assert conf == Confidence.MEDIUM

    def test_template_medium(self) -> None:
        conf = determine_confidence("`http://${host}/api`", "template_string")
        assert conf == Confidence.MEDIUM

    def test_identifier_low(self) -> None:
        conf = determine_confidence("service_url", "identifier")
        assert conf == Confidence.LOW
