"""Go HTTP call extraction using tree-sitter.

Detects HTTP client calls: net/http, standard library patterns.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_go

from rag.extractors.base import Confidence, PatternMatcher, ServiceCall
from rag.extractors.patterns import (
    extract_service_from_url,
    is_in_comment_or_docstring,
)


class GoHttpPattern:
    """Matches Go HTTP client calls.

    Detects:
    - http.Get/Post/Head (standard library)
    - http.NewRequest(...) with method
    - client.Get/Post/Do patterns

    TEST VECTORS - Must Match:
    --------------------------
    http.Get("http://user-service/api/users")
    -> ServiceCall(target="user-service", method="GET", confidence=HIGH)

    http.Post("http://billing-api/charge", "application/json", body)
    -> ServiceCall(target="billing-api", method="POST", confidence=HIGH)

    http.NewRequest("DELETE", "http://order-service/orders/123", nil)
    -> ServiceCall(target="order-service", method="DELETE", confidence=HIGH)

    Must NOT Match:
    ---------------
    http.ListenAndServe(...)       # Server, not client
    http.HandleFunc(...)           # Handler registration
    fmt.Println("http://...")      # String in print
    """

    HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head"}
    HTTP_PACKAGES = {"http", "client", "c", "httpClient", "httputil"}

    def match(
        self, node: tree_sitter.Node, source: bytes
    ) -> list[ServiceCall]:
        """Extract HTTP calls from AST node."""
        if node.type != "call_expression":
            return []

        # Get the function being called
        func = node.child_by_field_name("function")
        if not func:
            return []

        # Handle selector expressions like http.Get()
        if func.type == "selector_expression":
            return self._match_selector_call(node, func, source)

        return []

    def _match_selector_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match calls like http.Get(), client.Post()."""
        # Get operand.field (e.g., http.Get)
        operand = func_node.child_by_field_name("operand")
        field = func_node.child_by_field_name("field")

        if not operand or not field:
            return []

        operand_text = source[operand.start_byte : operand.end_byte].decode(
            "utf-8", errors="replace"
        )
        method_name = source[field.start_byte : field.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check for http.NewRequest pattern
        if method_name == "NewRequest":
            return self._match_new_request(call_node, source)

        # Check if this is an HTTP method call
        if method_name.lower() not in self.HTTP_METHODS:
            return []

        # Check if operand is an HTTP package/client
        if not self._is_http_client(operand_text):
            return []

        # Extract URL from first argument
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        url_info = self._extract_url_from_args(args, source, arg_index=0)
        if not url_info:
            return []

        url_str, confidence = url_info
        service, path = extract_service_from_url(url_str)

        if not service:
            return []

        return [
            ServiceCall(
                source_file="",
                target_service=service,
                call_type="http",
                line_number=call_node.start_point[0] + 1,
                confidence=confidence,
                method=method_name.upper(),  # type: ignore[arg-type]
                url_path=path,
                target_host=service,
            )
        ]

    def _match_new_request(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match http.NewRequest("METHOD", "url", body)."""
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        # Get method from first argument
        method_info = self._extract_string_arg(args, source, 0)
        if not method_info:
            return []

        method = method_info[0].strip('"').upper()
        if method not in {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"}:
            return []

        # Get URL from second argument
        url_info = self._extract_url_from_args(args, source, arg_index=1)
        if not url_info:
            return []

        url_str, confidence = url_info
        service, path = extract_service_from_url(url_str)

        if not service:
            return []

        return [
            ServiceCall(
                source_file="",
                target_service=service,
                call_type="http",
                line_number=call_node.start_point[0] + 1,
                confidence=confidence,
                method=method,  # type: ignore[arg-type]
                url_path=path,
                target_host=service,
            )
        ]

    def _is_http_client(self, operand_text: str) -> bool:
        """Check if operand is an HTTP client/package."""
        lower = operand_text.lower()
        if lower in self.HTTP_PACKAGES:
            return True
        if "client" in lower or "http" in lower:
            return True
        return False

    def _extract_string_arg(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
        index: int,
    ) -> tuple[str, float] | None:
        """Extract string at given argument index."""
        arg_count = 0
        for child in args_node.children:
            if child.type in ("interpreted_string_literal", "raw_string_literal"):
                if arg_count == index:
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    return text, Confidence.HIGH
                arg_count += 1
            elif child.type not in (",", "(", ")"):
                if arg_count == index:
                    return None
                arg_count += 1
        return None

    def _extract_url_from_args(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
        arg_index: int = 0,
    ) -> tuple[str, float] | None:
        """Extract URL string from call arguments at given index."""
        current_idx = 0
        for child in args_node.children:
            # Skip commas and parentheses
            if child.type in (",", "(", ")"):
                continue

            if current_idx == arg_index:
                if child.type in ("interpreted_string_literal", "raw_string_literal"):
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    # Strip quotes
                    url = text.strip('"').strip("`")
                    if "http://" in url or "https://" in url:
                        return url, Confidence.HIGH

                elif child.type == "binary_expression":
                    # String concatenation - fmt.Sprintf or + operator
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if "http://" in text or "https://" in text:
                        return text, Confidence.MEDIUM

                elif child.type == "call_expression":
                    # fmt.Sprintf or similar
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if "http://" in text or "https://" in text:
                        return text, Confidence.MEDIUM

                return None

            current_idx += 1

        return None


class GoExtractor:
    """Extracts service calls from Go source code."""

    language = "go"

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_go.language())
        self._patterns: list[PatternMatcher] = [
            GoHttpPattern(),  # type: ignore[list-item]
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from Go source."""
        tree = self._parser.parse(source)
        calls: list[ServiceCall] = []

        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))

        return calls

    def _walk_calls(
        self, node: tree_sitter.Node
    ) -> list[tree_sitter.Node]:
        """Yield all call expression nodes in AST."""
        result: list[tree_sitter.Node] = []
        if node.type == "call_expression":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_calls(child))
        return result

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
