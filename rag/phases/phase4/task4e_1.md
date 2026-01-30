# Task 4e.1: Call Linker Implementation

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement the CallLinker that matches extracted service calls to their handler routes.

## File

`rag/extractors/linker.py`

## Implementation

```python
from dataclasses import dataclass
from typing import Literal
from rag.extractors.base import ServiceCall
from rag.extractors.registry import RouteRegistry, RouteDefinition

@dataclass
class ServiceRelation:
    """A resolved call from one file to another."""
    source_file: str
    source_line: int
    target_file: str
    target_function: str
    target_line: int
    relation_type: Literal["HTTP_CALL", "GRPC_CALL", "QUEUE_PUBLISH", "QUEUE_SUBSCRIBE"]
    route_path: str | None  # For HTTP calls


@dataclass
class LinkResult:
    """Result of attempting to link a call to its handler.

    Either relation is set (success) or unlinked_call + miss_reason (failure).
    """
    relation: ServiceRelation | None
    unlinked_call: ServiceCall | None
    miss_reason: Literal["no_routes", "method_mismatch", "path_mismatch"] | None

    @property
    def linked(self) -> bool:
        """True if call was successfully linked to a handler."""
        return self.relation is not None

    @staticmethod
    def success(relation: ServiceRelation) -> "LinkResult":
        return LinkResult(relation=relation, unlinked_call=None, miss_reason=None)

    @staticmethod
    def failure(
        call: ServiceCall,
        reason: Literal["no_routes", "method_mismatch", "path_mismatch"],
    ) -> "LinkResult":
        return LinkResult(relation=None, unlinked_call=call, miss_reason=reason)


class CallLinker:
    """Links extracted service calls to their handler definitions.

    Uses RouteRegistry to find matching handlers.

    STUCK? Debug checklist:
    1. Check registry has routes for target service: registry.all_services()
    2. Print call.method and call.url_path
    3. Print route.method and route.path for comparison
    4. Verify HTTP method case matches (GET vs get)
    """

    def __init__(self, route_registry: RouteRegistry):
        """Initialize with route registry.

        Args:
            route_registry: Registry containing all known routes
        """
        self._registry = route_registry

    def link(self, call: ServiceCall) -> LinkResult:
        """Match a call to its handler.

        Args:
            call: Extracted service call to link

        Returns:
            LinkResult with either:
            - relation set (successful link)
            - unlinked_call + miss_reason (failed to link)
        """
        # Get routes for target service
        routes = self._registry.get_routes(call.target_service)

        if not routes:
            return LinkResult.failure(call, "no_routes")

        # Try to find matching route
        if call.call_type == "http" and call.url_path:
            route = self._registry.find_route_by_request(
                call.target_service,
                call.method or "GET",
                call.url_path,
            )

            if route:
                return LinkResult.success(self._make_relation(call, route))

            # Determine why no match
            return self._determine_miss_reason(call, routes)

        # Non-HTTP calls (gRPC, queue) - just check service exists
        if routes:
            # Pick first route as representative
            return LinkResult.success(ServiceRelation(
                source_file=call.source_file,
                source_line=call.line_number,
                target_file=f"{call.target_service}/",
                target_function="<service>",
                target_line=0,
                relation_type=self._call_type_to_relation(call.call_type),
                route_path=None,
            ))

        return LinkResult.failure(call, "no_routes")

    def link_batch(self, calls: list[ServiceCall]) -> list[LinkResult]:
        """Link multiple calls.

        Args:
            calls: List of service calls to link

        Returns:
            List of LinkResult in same order as input
        """
        return [self.link(call) for call in calls]

    def _make_relation(
        self,
        call: ServiceCall,
        route: RouteDefinition,
    ) -> ServiceRelation:
        """Create ServiceRelation from matched call and route."""
        return ServiceRelation(
            source_file=call.source_file,
            source_line=call.line_number,
            target_file=f"{call.target_service}/{route.handler_file}",
            target_function=route.handler_function,
            target_line=route.line_number,
            relation_type="HTTP_CALL",
            route_path=route.path,
        )

    def _determine_miss_reason(
        self,
        call: ServiceCall,
        routes: list[RouteDefinition],
    ) -> LinkResult:
        """Determine why call didn't match any route."""
        method = (call.method or "GET").upper()

        # Check if method exists at all
        method_routes = [r for r in routes if r.method.upper() == method]
        if not method_routes:
            return LinkResult.failure(call, "method_mismatch")

        # Method matches but path doesn't
        return LinkResult.failure(call, "path_mismatch")

    def _call_type_to_relation(
        self,
        call_type: str,
    ) -> Literal["HTTP_CALL", "GRPC_CALL", "QUEUE_PUBLISH", "QUEUE_SUBSCRIBE"]:
        """Convert call_type to relation_type."""
        mapping = {
            "http": "HTTP_CALL",
            "grpc": "GRPC_CALL",
            "queue_publish": "QUEUE_PUBLISH",
            "queue_subscribe": "QUEUE_SUBSCRIBE",
        }
        return mapping.get(call_type, "HTTP_CALL")
```

## Tests

```python
@pytest.fixture
def registry():
    r = InMemoryRegistry()
    r.add_routes('user-service', [
        RouteDefinition('user-service', 'GET', '/api/users/{id}', 'user_ctrl.py', 'get_user', 10),
        RouteDefinition('user-service', 'POST', '/api/users', 'user_ctrl.py', 'create_user', 20),
    ])
    r.add_routes('billing-service', [
        RouteDefinition('billing-service', 'POST', '/charge', 'billing.py', 'charge', 5),
    ])
    return r

@pytest.fixture
def linker(registry):
    return CallLinker(registry)

def test_links_exact_match(linker):
    call = ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'GET', '/api/users/123', None)
    result = linker.link(call)
    assert result.linked
    assert result.relation.target_function == 'get_user'
    assert result.relation.target_file == 'user-service/user_ctrl.py'

def test_no_routes_reason(linker):
    call = ServiceCall('auth.py', 'unknown-service', 'http', 5, 0.9, 'GET', '/api', None)
    result = linker.link(call)
    assert not result.linked
    assert result.miss_reason == 'no_routes'
    assert result.unlinked_call == call

def test_method_mismatch_reason(linker):
    call = ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'DELETE', '/api/users/123', None)
    result = linker.link(call)
    assert not result.linked
    assert result.miss_reason == 'method_mismatch'

def test_path_mismatch_reason(linker):
    call = ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'GET', '/api/orders', None)
    result = linker.link(call)
    assert not result.linked
    assert result.miss_reason == 'path_mismatch'

def test_link_batch(linker):
    calls = [
        ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'GET', '/api/users/1', None),
        ServiceCall('auth.py', 'billing-service', 'http', 10, 0.9, 'POST', '/charge', None),
    ]
    results = linker.link_batch(calls)
    assert len(results) == 2
    assert all(r.linked for r in results)
```

## Acceptance Criteria

- [ ] LinkResult tracks success/failure with reason
- [ ] CallLinker uses RouteRegistry for matching
- [ ] no_routes returned for unknown services
- [ ] method_mismatch returned for wrong HTTP method
- [ ] path_mismatch returned for unmatched paths
- [ ] Batch linking works
- [ ] ServiceRelation includes all relevant fields

## Estimated Time

35 minutes
