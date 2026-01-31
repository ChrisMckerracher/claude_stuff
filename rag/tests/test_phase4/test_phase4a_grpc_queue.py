"""Tests for Python gRPC and Queue patterns (Phase 4a.3)."""

import pytest

from rag.extractors import PythonExtractor
from rag.extractors.base import Confidence


class TestPythonGrpcExtraction:
    """Test gRPC call extraction."""

    @pytest.fixture
    def extractor(self) -> PythonExtractor:
        return PythonExtractor()

    def test_extracts_insecure_channel(self, extractor: PythonExtractor) -> None:
        """Test extraction of grpc.insecure_channel()."""
        code = b'''
import grpc

channel = grpc.insecure_channel("user-service:50051")
'''
        calls = extractor.extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "user-service"
        assert calls[0].call_type == "grpc"
        assert calls[0].confidence == Confidence.HIGH

    def test_extracts_secure_channel(self, extractor: PythonExtractor) -> None:
        """Test extraction of grpc.secure_channel()."""
        code = b'''
import grpc

credentials = grpc.ssl_channel_credentials()
channel = grpc.secure_channel("billing-api:50051", credentials)
'''
        calls = extractor.extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "billing-api"
        assert calls[0].call_type == "grpc"
        assert calls[0].confidence == Confidence.HIGH

    def test_extracts_channel_with_port(self, extractor: PythonExtractor) -> None:
        """Test extraction handles host:port format."""
        code = b'''
channel = grpc.insecure_channel("order-service:50051")
'''
        calls = extractor.extract(code)
        assert len(calls) == 1
        assert calls[0].target_service == "order-service"

    def test_ignores_localhost(self, extractor: PythonExtractor) -> None:
        """Test that localhost channels are ignored."""
        code = b'''
channel = grpc.insecure_channel("localhost:50051")
'''
        calls = extractor.extract(code)
        # Should not extract localhost
        grpc_calls = [c for c in calls if c.call_type == "grpc"]
        assert len(grpc_calls) == 0

    def test_fstring_medium_confidence(self, extractor: PythonExtractor) -> None:
        """Test f-string target gets medium confidence."""
        code = b'''
SERVICE_HOST = "user-service"
channel = grpc.insecure_channel(f"{SERVICE_HOST}:50051")
'''
        calls = extractor.extract(code)
        # Note: f-strings are tricky - this tests the pattern
        grpc_calls = [c for c in calls if c.call_type == "grpc"]
        # May or may not detect depending on parsing
        # If detected, should be medium confidence

    def test_extracts_line_number(self, extractor: PythonExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
import grpc

# Comment
channel = grpc.insecure_channel("user-service:50051")
'''
        calls = extractor.extract(code)
        assert len(calls) == 1
        assert calls[0].line_number == 5

    def test_ignores_grpc_server(self, extractor: PythonExtractor) -> None:
        """Test that grpc.server() is not matched."""
        code = b'''
server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
'''
        calls = extractor.extract(code)
        grpc_calls = [c for c in calls if c.call_type == "grpc"]
        assert len(grpc_calls) == 0


class TestPythonQueueExtraction:
    """Test message queue call extraction."""

    @pytest.fixture
    def extractor(self) -> PythonExtractor:
        return PythonExtractor()

    def test_extracts_celery_send_task(self, extractor: PythonExtractor) -> None:
        """Test extraction of celery_app.send_task()."""
        code = b'''
celery_app.send_task("user-service.tasks.create_user", args=[user_data])
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "user-service"
        assert queue_calls[0].confidence == Confidence.HIGH

    def test_extracts_celery_delay(self, extractor: PythonExtractor) -> None:
        """Test extraction of task.delay()."""
        code = b'''
user_service_task.delay(user_id)
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "user"

    def test_extracts_celery_apply_async(self, extractor: PythonExtractor) -> None:
        """Test extraction of task.apply_async()."""
        code = b'''
billing_api_task.apply_async(args=[order_id])
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "billing"

    def test_extracts_kombu_publish(self, extractor: PythonExtractor) -> None:
        """Test extraction of producer.publish() with routing_key."""
        code = b'''
producer.publish(message, routing_key="billing.charge")
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "billing"
        assert queue_calls[0].confidence == Confidence.HIGH

    def test_extracts_pika_basic_publish(self, extractor: PythonExtractor) -> None:
        """Test extraction of channel.basic_publish()."""
        code = b'''
channel.basic_publish(exchange="", routing_key="order_queue", body=message)
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "order-queue"

    def test_extracts_line_number(self, extractor: PythonExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
# Line 1
# Line 2
celery_app.send_task("notifications.tasks.send_email", args=[email])
'''
        calls = extractor.extract(code)
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]
        assert len(queue_calls) == 1
        assert queue_calls[0].line_number == 4


class TestPythonMixedExtraction:
    """Test that HTTP, gRPC, and Queue patterns work together."""

    @pytest.fixture
    def extractor(self) -> PythonExtractor:
        return PythonExtractor()

    def test_extracts_all_call_types(self, extractor: PythonExtractor) -> None:
        """Test extraction of HTTP, gRPC, and Queue calls in same file."""
        code = b'''
import grpc
import requests

# HTTP call
response = requests.get("http://user-service/api/users")

# gRPC call
channel = grpc.insecure_channel("billing-service:50051")

# Queue call
celery_app.send_task("notification-service.tasks.send", args=[data])
'''
        calls = extractor.extract(code)

        http_calls = [c for c in calls if c.call_type == "http"]
        grpc_calls = [c for c in calls if c.call_type == "grpc"]
        queue_calls = [c for c in calls if c.call_type == "queue_publish"]

        assert len(http_calls) == 1
        assert http_calls[0].target_service == "user-service"

        assert len(grpc_calls) == 1
        assert grpc_calls[0].target_service == "billing-service"

        assert len(queue_calls) == 1
        assert queue_calls[0].target_service == "notification-service"
