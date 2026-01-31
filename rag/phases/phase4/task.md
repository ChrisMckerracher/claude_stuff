# Phase 4: Service Extraction & Linking

## Current Status

**Progress: 4/12 tasks complete (33%)**
**Tests: 64 passing**
**Last Updated: 2026-01-31**

| Sub-Phase | Status | Notes |
|-----------|--------|-------|
| 4a | ⚠️ 2/3 | HTTP done, gRPC/Queue pending |
| 4b | ⏳ 0/3 | Multi-language not started |
| 4c | ⚠️ 1/2 | InMemory done, SQLite pending |
| 4d | ⏳ 0/1 | FastAPI not started |
| 4e | ✅ 1/1 | Complete |
| 4f | ⏳ 0/2 | Framework patterns not started |

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
- [ ] Task 4a.3: Python gRPC & Queue Patterns *(task file missing)*

### 4b: Multi-Language Extraction
- [ ] Task 4b.1: Go Extractor *(task file missing)*
- [ ] Task 4b.2: TypeScript Extractor *(task file missing)*
- [ ] Task 4b.3: C# Extractor *(task file missing)*

### 4c: Route Registry
- [x] [Task 4c.1: Registry Protocol & InMemory](task4c_1.md)
- [ ] Task 4c.2: SQLite Registry *(task file missing)*

### 4d: FastAPI Route Extraction
- [ ] Task 4d.1: FastAPI Pattern *(task file missing)*

### 4e: Call Linker
- [x] [Task 4e.1: Call Linker Implementation](task4e_1.md)

### 4f: Other Framework Patterns
- [ ] Task 4f.1: Flask & Express Patterns *(task file missing)*
- [ ] Task 4f.2: Gin & ASP.NET Patterns *(task file missing)*

## Verification Checklist

### Phase 4a Done
- [x] Python HTTP calls detected (requests, httpx, aiohttp)
- [x] Confidence levels correct (HIGH/MEDIUM/LOW)
- [x] Comments and docstrings ignored
- [x] Quick check: `python -c "from rag.extractors import PythonExtractor; ..."`

### Phase 4b Done
- [ ] Go HTTP calls detected (http.Get, client.Do)
- [ ] TypeScript calls detected (fetch, axios)
- [ ] C# calls detected (HttpClient)

### Phase 4c Done
- [x] RouteRegistry protocol defined
- [ ] SQLiteRegistry persists routes
- [x] find_route_by_request matches parameterized paths

### Phase 4d Done
- [ ] FastAPI @router.get/post decorators detected
- [ ] Route path and handler function extracted

### Phase 4e Done
- [x] CallLinker links calls to handlers
- [x] Miss reasons tracked (no_routes, method_mismatch, path_mismatch)

### Phase 4f Done
- [ ] Flask, Gin, Express, ASP.NET patterns work
- [ ] End-to-end fixture test passes

## Quick Check (Current State - InMemory)

```bash
uv run python -c "
from rag.extractors import PythonExtractor
from rag.extractors.registry import InMemoryRegistry, RouteDefinition
from rag.extractors.linker import CallLinker
from rag.extractors.base import ServiceCall

# Test Python extraction
code = b'requests.get(\"http://user-service/api/users\")'
calls = PythonExtractor().extract(code)
assert len(calls) == 1 and calls[0].target_service == 'user-service'

# Test registry + linker (InMemory)
registry = InMemoryRegistry()
registry.add_routes('user-service', [
    RouteDefinition('user-service', 'GET', '/api/users/{id}', 'controller.py', 'get_user', 10)
])
linker = CallLinker(registry)
call = ServiceCall('auth.py', 'user-service', 'http', 5, 0.9, 'GET', '/api/users/123', None)
result = linker.link(call)
assert result.linked

print('QUICK CHECK PASSED: Phase 4 core components work')
"
```

## Quick Check (Full Phase 4 - requires SQLiteRegistry)

```bash
uv run python -c "
from rag.extractors import PythonExtractor, CallLinker, SQLiteRegistry, RouteDefinition, ServiceCall
import tempfile, os

# Test Python extraction
code = b'requests.get(\"http://user-service/api/users\")'
calls = PythonExtractor().extract(code)
assert len(calls) == 1 and calls[0].target_service == 'user-service'

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

print('QUICK CHECK PASSED: Full Phase 4 works')
"
```

## Prerequisites

- Phase 0-3 complete
- tree-sitter language bindings installed

## Next Phase

Upon completion, proceed to [Phase 5: Retrieval Layer](../phase5/task.md)
