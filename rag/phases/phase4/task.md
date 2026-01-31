# Phase 4: Service Extraction & Linking

## Current Status

**Progress: 12/12 tasks complete (100%) ✅**
**Tests: 181 passing**
**Last Updated: 2026-01-31**

| Sub-Phase | Status | Notes |
|-----------|--------|-------|
| 4a | ✅ 3/3 | HTTP, gRPC, Queue patterns complete |
| 4b | ✅ 3/3 | Go, TypeScript, C# extractors complete |
| 4c | ✅ 2/2 | InMemory + SQLite complete |
| 4d | ✅ 1/1 | FastAPI route extraction complete |
| 4e | ✅ 1/1 | Call linker complete |
| 4f | ✅ 2/2 | Flask, Express, Gin, ASP.NET complete |

---

## Overview

**Deliverable:** Multi-language service call extraction, route registry, and call-to-handler linking.

**Custom Code:** ~750 lines (largest phase - split into 6 sub-phases)

**Dependencies:** tree-sitter for AST parsing, SQLite for route registry

**Why Split?** The original 750-line Phase 4 is 3-4 hours of vibe coding. Splitting into 4a-4f gives:
- Testable checkpoints every 1-2 hours
- Clear rollback points
- Incremental confidence building

## Sub-Phase Breakdown

| Sub-Phase | Deliverable | Lines | Focus |
|-----------|-------------|-------|-------|
| 4a | Python Call Extraction | ~200 | HTTP, gRPC, Queue patterns in Python |
| 4b | Multi-Language Extraction | ~160 | Go, TypeScript, C# extractors |
| 4c | Route Registry | ~100 | SQLite-backed route storage |
| 4d | FastAPI Route Extraction | ~80 | FastAPI decorator parsing |
| 4e | Call Linker | ~60 | Match calls to handlers |
| 4f | Framework Patterns | ~150 | Flask, Gin, Express, ASP.NET |

## Tasks

### 4a: Python Call Extraction
- [x] [Task 4a.1: Base Types & Patterns](task4a_1.md)
- [x] [Task 4a.2: Python HTTP Extractor](task4a_2.md)
- [x] Task 4a.3: Python gRPC & Queue Patterns - `extractors/languages/python.py`

### 4b: Multi-Language Extraction
- [x] Task 4b.1: Go Extractor - `extractors/languages/go.py`
- [x] Task 4b.2: TypeScript Extractor - `extractors/languages/typescript.py`
- [x] Task 4b.3: C# Extractor - `extractors/languages/csharp.py`

### 4c: Route Registry
- [x] [Task 4c.1: Registry Protocol & InMemory](task4c_1.md)
- [x] Task 4c.2: SQLite Registry - `extractors/registry.py:SQLiteRegistry`

### 4d: FastAPI Route Extraction
- [x] Task 4d.1: FastAPI Pattern - `extractors/routes/python_routes.py`

### 4e: Call Linker
- [x] [Task 4e.1: Call Linker Implementation](task4e_1.md)

### 4f: Other Framework Patterns
- [x] Task 4f.1: Flask & Express Patterns - `extractors/routes/`
- [x] Task 4f.2: Gin & ASP.NET Patterns - `extractors/routes/`

## Verification Checklist

### Phase 4a Done ✅
- [x] Python HTTP calls detected (requests, httpx, aiohttp)
- [x] Python gRPC calls detected (grpc.insecure_channel, grpc.secure_channel)
- [x] Python Queue calls detected (Celery, Kombu, Pika)
- [x] Confidence levels correct (HIGH/MEDIUM/LOW)
- [x] Comments and docstrings ignored

### Phase 4b Done ✅
- [x] Go HTTP calls detected (http.Get, http.Post, http.NewRequest)
- [x] TypeScript calls detected (fetch, axios)
- [x] C# calls detected (HttpClient.GetAsync, PostAsync, etc.)

### Phase 4c Done ✅
- [x] RouteRegistry protocol defined
- [x] SQLiteRegistry persists routes
- [x] find_route_by_request matches parameterized paths

### Phase 4d Done ✅
- [x] FastAPI @router.get/post decorators detected
- [x] Route path and handler function extracted

### Phase 4e Done ✅
- [x] CallLinker links calls to handlers
- [x] Miss reasons tracked (no_routes, method_mismatch, path_mismatch)

### Phase 4f Done ✅
- [x] Flask @app.route decorators detected
- [x] Express app.get/post patterns detected
- [x] Gin router.GET/POST patterns detected
- [x] ASP.NET [HttpGet]/[HttpPost] attributes and MapGet/MapPost detected

## Quick Check (Full Phase 4)

```bash
uv run python -c "
from rag.extractors import (
    PythonExtractor, CallLinker, SQLiteRegistry, RouteDefinition, ServiceCall,
    FastAPIRouteExtractor, FlaskRouteExtractor, ExpressRouteExtractor,
    GinRouteExtractor, AspNetRouteExtractor
)
import tempfile, os

# Test Python HTTP extraction
code = b'requests.get(\"http://user-service/api/users\")'
calls = PythonExtractor().extract(code)
assert len(calls) == 1 and calls[0].target_service == 'user-service'
print('✓ Python HTTP extraction')

# Test Python gRPC extraction
grpc_code = b'channel = grpc.insecure_channel(\"billing-service:50051\")'
grpc_calls = PythonExtractor().extract(grpc_code)
assert any(c.call_type == 'grpc' for c in grpc_calls)
print('✓ Python gRPC extraction')

# Test Python Queue extraction
queue_code = b'celery_app.send_task(\"orders.tasks.process\", args=[data])'
queue_calls = PythonExtractor().extract(queue_code)
assert any(c.call_type == 'queue_publish' for c in queue_calls)
print('✓ Python Queue extraction')

# Test FastAPI route extraction
fastapi_code = b'''
@app.get(\"/users/{id}\")
async def get_user(id: int): pass
'''
routes = FastAPIRouteExtractor().extract(fastapi_code, 'api.py', 'user-svc')
assert len(routes) == 1 and routes[0].method == 'GET'
print('✓ FastAPI route extraction')

# Test Flask route extraction
flask_code = b'''
@app.route(\"/orders\", methods=[\"POST\"])
def create_order(): pass
'''
routes = FlaskRouteExtractor().extract(flask_code, 'app.py', 'order-svc')
assert len(routes) == 1 and routes[0].method == 'POST'
print('✓ Flask route extraction')

# Test registry + linker
with tempfile.TemporaryDirectory() as d:
    registry = SQLiteRegistry(os.path.join(d, 'routes.db'))
    registry.add_routes('user-service', [
        RouteDefinition('user-service', 'GET', '/api/users/{id}', 'controller.py', 'get_user', 10)
    ])
    linker = CallLinker(registry)
    call = ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'GET', '/api/users/123', None)
    result = linker.link(call)
    assert result.linked
print('✓ Registry + Linker')

print()
print('QUICK CHECK PASSED: Phase 4 COMPLETE (all 12 tasks)')
"
```

## Prerequisites

- Phase 0-3 complete
- tree-sitter language bindings installed

## Next Phase

Upon completion, proceed to [Phase 5: Retrieval Layer](../phase5/task.md)
