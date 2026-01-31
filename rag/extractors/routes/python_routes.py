"""Python web framework route extraction.

Extracts RouteDefinition from FastAPI and Flask decorators.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import tree_sitter
import tree_sitter_python


@dataclass
class RouteDefinition:
    """A route defined in a web framework."""

    service_name: str
    method: str  # GET, POST, PUT, DELETE, PATCH
    path: str  # /api/users/{id}
    source_file: str
    handler_name: str
    line_number: int


class RouteExtractor(Protocol):
    """Protocol for route extractors."""

    def extract(self, source: bytes, source_file: str, service_name: str) -> list[RouteDefinition]:
        """Extract route definitions from source code."""
        ...


class FastAPIRouteExtractor:
    """Extracts routes from FastAPI decorators.

    Detects:
    - @app.get("/path")
    - @app.post("/path")
    - @router.get("/path")
    - @router.post("/path")

    TEST VECTORS - Must Match:
    --------------------------
    @app.get("/users/{user_id}")
    async def get_user(user_id: int):
        pass
    -> RouteDefinition(method="GET", path="/users/{user_id}", handler="get_user")

    @router.post("/orders")
    def create_order(order: Order):
        pass
    -> RouteDefinition(method="POST", path="/orders", handler="create_order")
    """

    HTTP_METHODS = {"get", "post", "put", "delete", "patch", "head", "options"}
    FASTAPI_OBJECTS = {"app", "router", "api_router", "fastapi"}

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_python.language())

    def extract(
        self, source: bytes, source_file: str = "", service_name: str = ""
    ) -> list[RouteDefinition]:
        """Extract route definitions from FastAPI source."""
        tree = self._parser.parse(source)
        routes: list[RouteDefinition] = []

        for node in self._walk_decorated_functions(tree.root_node):
            route = self._extract_route(node, source, source_file, service_name)
            if route:
                routes.append(route)

        return routes

    def _walk_decorated_functions(
        self, node: tree_sitter.Node
    ) -> list[tree_sitter.Node]:
        """Find all decorated function definitions."""
        result: list[tree_sitter.Node] = []
        if node.type == "decorated_definition":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_decorated_functions(child))
        return result

    def _extract_route(
        self,
        decorated_node: tree_sitter.Node,
        source: bytes,
        source_file: str,
        service_name: str,
    ) -> RouteDefinition | None:
        """Extract route from decorated function."""
        # Find decorator and function definition
        decorator = None
        func_def = None

        for child in decorated_node.children:
            if child.type == "decorator":
                decorator = child
            elif child.type in ("function_definition", "async_function_definition"):
                func_def = child

        if not decorator or not func_def:
            return None

        # Parse decorator: @app.get("/path") or @router.post("/path")
        route_info = self._parse_decorator(decorator, source)
        if not route_info:
            return None

        method, path = route_info

        # Get handler function name
        name_node = func_def.child_by_field_name("name")
        if not name_node:
            return None

        handler_name = source[name_node.start_byte : name_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        return RouteDefinition(
            service_name=service_name,
            method=method.upper(),
            path=path,
            source_file=source_file,
            handler_name=handler_name,
            line_number=func_def.start_point[0] + 1,
        )

    def _parse_decorator(
        self, decorator_node: tree_sitter.Node, source: bytes
    ) -> tuple[str, str] | None:
        """Parse @app.get("/path") decorator."""
        # Find the call expression in the decorator
        for child in decorator_node.children:
            if child.type == "call":
                return self._parse_route_call(child, source)
        return None

    def _parse_route_call(
        self, call_node: tree_sitter.Node, source: bytes
    ) -> tuple[str, str] | None:
        """Parse app.get("/path") call."""
        func = call_node.child_by_field_name("function")
        if not func or func.type != "attribute":
            return None

        obj = func.child_by_field_name("object")
        attr = func.child_by_field_name("attribute")

        if not obj or not attr:
            return None

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        ).lower()
        method = source[attr.start_byte : attr.end_byte].decode(
            "utf-8", errors="replace"
        ).lower()

        # Check if this is a FastAPI route decorator
        if not self._is_fastapi_object(obj_text):
            return None

        if method not in self.HTTP_METHODS:
            return None

        # Extract path from first argument
        args = call_node.child_by_field_name("arguments")
        if not args:
            return None

        path = self._extract_path(args, source)
        if not path:
            return None

        return method, path

    def _is_fastapi_object(self, obj_text: str) -> bool:
        """Check if object is a FastAPI app or router."""
        lower = obj_text.lower()
        if lower in self.FASTAPI_OBJECTS:
            return True
        if "router" in lower or "app" in lower or "api" in lower:
            return True
        return False

    def _extract_path(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path string from decorator arguments."""
        for child in args_node.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                return text.strip("\"'")
        return None


class FlaskRouteExtractor:
    """Extracts routes from Flask decorators.

    Detects:
    - @app.route("/path", methods=["GET"])
    - @app.route("/path")  # defaults to GET
    - @blueprint.route("/path")

    TEST VECTORS - Must Match:
    --------------------------
    @app.route("/users/<int:user_id>", methods=["GET"])
    def get_user(user_id):
        pass
    -> RouteDefinition(method="GET", path="/users/<int:user_id>", handler="get_user")

    @bp.route("/orders", methods=["POST"])
    def create_order():
        pass
    -> RouteDefinition(method="POST", path="/orders", handler="create_order")
    """

    FLASK_OBJECTS = {"app", "blueprint", "bp", "flask", "api"}

    def __init__(self) -> None:
        self._parser = tree_sitter.Parser()
        self._parser.language = tree_sitter.Language(tree_sitter_python.language())

    def extract(
        self, source: bytes, source_file: str = "", service_name: str = ""
    ) -> list[RouteDefinition]:
        """Extract route definitions from Flask source."""
        tree = self._parser.parse(source)
        routes: list[RouteDefinition] = []

        for node in self._walk_decorated_functions(tree.root_node):
            route = self._extract_route(node, source, source_file, service_name)
            if route:
                routes.extend(route)

        return routes

    def _walk_decorated_functions(
        self, node: tree_sitter.Node
    ) -> list[tree_sitter.Node]:
        """Find all decorated function definitions."""
        result: list[tree_sitter.Node] = []
        if node.type == "decorated_definition":
            result.append(node)
        for child in node.children:
            result.extend(self._walk_decorated_functions(child))
        return result

    def _extract_route(
        self,
        decorated_node: tree_sitter.Node,
        source: bytes,
        source_file: str,
        service_name: str,
    ) -> list[RouteDefinition]:
        """Extract routes from decorated function (may have multiple methods)."""
        decorator = None
        func_def = None

        for child in decorated_node.children:
            if child.type == "decorator":
                decorator = child
            elif child.type in ("function_definition", "async_function_definition"):
                func_def = child

        if not decorator or not func_def:
            return []

        route_info = self._parse_decorator(decorator, source)
        if not route_info:
            return []

        path, methods = route_info

        name_node = func_def.child_by_field_name("name")
        if not name_node:
            return []

        handler_name = source[name_node.start_byte : name_node.end_byte].decode(
            "utf-8", errors="replace"
        )

        # Create route for each method
        return [
            RouteDefinition(
                service_name=service_name,
                method=method.upper(),
                path=path,
                source_file=source_file,
                handler_name=handler_name,
                line_number=func_def.start_point[0] + 1,
            )
            for method in methods
        ]

    def _parse_decorator(
        self, decorator_node: tree_sitter.Node, source: bytes
    ) -> tuple[str, list[str]] | None:
        """Parse @app.route("/path", methods=["GET"]) decorator."""
        for child in decorator_node.children:
            if child.type == "call":
                return self._parse_route_call(child, source)
        return None

    def _parse_route_call(
        self, call_node: tree_sitter.Node, source: bytes
    ) -> tuple[str, list[str]] | None:
        """Parse app.route("/path", methods=["GET"]) call."""
        func = call_node.child_by_field_name("function")
        if not func or func.type != "attribute":
            return None

        obj = func.child_by_field_name("object")
        attr = func.child_by_field_name("attribute")

        if not obj or not attr:
            return None

        obj_text = source[obj.start_byte : obj.end_byte].decode(
            "utf-8", errors="replace"
        ).lower()
        method_name = source[attr.start_byte : attr.end_byte].decode(
            "utf-8", errors="replace"
        ).lower()

        if not self._is_flask_object(obj_text):
            return None

        if method_name != "route":
            return None

        args = call_node.child_by_field_name("arguments")
        if not args:
            return None

        path = self._extract_path(args, source)
        if not path:
            return None

        methods = self._extract_methods(args, source)
        if not methods:
            methods = ["GET"]  # Flask default

        return path, methods

    def _is_flask_object(self, obj_text: str) -> bool:
        """Check if object is a Flask app or blueprint."""
        lower = obj_text.lower()
        if lower in self.FLASK_OBJECTS:
            return True
        if "blueprint" in lower or "app" in lower or "bp" in lower:
            return True
        return False

    def _extract_path(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> str | None:
        """Extract path string from decorator arguments."""
        for child in args_node.children:
            if child.type == "string":
                text = source[child.start_byte : child.end_byte].decode(
                    "utf-8", errors="replace"
                )
                return text.strip("\"'")
        return None

    def _extract_methods(
        self, args_node: tree_sitter.Node, source: bytes
    ) -> list[str]:
        """Extract methods from methods=["GET", "POST"] argument."""
        methods: list[str] = []

        for child in args_node.children:
            if child.type == "keyword_argument":
                key = child.child_by_field_name("name")
                value = child.child_by_field_name("value")

                if key and value:
                    key_text = source[key.start_byte : key.end_byte].decode(
                        "utf-8", errors="replace"
                    )
                    if key_text == "methods" and value.type == "list":
                        for item in value.children:
                            if item.type == "string":
                                method = source[item.start_byte : item.end_byte].decode(
                                    "utf-8", errors="replace"
                                ).strip("\"'").upper()
                                methods.append(method)

        return methods
