"""Tests for Gin and ASP.NET route extraction (Phase 4f.2)."""

import pytest

from rag.extractors.routes import GinRouteExtractor, AspNetRouteExtractor


class TestGinRouteExtractor:
    """Test Gin framework route extraction."""

    @pytest.fixture
    def extractor(self) -> GinRouteExtractor:
        return GinRouteExtractor()

    def test_extracts_router_get(self, extractor: GinRouteExtractor) -> None:
        """Test extraction of router.GET()."""
        code = b'''
package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()
    r.GET("/users/:id", getUser)
}
'''
        routes = extractor.extract(code, "main.go", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/users/:id"
        assert routes[0].handler_name == "getUser"

    def test_extracts_router_post(self, extractor: GinRouteExtractor) -> None:
        """Test extraction of router.POST()."""
        code = b'''
package main

func main() {
    router := gin.Default()
    router.POST("/orders", createOrder)
}
'''
        routes = extractor.extract(code, "main.go", "order-service")
        assert len(routes) == 1
        assert routes[0].method == "POST"
        assert routes[0].path == "/orders"

    def test_extracts_all_http_methods(self, extractor: GinRouteExtractor) -> None:
        """Test extraction of all HTTP methods."""
        code = b'''
package main

func main() {
    r := gin.Default()
    r.GET("/resource", handler)
    r.POST("/resource", handler)
    r.PUT("/resource/:id", handler)
    r.DELETE("/resource/:id", handler)
    r.PATCH("/resource/:id", handler)
}
'''
        routes = extractor.extract(code, "main.go", "service")
        assert len(routes) == 5

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "PUT", "DELETE", "PATCH"}

    def test_extracts_group_routes(self, extractor: GinRouteExtractor) -> None:
        """Test extraction from router groups."""
        code = b'''
package main

func main() {
    r := gin.Default()
    api := r.Group("/api")
    api.GET("/users", listUsers)
    api.POST("/users", createUser)
}
'''
        routes = extractor.extract(code, "main.go", "service")
        assert len(routes) == 2

    def test_extracts_anonymous_handler(self, extractor: GinRouteExtractor) -> None:
        """Test extraction with anonymous function handler."""
        code = b'''
package main

func main() {
    r := gin.Default()
    r.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok"})
    })
}
'''
        routes = extractor.extract(code, "main.go", "service")
        assert len(routes) == 1
        assert routes[0].handler_name == "<anonymous>"

    def test_captures_line_number(self, extractor: GinRouteExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
package main

// Comment
// Another comment

func main() {
    r := gin.Default()
    r.GET("/test", testHandler)
}
'''
        routes = extractor.extract(code, "main.go", "service")
        assert len(routes) == 1
        assert routes[0].line_number == 9

    def test_handles_controller_method(self, extractor: GinRouteExtractor) -> None:
        """Test extraction with controller.Method handler."""
        code = b'''
package main

func main() {
    r := gin.Default()
    r.GET("/users", userController.List)
}
'''
        routes = extractor.extract(code, "main.go", "service")
        assert len(routes) == 1
        assert routes[0].handler_name == "userController.List"


class TestAspNetRouteExtractor:
    """Test ASP.NET Core route extraction."""

    @pytest.fixture
    def extractor(self) -> AspNetRouteExtractor:
        return AspNetRouteExtractor()

    def test_extracts_httpget_attribute(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of [HttpGet] attribute."""
        code = b'''
using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet("{id}")]
    public async Task<IActionResult> GetUser(int id)
    {
        return Ok();
    }
}
'''
        routes = extractor.extract(code, "UsersController.cs", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "{id}"
        assert routes[0].handler_name == "GetUser"

    def test_extracts_httppost_attribute(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of [HttpPost] attribute."""
        code = b'''
[HttpPost]
public IActionResult CreateUser([FromBody] User user)
{
    return Created();
}
'''
        routes = extractor.extract(code, "UsersController.cs", "user-service")
        assert len(routes) == 1
        assert routes[0].method == "POST"

    def test_extracts_all_http_attributes(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of all HTTP method attributes."""
        code = b'''
[HttpGet("resource")]
public IActionResult Get() { return Ok(); }

[HttpPost("resource")]
public IActionResult Create() { return Ok(); }

[HttpPut("resource/{id}")]
public IActionResult Update(int id) { return Ok(); }

[HttpDelete("resource/{id}")]
public IActionResult Delete(int id) { return Ok(); }

[HttpPatch("resource/{id}")]
public IActionResult Patch(int id) { return Ok(); }
'''
        routes = extractor.extract(code, "ResourceController.cs", "service")
        assert len(routes) == 5

        methods = {r.method for r in routes}
        assert methods == {"GET", "POST", "PUT", "DELETE", "PATCH"}

    def test_extracts_mapget_minimal_api(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of app.MapGet() minimal API."""
        code = b'''
var app = builder.Build();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
'''
        routes = extractor.extract(code, "Program.cs", "service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == "/health"
        assert routes[0].handler_name == "<anonymous>"

    def test_extracts_mappost_minimal_api(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of app.MapPost() minimal API."""
        code = b'''
app.MapPost("/orders", CreateOrder);
'''
        routes = extractor.extract(code, "Program.cs", "service")
        assert len(routes) == 1
        assert routes[0].method == "POST"
        assert routes[0].path == "/orders"
        assert routes[0].handler_name == "CreateOrder"

    def test_extracts_multiple_map_methods(self, extractor: AspNetRouteExtractor) -> None:
        """Test extraction of multiple Map methods."""
        code = b'''
app.MapGet("/users", GetUsers);
app.MapPost("/users", CreateUser);
app.MapPut("/users/{id}", UpdateUser);
app.MapDelete("/users/{id}", DeleteUser);
'''
        routes = extractor.extract(code, "Program.cs", "service")
        assert len(routes) == 4

    def test_captures_line_number(self, extractor: AspNetRouteExtractor) -> None:
        """Test that line number is captured."""
        code = b'''
// Comment
// Another comment

app.MapGet("/test", TestHandler);
'''
        routes = extractor.extract(code, "Program.cs", "service")
        assert len(routes) == 1
        assert routes[0].line_number == 5

    def test_handles_empty_path(self, extractor: AspNetRouteExtractor) -> None:
        """Test handling of attribute with no path."""
        code = b'''
[HttpGet]
public IActionResult Index()
{
    return Ok();
}
'''
        routes = extractor.extract(code, "HomeController.cs", "service")
        assert len(routes) == 1
        assert routes[0].method == "GET"
        assert routes[0].path == ""
