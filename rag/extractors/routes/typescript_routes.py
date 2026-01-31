"""TypeScript/JavaScript web framework route extraction.

Extracts RouteDefinition from Express.js route definitions.
"""

from __future__ import annotations

import tree_sitter
import tree_sitter_typescript

from rag.extractors.routes.python_routes import RouteDefinition


class ExpressRouteExtractor:
    """Extracts routes from Express.js patterns.

    Detects:
    - app.get("/path", handler)
    - router.post("/path", handler)
    - app.use("/path", router)

    TEST VECTORS - Must Match:
    --------------------------
    app.get("/users/:id", getUser);
    -> RouteDefinition(method="GET", path="/users/:id", handler="getUser")

    router.post("/orders", (req, res) => { ... });
    -> RouteDefinition(method="POST", path="/orders", handler="<anonymous>")

    app.get("/health", healthCheck);
    -> RouteDefinition(method="GET", path="/health", handler="healthCheck")
    """

    HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options"}
    EXPRESS_OBJECTS = {"app", "router", "express", "api", "server"}

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(
            tree_sitter_typescript.language_typescript()
        )

    def extract(
        self, source: bytes, source_file: str = "", service_name: str = ""
    ) -> list[RouteDefinition]:
        """Extract route definitions from Express source."""
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
        """Extract route from app.get("/path", handler) call."""
        func = call_node.child_by_field_name("function")
        if not func or func.type != "member_expression":
            return None

        obj = func.child_by_field_name("object")
        prop = func.child_by_field_name("property")

        if not obj or not prop:
            return None

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        )
        method = source[prop.start_byte : prop.end_byte].decode(
            "utf-8", errors="replace"
        ).lower()

        # Check if this is an Express route
        if not self._is_express_object(obj_text):
            return None

        if method not in self.HTTP_METHODS:
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

    def _is_express_object(self, obj_text: str) -> bool:
        """Check if object is an Express app or router."""
        lower = obj_text.lower()
        if lower in self.EXPRESS_OBJECTS:
            return True
        if "router" in lower or "app" in lower:
            return True
        return False

    def _extract_path(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path string from first argument."""
        for child in args_node.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                return text.strip("\"'`")
            elif child.type == "template_string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                return text.strip("`")
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
                elif child.type in ("arrow_function", "function"):
                    return "<anonymous>"
                elif child.type == "member_expression":
                    # controller.method
                    text = source[child.start_byte : child.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    return text

        return "<unknown>"
