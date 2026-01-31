"""Go web framework route extraction.

Extracts RouteDefinition from Gin framework route definitions.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_go

from rag.extractors.routes.python_routes import RouteDefinition


class GinRouteExtractor:
    """Extracts routes from Gin framework patterns.

    Detects:
    - router.GET("/path", handler)
    - r.POST("/path", handler)
    - group.GET("/path", handler)

    TEST VECTORS - Must Match:
    --------------------------
    r.GET("/users/:id", getUser)
    -> RouteDefinition(method="GET", path="/users/:id", handler="getUser")

    router.POST("/orders", func(c *gin.Context) { ... })
    -> RouteDefinition(method="POST", path="/orders", handler="<anonymous>")

    api := router.Group("/api")
    api.GET("/health", healthCheck)
    -> RouteDefinition(method="GET", path="/health", handler="healthCheck")
    """

    HTTP_METHODS = {"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"}
    GIN_OBJECTS = {"router", "r", "engine", "gin", "group", "api", "v1", "v2"}

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_go.language())

    def extract(
        self, source: bytes, source_file: str = "", service_name: str = ""
    ) -> list[RouteDefinition]:
        """Extract route definitions from Gin source."""
        tree = self._parser.parse(source)
        routes: list[RouteDefinition] = []

        for node in self._walk_calls(tree.root_node):
            route = self._extract_route(node, source, source_file, service_name)
            if route:
                routes.append(route)

        return routes

    def _walk_calls(self, node: tree_sitter.Node) -> list[tree_sitter.Node]:
        """Find all call expressions."""
        result: list[tree_sitter.Node] = []
        if node.type == "call_expression":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_calls(child))
        return result

    def _extract_route(
        self,
        call_node: tree_sitter.Node,
        source: bytes,
        source_file: str,
        service_name: str,
    ) -> RouteDefinition | None:
        """Extract route from router.GET("/path", handler) call."""
        func = call_node.child_by_field_name("function")
        if not func or func.type != "selector_expression":
            return None

        operand = func.child_by_field_name("operand")
        field = func.child_by_field_name("field")

        if not operand or not field:
            return None

        obj_text = source[operand.start_byte : operand.end_byte].decode(
            "utf-8", errors="replace"
        )
        method = source[field.start_byte : field.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Check if this is a Gin route (method names are uppercase in Go)
        if not self._is_gin_object(obj_text):
            return None

        if method.upper() not in self.HTTP_METHODS:
            return None

        # Extract path and handler from arguments
        args = call_node.child_by_field_name("arguments")
        if not args:
            return None

        path = self._extract_path(args, source)
        if not path:
            return None

        handler = self._extract_handler(args, source)

        return RouteDefinition(
            service_name=service_name,
            method=method.upper(),
            path=path,
            source_file=source_file,
            handler_name=handler,
            line_number=call_node.start_point[0] + 1,
        )

    def _is_gin_object(self, obj_text: str) -> bool:
        """Check if object is a Gin router or group."""
        lower = obj_text.lower()
        if lower in self.GIN_OBJECTS:
            return True
        if "router" in lower or "group" in lower or "engine" in lower:
            return True
        return False

    def _extract_path(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path string from first argument."""
        for child in args_node.children:
            if child.type in ("interpreted_string_literal", "raw_string_literal"):
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                return text.strip('"').strip("`")
        return None

    def _extract_handler(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str:
        """Extract handler function name from arguments."""
        arg_count = 0
        for child in args_node.children:
            if child.type in (",", "(", ")"):
                continue

            arg_count += 1
            # Handler is typically second argument
            if arg_count == 2:
                if child.type == "identifier":
                    return source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                elif child.type == "func_literal":
                    return "<anonymous>"
                elif child.type == "selector_expression":
                    # controller.Method
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    return text

        return "<unknown>"
