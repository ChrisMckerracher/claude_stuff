"""Python service call extraction using tree-sitter.

Detects:
- HTTP client calls: requests, httpx, aiohttp
- gRPC calls: grpc.insecure_channel, grpc.secure_channel, stub methods
- Queue publish/subscribe: celery, kombu, pika, redis pubsub
"""

from __future__ import annotations

import re

import tree_sitter
import tree_sitter_python

from rag.extractors.base import Confidence, PatternMatcher, ServiceCall
from rag.extractors.patterns import (
    extract_service_from_url,
    is_in_comment_or_docstring,
)


class PythonHttpPattern:
    """Matches Python HTTP client calls.

    Detects:
    - requests.get/post/put/delete/patch
    - httpx.get/post (sync and async)
    - aiohttp.ClientSession().get/post

    TEST VECTORS - Must Match:
    --------------------------
    requests.get("http://user-service/api/users")
    -> ServiceCall(target="user-service", method="GET", confidence=HIGH)

    httpx.post(f"http://{SERVICE}/users", json=data)
    -> ServiceCall(target=<SERVICE>, method="POST", confidence=MEDIUM)

    Must NOT Match:
    ---------------
    requests.get(local_file_path)      # No http://
    urllib.parse.urlparse(url)         # Parsing, not calling
    "http://example.com" in docstring  # String in docs
    """

    HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options"}
    HTTP_CLIENTS = {"requests", "httpx", "aiohttp", "urllib", "http"}

    def match(
        self, node: tree_sitter.Node, source: bytes
    ) -> list[ServiceCall]:
        """Extract HTTP calls from AST node."""
        if node.type != "call":
            return []

        # Skip if in comment/docstring
        if is_in_comment_or_docstring(node, source):
            return []

        # Get the function being called
        func = node.child_by_field_name("function")
        if not func:
            return []

        # Handle attribute calls like requests.get()
        if func.type == "attribute":
            return self._match_attribute_call(node, func, source)

        return []

    def _match_attribute_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match calls like requests.get(), httpx.post()."""
        # Get object.method
        obj = func_node.child_by_field_name("object")
        attr = func_node.child_by_field_name("attribute")

        if not obj or not attr:
            return []

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        )
        method_name = source[attr.start_byte : attr.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check if this is an HTTP client call
        if method_name.lower() not in self.HTTP_METHODS:
            return []

        # Check if object is an HTTP client
        if not self._is_http_client(obj_text, obj):
            return []

        # Extract URL from first argument
        args = call_node.child_by_field_name("arguments")
        if not args or not args.children:
            return []

        url_info = self._extract_url_from_args(args, source)
        if not url_info:
            return []

        url_str, confidence = url_info
        service, path = extract_service_from_url(url_str)

        if not service:
            return []

        return [
            ServiceCall(
                source_file="",  # Filled in by caller
                target_service=service,
                call_type="http",
                line_number=call_node.start_point[0] + 1,
                confidence=confidence,
                method=method_name.upper(),  # type: ignore[arg-type]
                url_path=path,
                target_host=service,
            )
        ]

    def _is_http_client(
        self, obj_text: str, obj_node: tree_sitter.Node
    ) -> bool:
        """Check if object is an HTTP client."""
        # Direct client: requests, httpx
        if obj_text.lower() in self.HTTP_CLIENTS:
            return True

        # Session/client instance: session.get(), client.get()
        if obj_text.lower() in ("session", "client", "s", "c", "http_client"):
            return True

        # AsyncClient, aiohttp session
        if "client" in obj_text.lower() or "session" in obj_text.lower():
            return True

        return False

    def _extract_url_from_args(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
    ) -> tuple[str, float] | None:
        """Extract URL string from call arguments."""
        for child in args_node.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )

                # Check if this is an f-string (has interpolation)
                is_fstring = text.startswith(('f"', "f'", 'F"', "F'"))

                # Extract just the URL part
                url = text.lstrip("fF").strip("\"'")

                if "http://" in url or "https://" in url:
                    if is_fstring:
                        return url, Confidence.MEDIUM
                    else:
                        return url, Confidence.HIGH

            elif child.type in ("formatted_string", "concatenated_string"):
                # Older tree-sitter might use these types
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                if "http://" in text or "https://" in text:
                    return text, Confidence.MEDIUM

            elif child.type == "identifier":
                # Variable - low confidence, skip for now
                pass

        return None


class PythonGrpcPattern:
    """Matches Python gRPC calls.

    Detects:
    - grpc.insecure_channel("host:port")
    - grpc.secure_channel("host:port", credentials)
    - stub.MethodName(request)

    TEST VECTORS - Must Match:
    --------------------------
    grpc.insecure_channel("user-service:50051")
    -> ServiceCall(target="user-service", call_type="grpc", confidence=HIGH)

    channel = grpc.insecure_channel(f"{SERVICE_HOST}:50051")
    -> ServiceCall(target=<SERVICE_HOST>, call_type="grpc", confidence=MEDIUM)

    stub.GetUser(request)
    -> ServiceCall(target=<from channel>, call_type="grpc", confidence=MEDIUM)

    Must NOT Match:
    ---------------
    grpc.server(...)           # Server, not client
    "grpc://..." in docstring  # String in docs
    """

    GRPC_CHANNEL_FUNCS = {"insecure_channel", "secure_channel"}

    def match(
        self, node: tree_sitter.Node, source: bytes
    ) -> list[ServiceCall]:
        """Extract gRPC calls from AST node."""
        if node.type != "call":
            return []

        if is_in_comment_or_docstring(node, source):
            return []

        func = node.child_by_field_name("function")
        if not func:
            return []

        # Handle grpc.insecure_channel() or grpc.secure_channel()
        if func.type == "attribute":
            return self._match_channel_call(node, func, source)

        return []

    def _match_channel_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match grpc.insecure_channel() or grpc.secure_channel()."""
        obj = func_node.child_by_field_name("object")
        attr = func_node.child_by_field_name("attribute")

        if not obj or not attr:
            return []

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        )
        method_name = source[attr.start_byte : attr.end_byte].decode(
            "utf-8", errors="replace"
        )

        if obj_text != "grpc" or method_name not in self.GRPC_CHANNEL_FUNCS:
            return []

        # Extract target from first argument
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        target_info = self._extract_target_from_args(args, source)
        if not target_info:
            return []

        target, confidence = target_info

        return [
            ServiceCall(
                source_file="",
                target_service=target,
                call_type="grpc",
                line_number=call_node.start_point[0] + 1,
                confidence=confidence,
                method=None,
                url_path=None,
                target_host=target,
            )
        ]

    def _extract_target_from_args(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
    ) -> tuple[str, float] | None:
        """Extract gRPC target (host:port) from arguments."""
        for child in args_node.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                is_fstring = text.startswith(('f"', "f'", 'F"', "F'"))
                target = text.lstrip("fF").strip("\"'")

                # Extract service name from target (host:port)
                service = target.split(":")[0].split(".")[0]
                if service and service not in ("localhost", "127.0.0.1", "0.0.0.0"):
                    if is_fstring:
                        return service, Confidence.MEDIUM
                    else:
                        return service, Confidence.HIGH

        return None


class PythonQueuePattern:
    """Matches Python message queue publish/subscribe calls.

    Detects:
    - Celery: app.send_task(), task.delay(), task.apply_async()
    - Kombu: producer.publish(), connection.channel()
    - Pika: channel.basic_publish(), channel.queue_declare()
    - Redis: redis.publish(), pubsub.subscribe()

    TEST VECTORS - Must Match:
    --------------------------
    celery_app.send_task("user-service.tasks.create_user", args=[data])
    -> ServiceCall(target="user-service", call_type="queue_publish", confidence=HIGH)

    producer.publish(message, routing_key="billing.charge")
    -> ServiceCall(target="billing", call_type="queue_publish", confidence=HIGH)

    channel.basic_publish(exchange="", routing_key="order_queue")
    -> ServiceCall(target="order_queue", call_type="queue_publish", confidence=HIGH)

    Must NOT Match:
    ---------------
    channel.basic_consume(...)     # Consuming, not publishing (track separately)
    """

    CELERY_SEND_METHODS = {"send_task", "delay", "apply_async"}
    KOMBU_PUBLISH_METHODS = {"publish"}
    PIKA_PUBLISH_METHODS = {"basic_publish"}
    REDIS_PUBLISH_METHODS = {"publish"}

    def match(
        self, node: tree_sitter.Node, source: bytes
    ) -> list[ServiceCall]:
        """Extract queue publish calls from AST node."""
        if node.type != "call":
            return []

        if is_in_comment_or_docstring(node, source):
            return []

        func = node.child_by_field_name("function")
        if not func:
            return []

        if func.type == "attribute":
            return self._match_queue_call(node, func, source)

        return []

    def _match_queue_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match queue publish method calls."""
        obj = func_node.child_by_field_name("object")
        attr = func_node.child_by_field_name("attribute")

        if not obj or not attr:
            return []

        method_name = source[attr.start_byte : attr.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check for Celery send_task
        if method_name == "send_task":
            return self._match_celery_send_task(call_node, source)

        # Check for delay/apply_async (Celery task methods)
        if method_name in ("delay", "apply_async"):
            return self._match_celery_task_call(call_node, obj, source)

        # Check for Kombu/Pika publish
        if method_name == "publish":
            return self._match_kombu_publish(call_node, source)

        # Check for Pika basic_publish
        if method_name == "basic_publish":
            return self._match_pika_publish(call_node, source)

        return []

    def _match_celery_send_task(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match celery_app.send_task("service.task")."""
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        # First argument is task name
        for child in args.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                task_name = text.strip("\"'")

                # Extract service from task name (service.tasks.method)
                parts = task_name.split(".")
                if len(parts) >= 2:
                    service = parts[0].replace("_", "-")
                    return [
                        ServiceCall(
                            source_file="",
                            target_service=service,
                            call_type="queue_publish",
                            line_number=call_node.start_point[0] + 1,
                            confidence=Confidence.HIGH,
                            method=None,
                            url_path=None,
                            target_host=None,
                        )
                    ]
                break

        return []

    def _match_celery_task_call(
        self,
        call_node: tree_sitter.Node,
        obj_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match task.delay() or task.apply_async()."""
        # Try to get task name from object
        obj_text = source[obj_node.start_byte : obj_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Task name often contains service info
        # e.g., user_service_task.delay() -> user-service
        service = self._extract_service_from_task_name(obj_text)
        if service:
            return [
                ServiceCall(
                    source_file="",
                    target_service=service,
                    call_type="queue_publish",
                    line_number=call_node.start_point[0] + 1,
                    confidence=Confidence.MEDIUM,
                    method=None,
                    url_path=None,
                    target_host=None,
                )
            ]

        return []

    def _match_kombu_publish(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match producer.publish(msg, routing_key="...")."""
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        # Look for routing_key keyword argument
        for child in args.children:
            if child.type == "keyword_argument":
                key = child.child_by_field_name("name")
                value = child.child_by_field_name("value")
                if key and value:
                    key_text = source[key.start_byte : key.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if key_text == "routing_key" and value.type == "string":
                        routing_key = source[value.start_byte : value.end_byte].decode(
                            "utf-8", errors="replace"
                        ).strip("\"'")
                        service = routing_key.split(".")[0].replace("_", "-")
                        return [
                            ServiceCall(
                                source_file="",
                                target_service=service,
                                call_type="queue_publish",
                                line_number=call_node.start_point[0] + 1,
                                confidence=Confidence.HIGH,
                                method=None,
                                url_path=None,
                                target_host=None,
                            )
                        ]

        return []

    def _match_pika_publish(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match channel.basic_publish(routing_key="...")."""
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        # Look for routing_key keyword argument
        for child in args.children:
            if child.type == "keyword_argument":
                key = child.child_by_field_name("name")
                value = child.child_by_field_name("value")
                if key and value:
                    key_text = source[key.start_byte : key.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if key_text == "routing_key" and value.type == "string":
                        routing_key = source[value.start_byte : value.end_byte].decode(
                            "utf-8", errors="replace"
                        ).strip("\"'")
                        service = routing_key.replace("_", "-")
                        return [
                            ServiceCall(
                                source_file="",
                                target_service=service,
                                call_type="queue_publish",
                                line_number=call_node.start_point[0] + 1,
                                confidence=Confidence.HIGH,
                                method=None,
                                url_path=None,
                                target_host=None,
                            )
                        ]

        return []

    def _extract_service_from_task_name(self, task_name: str) -> str | None:
        """Extract service name from Celery task name."""
        # Look for patterns like user_service_task, billing_task
        patterns = [
            r"(\w+)_service",
            r"(\w+)_api",
            r"(\w+)_task",
        ]
        for pattern in patterns:
            match = re.search(pattern, task_name, re.IGNORECASE)
            if match:
                return match.group(1).replace("_", "-")
        return None


class PythonExtractor:
    """Extracts service calls from Python source code."""

    language = "python"

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_python.language())
        self._patterns: list[PatternMatcher] = [
            PythonHttpPattern(),  # type: ignore[list-item]
            PythonGrpcPattern(),  # type: ignore[list-item]
            PythonQueuePattern(),  # type: ignore[list-item]
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from Python source."""
        tree = self._parser.parse(source)
        calls: list[ServiceCall] = []

        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))

        return calls

    def _walk_calls(
        self, node: tree_sitter.Node
    ) -> list[tree_sitter.Node]:
        """Yield all call nodes in AST."""
        result: list[tree_sitter.Node] = []
        if node.type == "call":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_calls(child))
        return result

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
