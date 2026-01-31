"""Tests for Flask and Express route extraction (Phase 4f.1)."""

import pytest

from rag.extractors.routes import FlaskRouteExtractor, ExpressRouteExtractor


class TestFlaskRouteExtractor:
    """Test Flask decorator-based route extraction."""

    @pytest.fixture
    def extractor(self) -> FlaskRouteExtractor:
        return FlaskRouteExtractor()

    def test_extracts_app_route_get(self, extractor: FlaskRouteExtractor) -> None:
        """Test extraction of @app.route() with GET method."""
        code = b'''
from flask import Flask

app = Flask(__name__)

@app.route("/users/<int:user_id>", methods=["GET"])
def get_user(user_id):
    return {"user_id": user_id}
'''
        routes = extractor.extract(code, "users.py", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/users/<int:user_id>"
        assert routes[0].handler_name == "get_user"

    def test_extracts_default_get_method(self, extractor: FlaskRouteExtractor) -> None:
        """Test that missing methods defaults to GET."""
        code = b'''
@app.route("/health")
def health_check():
    return {"status": "ok"}
'''
        routes = extractor.extract(code, "health.py", "service")
        assert len(routes) == 1
        assert routes[0].method == "GET"

    def test_extracts_multiple_methods(self, extractor: FlaskRouteExtractor) -> None:
        """Test extraction of route with multiple methods."""
        code = b'''
@app.route("/resource", methods=["GET", "POST"])
def handle_resource():
    pass
'''
        routes = extractor.extract(code, "resource.py", "service")
        assert len(routes) == 2
        methods = {r.method for r in routes}
        assert methods == {"GET", "POST"}

    def test_extracts_blueprint_route(self, extractor: FlaskRouteExtractor) -> None:
        """Test extraction of blueprint routes."""
        code = b'''
from flask import Blueprint

bp = Blueprint("users", __name__)

@bp.route("/users", methods=["POST"])
def create_user():
    pass
'''
        routes = extractor.extract(code, "users.py", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "POST"
        assert routes[0].path == "/users"

    def test_extracts_multiple_routes(self, extractor: FlaskRouteExtractor) -> None:
        """Test extraction of multiple route definitions."""
        code = b'''
@app.route("/users", methods=["GET"])
def list_users():
    pass

@app.route("/users", methods=["POST"])
def create_user():
    pass

@app.route("/users/<id>", methods=["DELETE"])
def delete_user(id):
    pass
'''
        routes = extractor.extract(code, "users.py", "service")
        assert len(routes) == 3

    def test_captures_line_number(self, extractor: FlaskRouteExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
# Line 1

@app.route("/test", methods=["GET"])
def test_handler():
    pass
'''
        routes = extractor.extract(code, "test.py", "service")
        assert len(routes) == 1
        assert routes[0].line_number == 5

    def test_handles_flask_parameter_syntax(self, extractor: FlaskRouteExtractor) -> None:
        """Test Flask-specific parameter syntax."""
        code = b'''
@app.route("/items/<string:item_name>/<int:quantity>", methods=["GET"])
def get_item(item_name, quantity):
    pass
'''
        routes = extractor.extract(code, "items.py", "service")
        assert len(routes) == 1
        assert routes[0].path == "/items/<string:item_name>/<int:quantity>"


class TestExpressRouteExtractor:
    """Test Express.js route extraction."""

    @pytest.fixture
    def extractor(self) -> ExpressRouteExtractor:
        return ExpressRouteExtractor()

    def test_extracts_app_get(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction of app.get()."""
        code = b'''
const express = require("express");
const app = express();

app.get("/users/:id", getUser);
'''
        routes = extractor.extract(code, "users.ts", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/users/:id"
        assert routes[0].handler_name == "getUser"

    def test_extracts_app_post(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction of app.post()."""
        code = b'''
app.post("/orders", createOrder);
'''
        routes = extractor.extract(code, "orders.ts", "order-service")
        assert len(routes) == 1
        assert routes[0].method == "POST"
        assert routes[0].path == "/orders"

    def test_extracts_router_methods(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction from router object."""
        code = b'''
const router = express.Router();

router.get("/items", listItems);
router.post("/items", createItem);
router.delete("/items/:id", deleteItem);
'''
        routes = extractor.extract(code, "items.ts", "item-service")
        assert len(routes) == 3

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "DELETE"}

    def test_extracts_anonymous_handler(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction with anonymous arrow function handler."""
        code = b'''
app.get("/health", (req, res) => {
    res.json({ status: "ok" });
});
'''
        routes = extractor.extract(code, "health.ts", "service")
        assert len(routes) == 1
        assert routes[0].handler_name == "<anonymous>"

    def test_extracts_all_http_methods(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction of all HTTP methods."""
        code = b'''
app.get("/resource", handler);
app.post("/resource", handler);
app.put("/resource/:id", handler);
app.delete("/resource/:id", handler);
app.patch("/resource/:id", handler);
'''
        routes = extractor.extract(code, "resource.ts", "service")
        assert len(routes) == 5

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "PUT", "DELETE", "PATCH"}

    def test_captures_line_number(self, extractor: ExpressRouteExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
// Comment
// Another comment

app.get("/test", testHandler);
'''
        routes = extractor.extract(code, "test.ts", "service")
        assert len(routes) == 1
        assert routes[0].line_number == 5

    def test_handles_template_string_path(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction with template string path."""
        code = b'''
app.get(`/api/v1/users`, listUsers);
'''
        routes = extractor.extract(code, "users.ts", "service")
        assert len(routes) == 1
        assert routes[0].path == "/api/v1/users"

    def test_handles_controller_method(self, extractor: ExpressRouteExtractor) -> None:
        """Test extraction with controller.method handler."""
        code = b'''
app.get("/users", userController.list);
'''
        routes = extractor.extract(code, "users.ts", "service")
        assert len(routes) == 1
        assert routes[0].handler_name == "userController.list"
