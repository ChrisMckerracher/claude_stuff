"""C# HTTP call extraction using tree-sitter.

Detects HTTP client calls: HttpClient, WebClient, RestSharp.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_c_sharp

from rag.extractors.base import Confidence, PatternMatcher, ServiceCall
from rag.extractors.patterns import (
    extract_service_from_url,
)


class CSharpHttpPattern:
    """Matches C# HTTP client calls.

    Detects:
    - HttpClient.GetAsync/PostAsync/PutAsync/DeleteAsync
    - HttpClient.GetStringAsync/GetStreamAsync
    - WebClient.DownloadString/UploadString
    - RestClient.Execute (RestSharp)

    TEST VECTORS - Must Match:
    --------------------------
    await client.GetAsync("http://user-service/api/users");
    -> ServiceCall(target="user-service", method="GET", confidence=HIGH)

    await httpClient.PostAsync("http://billing-api/charge", content);
    -> ServiceCall(target="billing-api", method="POST", confidence=HIGH)

    var result = await client.GetStringAsync($"http://{SERVICE}/users");
    -> ServiceCall(target=<SERVICE>, method="GET", confidence=MEDIUM)

    Must NOT Match:
    ---------------
    Console.WriteLine("http://...");    # String in output
    var url = "http://...";             # Variable assignment
    """

    # Map method names to HTTP methods
    METHOD_MAP = {
        "getasync": "GET",
        "getstringasync": "GET",
        "getstreamasync": "GET",
        "getbytearrayasync": "GET",
        "postasync": "POST",
        "putasync": "PUT",
        "deleteasync": "DELETE",
        "patchasync": "PATCH",
        "sendasync": "GET",  # Default for SendAsync
        # WebClient methods
        "downloadstring": "GET",
        "downloadstringasync": "GET",
        "downloaddata": "GET",
        "uploadstring": "POST",
        "uploaddata": "POST",
    }

    HTTP_CLIENTS = {
        "httpclient", "client", "http", "_client", "_httpclient",
        "webclient", "restclient", "apiclient"
    }

    def match(
        self, node: tree_sitter.Node, source: bytes
    ) -> list[ServiceCall]:
        """Extract HTTP calls from AST node."""
        if node.type != "invocation_expression":
            return []

        # Get the member being called
        func = node.child_by_field_name("function")
        if not func:
            # Try first child as function
            if node.children:
                func = node.children[0]
            else:
                return []

        # Handle member access like client.GetAsync()
        if func.type == "member_access_expression":
            return self._match_member_call(node, func, source)

        return []

    def _match_member_call(
        self,
        call_node: tree_sitter.Node,
        func_node: tree_sitter.Node,
        source: bytes,
    ) -> list[ServiceCall]:
        """Match calls like client.GetAsync(), httpClient.PostAsync()."""
        # Get expression.name (e.g., client.GetAsync)
        expression = func_node.child_by_field_name("expression")
        name = func_node.child_by_field_name("name")

        if not expression or not name:
            return []

        obj_text = source[expression.start_byte : expression.end_byte].decode(
            "utf-8", errors="replace"
        )
        method_name = source[name.start_byte : name.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check if this is an HTTP client method
        http_method = self.METHOD_MAP.get(method_name.lower())
        if not http_method:
            return []

        # Check if object looks like an HTTP client
        if not self._is_http_client(obj_text):
            return []

        # Extract URL from arguments
        args = call_node.child_by_field_name("arguments")
        if not args:
            # Try to find argument_list child
            for child in call_node.children:
                if child.type == "argument_list":
                    args = child
                    break

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
                method=http_method,  # type: ignore[arg-type]
                url_path=path,
                target_host=service,
            )
        ]

    def _is_http_client(self, obj_text: str) -> bool:
        """Check if object is an HTTP client."""
        lower = obj_text.lower()
        # Direct matches
        if lower in self.HTTP_CLIENTS:
            return True
        # Contains client/http
        if "client" in lower or "http" in lower:
            return True
        return False

    def _extract_url_from_args(
        self,
        args_node: tree_sitter.Node,
        source: bytes,
    ) -> tuple[str, float] | None:
        """Extract URL string from call arguments."""
        for child in args_node.children:
            # Regular string literal
            if child.type == "string_literal":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                # Strip quotes
                url = text.strip('"')
                if "http://" in url or "https://" in url:
                    return url, Confidence.HIGH

            # Interpolated string $"..."
            elif child.type == "interpolated_string_expression":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                if "http://" in text or "https://" in text:
                    return text, Confidence.MEDIUM

            # Verbatim string @"..."
            elif child.type == "verbatim_string_literal":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                url = text.lstrip("@").strip('"')
                if "http://" in url or "https://" in url:
                    return url, Confidence.HIGH

            # Argument node wrapping the actual value
            elif child.type == "argument":
                for subchild in child.children:
                    if subchild.type == "string_literal":
                        text = source[subchild.start_byte : subchild.end_byte].decode(
                            "utf-8", errors="replace"
                        )
                        url = text.strip('"')
                        if "http://" in url or "https://" in url:
                            return url, Confidence.HIGH
                    elif subchild.type == "interpolated_string_expression":
                        text = source[subchild.start_byte : subchild.end_byte].decode(
                            "utf-8", errors="replace"
                        )
                        if "http://" in text or "https://" in text:
                            return text, Confidence.MEDIUM

        return None


class CSharpExtractor:
    """Extracts service calls from C# source code."""

    language = "csharp"

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_c_sharp.language())
        self._patterns: list[PatternMatcher] = [
            CSharpHttpPattern(),  # type: ignore[list-item]
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        """Extract all service calls from C# source."""
        tree = self._parser.parse(source)
        calls: list[ServiceCall] = []

        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))

        return calls

    def _walk_calls(
        self, node: tree_sitter.Node
    ) -> list[tree_sitter.Node]:
        """Yield all invocation expression nodes in AST."""
        result: list[tree_sitter.Node] = []
        if node.type == "invocation_expression":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_calls(child))
        return result

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
