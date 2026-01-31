"""TypeScript/JavaScript HTTP call extraction using tree-sitter.

Detects HTTP client calls: fetch, axios, node http.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_typescript

from rag.extractors.base import Confidence, PatternMatcher, ServiceCall
from rag.extractors.patterns import (
    extract_service_from_url,
)


class TypeScriptHttpPattern:
    """Matches TypeScript/JavaScript HTTP client calls.

    Detects:
    - fetch("url") - browser/node fetch API
    - axios.get/post/put/delete("url")
    - http.get/request (node http module)
    - $.ajax, $.get, $.post (jQuery)

    TEST VECTORS - Must Match:
    --------------------------
    fetch("http://user-service/api/users")
    -> ServiceCall(target="user-service", method="GET", confidence=HIGH)

    axios.post("http://billing-api/charge", data)
    -> ServiceCall(target="billing-api", method="POST", confidence=HIGH)

    await fetch(`http://${SERVICE_HOST}/api/users`)
    -> ServiceCall(target=<SERVICE_HOST>, method="GET", confidence=MEDIUM)

    Must NOT Match:
    ---------------
    console.log("http://...")       # String in console
    const url = "http://..."        # Variable assignment (no call)
    """

    HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "request"}
    HTTP_CLIENTS = {"axios", "http", "https", "request", "got", "ky", "superagent"}

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

        # Handle direct fetch() calls
        if func.type == "identifier":
            return self._match_fetch_call(node, func, source)

        # Handle method calls like axios.get()
        if func.type == "member_expression":
            return self._match_member_call(node, func, source)

        return []

    def _match_fetch_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match direct fetch() calls."""
        func_name = source[func_node.start_byte : func_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        if func_name != "fetch":
            return []

        # Extract URL from first argument
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        url_info = self._extract_url_from_args(args, source)
        if not url_info:
            return []

        url_str, confidence = url_info
        service, path = extract_service_from_url(url_str)

        if not service:
            return []

        # Default method is GET for fetch
        method = "GET"

        # Check for method in options object (second argument)
        method_from_opts = self._extract_method_from_fetch_options(args, source)
        if method_from_opts:
            method = method_from_opts

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

    def _match_member_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match calls like axios.get(), http.request()."""
        # Get object.property
        obj = func_node.child_by_field_name("object")
        prop = func_node.child_by_field_name("property")

        if not obj or not prop:
            return []

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        )
        method_name = source[prop.start_byte : prop.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check if this is an HTTP client
        if not self._is_http_client(obj_text):
            return []

        # Check if this is an HTTP method
        if method_name.lower() not in self.HTTP_METHODS:
            return []

        # For 'request', try to extract method from options
        if method_name.lower() == "request":
            return self._match_request_call(call_node, source)

        # Extract URL from first argument
        args = call_node.child_by_field_name("arguments")
        if not args:
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

    def _match_request_call(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match http.request() or axios.request() with options object."""
        args = call_node.child_by_field_name("arguments")
        if not args:
            return []

        # Try to extract URL from options or first arg
        url_info = self._extract_url_from_args(args, source)
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
                method="GET",  # type: ignore[arg-type]  # Default, can't easily determine
                url_path=path,
                target_host=service,
            )
        ]

    def _is_http_client(self, obj_text: str) -> bool:
        """Check if object is an HTTP client."""
        lower = obj_text.lower()
        if lower in self.HTTP_CLIENTS:
            return True
        if "client" in lower or "http" in lower or "api" in lower:
            return True
        # jQuery patterns
        if obj_text in ("$", "jQuery"):
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
                # Strip quotes
                url = text.strip("\"'`")
                if "http://" in url or "https://" in url:
                    return url, Confidence.HIGH

            elif child.type == "template_string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                url = text.strip("`")
                if "http://" in url or "https://" in url:
                    return url, Confidence.MEDIUM

            # Check for URL in options object
            elif child.type == "object":
                url_info = self._extract_url_from_object(child, source)
                if url_info:
                    return url_info

        return None

    def _extract_url_from_object(
        self,
        obj_node: tree_sitter.Node,
        source: bytes,
    ) -> tuple[str, float] | None:
        """Extract URL from options object like { url: "..." }."""
        for child in obj_node.children:
            if child.type == "pair":
                key = child.child_by_field_name("key")
                value = child.child_by_field_name("value")
                if key and value:
                    key_text = source[key.start_byte : key.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if key_text.strip("\"'") in ("url", "baseURL", "baseUrl"):
                        if value.type == "string":
                            url = source[value.start_byte : value.end_byte].decode(
                                "utf-8", errors="replace"
                            ).strip("\"'`")
                            if "http://" in url or "https://" in url:
                                return url, Confidence.HIGH
        return None

    def _extract_method_from_fetch_options(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
    ) -> str | None:
        """Extract HTTP method from fetch options object."""
        arg_count = 0
        for child in args_node.children:
            if child.type in (",", "(", ")"):
                continue
            arg_count += 1
            # Options is second argument
            if arg_count == 2 and child.type == "object":
                for pair in child.children:
                    if pair.type == "pair":
                        key = pair.child_by_field_name("key")
                        value = pair.child_by_field_name("value")
                        if key and value:
                            key_text = source[key.start_byte : key.end_byte].decode(
                                "utf-8", errors="replace"
                            ).strip("\"'")
                            if key_text == "method":
                                method = source[value.start_byte : value.end_byte].decode(
                                    "utf-8", errors="replace"
                                ).strip("\"'").upper()
                                if method in {"GET", "POST", "PUT", "DELETE", "PATCH"}:
                                    return method
        return None


class TypeScriptExtractor:
    """Extracts service calls from TypeScript/JavaScript source code."""

    language = "typescript"

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        # Use TypeScript parser (also handles JavaScript)
        self._parser.language = tree_sitter.Language(
            tree_sitter_typescript.language_typescript()
        )
        self._patterns: list[PatternMatcher] = [
            TypeScriptHttpPattern(),  # type: ignore[list-item]
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from TypeScript/JavaScript source."""
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
