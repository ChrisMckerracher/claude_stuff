"""C# web framework route extraction.

Extracts RouteDefinition from ASP.NET Core route definitions.
"""

from __future__ import annotations

import re

import tree_sitter
import tree_sitter_c_sharp

from rag.extractors.routes.python_routes import RouteDefinition


class AspNetRouteExtractor:
    """Extracts routes from ASP.NET Core patterns.

    Detects:
    - [HttpGet("/path")]
    - [HttpPost("/path")]
    - [Route("/path")]
    - app.MapGet("/path", handler)
    - app.MapPost("/path", handler)

    TEST VECTORS - Must Match:
    --------------------------
    [HttpGet("users/{id}")]
    public async Task<IActionResult> GetUser(int id)
    -> RouteDefinition(method="GET", path="users/{id}", handler="GetUser")

    [HttpPost("orders")]
    public IActionResult CreateOrder([FromBody] Order order)
    -> RouteDefinition(method="POST", path="orders", handler="CreateOrder")

    app.MapGet("/health", () => Results.Ok());
    -> RouteDefinition(method="GET", path="/health", handler="<anonymous>")
    """

    HTTP_ATTRIBUTES = {
        "HttpGet": "GET",
        "HttpPost": "POST",
        "HttpPut": "PUT",
        "HttpDelete": "DELETE",
        "HttpPatch": "PATCH",
    }
    MAP_METHODS = {"MapGet", "MapPost", "MapPut", "MapDelete", "MapPatch"}

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_c_sharp.language())

    def extract(
        self, source: bytes, source_file: str = "", service_name: str = ""
    ) -> list[RouteDefinition]:
        """Extract route definitions from ASP.NET source."""
        tree = self._parser.parse(source)
        routes: list[RouteDefinition] = []

        # Extract from attributes on methods
        for node in self._walk_methods(tree.root_node):
            route = self._extract_from_method(node, source, source_file, service_name)
            if route:
                routes.append(route)

        # Extract from MapGet/MapPost calls
        for node in self._walk_calls(tree.root_node):
            route = self._extract_from_map_call(node, source, source_file, service_name)
            if route:
                routes.append(route)

        return routes

    def _walk_methods(self, node: tree_sitter.Node) -> list[tree_sitter.Node]:
        """Find all method declarations and local function statements."""
        result: list[tree_sitter.Node] = []
        if node.type in ("method_declaration", "local_function_statement"):
            result.append(node)
        for child in node.children:
            result.extend(self._walk_methods(child))
        return result

    def _walk_calls(self, node: tree_sitter.Node) -> list[tree_sitter.Node]:
        """Find all invocation expressions."""
        result: list[tree_sitter.Node] = []
        if node.type == "invocation_expression":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_calls(child))
        return result

    def _extract_from_method(
        self,
        method_node: tree_sitter.Node,
        source: bytes,
        source_file: str,
        service_name: str,
    ) -> RouteDefinition | None:
        """Extract route from [HttpGet] attributed method."""
        # Look for attribute_list as child of method node
        for child in method_node.children:
            if child.type == "attribute_list":
                route_info = self._parse_http_attribute(child, source)
                if route_info:
                    method, path = route_info

                    # Get method name - try different field names
                    name_node = method_node.child_by_field_name("name")
                    if not name_node:
                        # For local_function_statement, find identifier child
                        for n in method_node.children:
                            if n.type == "identifier":
                                name_node = n
                                break

                    if not name_node:
                        return None

                    handler_name = source[name_node.start_byte : name_node.end_byte].decode(
                        "utf-8", errors="replace"
                    )

                    return RouteDefinition(
                        service_name=service_name,
                        method=method,
                        path=path,
                        source_file=source_file,
                        handler_name=handler_name,
                        line_number=method_node.start_point[0] + 1,
                    )

        return None

    def _parse_http_attribute(
        self, attr_list_node: tree_sitter.Node, source: bytes
    ) -> tuple[str, str] | None:
        """Parse [HttpGet("path")] attribute."""
        for child in attr_list_node.children:
            if child.type == "attribute":
                # Find the attribute name (identifier node)
                name_node = None
                for attr_child in child.children:
                    if attr_child.type == "identifier":
                        name_node = attr_child
                        break

                if not name_node:
                    continue

                attr_name = source[name_node.start_byte : name_node.end_byte].decode(
                    "utf-8", errors="replace"
                )

                if attr_name in self.HTTP_ATTRIBUTES:
                    method = self.HTTP_ATTRIBUTES[attr_name]
                    path = self._extract_attr_path(child, source)
                    return method, path or ""

        return None

    def _extract_attr_path(
        self, attr_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path from attribute arguments."""
        for child in attr_node.children:
            if child.type == "attribute_argument_list":
                for arg in child.children:
                    if arg.type == "attribute_argument":
                        for expr in arg.children:
                            if expr.type == "string_literal":
                                # Find string_literal_content inside the string
                                for content in expr.children:
                                    if content.type == "string_literal_content":
                                        return source[content.start_byte : content.end_byte].decode(
                                            "utf-8", errors="replace"
                                        )
                                # Fallback: get whole text minus quotes
                                text = source[expr.start_byte : expr.end_byte].decode(
                                    "utf-8", errors="replace"
                                )
                                return text.strip('"').lstrip("@")
        return None

    def _extract_from_map_call(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
        source_file: str,
        service_name: str,
    ) -> RouteDefinition | None:
        """Extract route from app.MapGet("/path", handler) call."""
        # Get function name (member access or identifier)
        func = None
        for child in call_node.children:
            if child.type == "member_access_expression":
                func = child
                break

        if not func:
            return None

        # Get the method name (MapGet, MapPost, etc.)
        name_node = func.child_by_field_name("name")
        if not name_node:
            return None

        method_name = source[name_node.start_byte : name_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        if method_name not in self.MAP_METHODS:
            return None

        # Map method name to HTTP method
        http_method = method_name.replace("Map", "").upper()

        # Extract path from arguments
        for child in call_node.children:
            if child.type == "argument_list":
                path = self._extract_map_path(child, source)
                if path:
                    handler = self._extract_map_handler(child, source)
                    return RouteDefinition(
                        service_name=service_name,
                        method=http_method,
                        path=path,
                        source_file=source_file,
                        handler_name=handler,
                        line_number=call_node.start_point[0] + 1,
                    )

        return None

    def _extract_map_path(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path from MapGet arguments."""
        for child in args_node.children:
            if child.type == "argument":
                for expr in child.children:
                    if expr.type == "string_literal":
                        text = source[expr.start_byte : expr.end_byte].decode(
                            "utf-8", errors="replace"
                        )
                        return text.strip('"')
        return None

    def _extract_map_handler(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str:
        """Extract handler from MapGet arguments."""
        arg_count = 0
        for child in args_node.children:
            if child.type == "argument":
                arg_count += 1
                if arg_count == 2:
                    # Second argument is handler
                    for expr in child.children:
                        if expr.type == "identifier":
                            return source[expr.start_byte : expr.end_byte].decode(
                                "utf-8", errors="replace"
                            )
                        elif expr.type in ("lambda_expression", "anonymous_method_expression"):
                            return "<anonymous>"
        return "<unknown>"
