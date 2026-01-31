"""Python HTTP call extraction using tree-sitter.

Detects HTTP client calls: requests, httpx, aiohttp.
"""

from __future__ import annotations

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


class PythonExtractor:
    """Extracts service calls from Python source code."""

    language = "python"

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_python.language())
        self._patterns: list[PatternMatcher] = [
            PythonHttpPattern(),  # type: ignore[list-item]
            # PythonGrpcPattern(),      # Added in task 4a.3
            # PythonQueuePattern(),     # Added in task 4a.3
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
