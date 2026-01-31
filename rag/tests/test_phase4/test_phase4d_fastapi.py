"""Tests for FastAPI route extraction (Phase 4d.1)."""

import pytest

from rag.extractors.routes import FastAPIRouteExtractor


class TestFastAPIRouteExtractor:
    """Test FastAPI decorator-based route extraction."""

    @pytest.fixture
    def extractor(self) -> FastAPIRouteExtractor:
        return FastAPIRouteExtractor()

    def test_extracts_app_get(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction of @app.get() decorator."""
        code = b'''
from fastapi import FastAPI

app = FastAPI()

@app.get("/users/{user_id}")
async def get_user(user_id: int):
    return {"user_id": user_id}
'''
        routes = extractor.extract(code, "users.py", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/users/{user_id}"
        assert routes[0].handler_name == "get_user"
        assert routes[0].service_name == "user-service"

    def test_extracts_app_post(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction of @app.post() decorator."""
        code = b'''
@app.post("/orders")
def create_order(order: Order):
    return order
'''
        routes = extractor.extract(code, "orders.py", "order-service")
        assert len(routes) == 1
        assert routes[0].method == "POST"
        assert routes[0].path == "/orders"
        assert routes[0].handler_name == "create_order"

    def test_extracts_router_get(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction of @router.get() decorator."""
        code = b'''
from fastapi import APIRouter

router = APIRouter()

@router.get("/items")
def list_items():
    return []
'''
        routes = extractor.extract(code, "items.py", "item-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/items"

    def test_extracts_multiple_routes(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction of multiple routes."""
        code = b'''
@app.get("/users")
def list_users():
    pass

@app.post("/users")
def create_user():
    pass

@app.delete("/users/{id}")
def delete_user(id: int):
    pass
'''
        routes = extractor.extract(code, "users.py", "user-service")
        assert len(routes) == 3

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "DELETE"}

    def test_extracts_all_http_methods(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction of all HTTP methods."""
        code = b'''
@app.get("/resource")
def get_resource(): pass

@app.post("/resource")
def create_resource(): pass

@app.put("/resource/{id}")
def update_resource(): pass

@app.delete("/resource/{id}")
def delete_resource(): pass

@app.patch("/resource/{id}")
def patch_resource(): pass
'''
        routes = extractor.extract(code, "resource.py", "service")
        assert len(routes) == 5

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "PUT", "DELETE", "PATCH"}

    def test_captures_line_number(self, extractor: FastAPIRouteExtractor) -> None:
        """Test that line number is captured correctly."""
        code = b'''
# Comment line 1
# Comment line 2

@app.get("/health")
def health_check():
    return {"status": "ok"}
'''
        routes = extractor.extract(code, "health.py", "service")
        assert len(routes) == 1
        assert routes[0].line_number == 6  # Function definition line

    def test_ignores_non_http_decorators(self, extractor: FastAPIRouteExtractor) -> None:
        """Test that non-HTTP decorators are ignored."""
        code = b'''
@app.on_event("startup")
async def startup():
    pass

@deprecated
def old_function():
    pass
'''
        routes = extractor.extract(code, "app.py", "service")
        assert len(routes) == 0

    def test_handles_async_functions(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction works with async functions."""
        code = b'''
@app.get("/async-endpoint")
async def async_handler():
    await some_async_operation()
    return {"result": "done"}
'''
        routes = extractor.extract(code, "async.py", "service")
        assert len(routes) == 1
        assert routes[0].handler_name == "async_handler"

    def test_handles_path_parameters(self, extractor: FastAPIRouteExtractor) -> None:
        """Test extraction handles various path parameter formats."""
        code = b'''
@app.get("/users/{user_id}/orders/{order_id}")
def get_user_order(user_id: int, order_id: int):
    pass
'''
        routes = extractor.extract(code, "orders.py", "service")
        assert len(routes) == 1
        assert routes[0].path == "/users/{user_id}/orders/{order_id}"
