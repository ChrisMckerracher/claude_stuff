# RAG v2 Phasing Strategy

## Design Constraints

**Vibe Coding Reality:**
- Building via Claude for phone - limited ability to spin up external services
- Can't easily test Graphiti (requires Neo4j + LLM API)
- Need confidence in design BEFORE integration testing

**Pseudo Formal Verification Approach:**
- Interface-first design with explicit contracts
- Type signatures as specifications
- Dependency injection for testability
- Mock implementations for offline verification
- Control flow diagrams for each module

**Framework Decisions**

| Layer | Tool | Why |
|-------|------|-----|
| **Orchestration** | Dagster | Asset lineage, retries, observability UI, testing harness |
| **Chunking** | LlamaIndex CodeSplitter | Tree-sitter AST chunking built-in |
| **Vector Store** | LanceDB | Embedded, no server needed |
| **Graph Store** | Graphiti + Neo4j Aura | Temporal awareness, LLM entity extraction |
| **PHI Scrubbing** | Presidio | Mature, configurable PII detection |

**Architecture:**
```
Dagster Assets (orchestration + observability)
    ├── raw_code_files      → crawl repos
    ├── code_chunks         → LlamaIndex CodeSplitter
    ├── route_registry      → extract routes to SQLite (ALL services)
    ├── service_relations   → extract calls + link via registry
    ├── clean_chunks        → Presidio PHI scrubbing (post-MVP)
    ├── vector_index        → LanceDB
    └── knowledge_graph     → Graphiti
```

**What We Build Custom:**
1. `repo_crawler` asset - coordinates multiple git repos (~50 lines)
2. `service_extractor` asset - AST-based call detection + route linking (~750 lines)
   - Call detection: HTTP clients, gRPC, queues across Python/Go/TS/C#
   - Route extraction: Flask, FastAPI, Gin, Express, ASP.NET
   - RouteRegistry: SQLite-backed storage for cross-service linking
   - Linker: matches calls to handler files by path pattern
3. `phi_scrubber` asset - Presidio wrapper (~50 lines)

---

## Phase Overview

### Track A: Multi-Repo Code Graph RAG (MVP)

| Phase | Deliverable | Custom Code | Verification | Smoke Test |
|-------|-------------|-------------|--------------|------------|
| 1 | Project Setup | Dagster + deps config | `dagster dev` runs | `dagster dev` |
| 2 | Repo Crawler Asset | ~50 lines | Unit test with fixture repos | See below |
| 3 | Code Chunks Asset | ~20 lines (configure CodeSplitter) | Chunks look correct | See below |
| 4a | Python Call Extraction | ~200 lines | Unit test with Python fixtures | See below |
| 4b | Multi-language Extraction | ~160 lines (+Go, TS, C#) | One fixture per language | See below |
| 4c | Route Registry | ~100 lines (SQLite storage) | Registry CRUD tests | See below |
| 4d | FastAPI Route Extraction | ~80 lines | FastAPI fixture app | See below |
| 4e | Call Linker Integration | ~60 lines | End-to-end linking test | See below |
| 4f | Other Framework Patterns | ~150 lines (Flask, Gin, Express, ASP.NET) | One fixture per framework | See below |
| 5 | Vector Index Asset | ~30 lines (configure LanceDB) | Search returns results | See below |
| 6 | Graph Asset | ~50 lines (configure Graphiti) | Graph queries work | See below |
| 7 | Hybrid Retriever | ~100 lines | End-to-end test | See below |

**MVP Deliverable:** Working multi-repo code search with graph expansion + Dagster UI.

**Lines of Custom Code:** ~1000 (with route linking + registry)

**Why Split Phase 4?** The original 750-line Phase 4 is 3-4 hours of vibe coding. If something breaks at line 600, you've lost context. Splitting into 4a-4f gives:
- Testable checkpoints every 1-2 hours
- Clear rollback points
- Incremental confidence building

### Track B: Compliance & Conversations (Post-MVP)

| Phase | Deliverable | Custom Code | Verification |
|-------|-------------|-------------|--------------|
| 8 | PHI Scrubber Asset | ~50 lines Presidio wrapper | PII removed from output |
| 9 | Conversation Loader Asset | ~80 lines Slack/transcript | Threads parsed correctly |

---

## Service Extractor Module Breakdown

The service extractor is the largest custom component (~360 lines). Here's the full interface spec:

### File Structure
```
rag/extractors/
├── base.py          # ~30 lines - protocols and types
├── patterns.py      # ~80 lines - pattern matchers
├── extractor.py     # ~40 lines - main entry point
└── languages/
    ├── python.py    # ~60 lines
    ├── go.py        # ~50 lines
    ├── typescript.py # ~50 lines
    └── csharp.py    # ~50 lines
```

### `base.py` (~30 lines)
```python
from dataclasses import dataclass
from typing import Protocol, Literal, Iterator
import tree_sitter

class Confidence:
    """Confidence levels for extracted relationships.

    HIGH:   Exact URL match - requests.get("http://user-service/api/users")
    MEDIUM: Service name in URL - requests.get(f"{USER_SERVICE_URL}/users")
    LOW:    Inferred from variable - requests.get(service_url)
    GUESS:  Heuristic match - requests.get(url)  # comment says "user service"
    """
    HIGH = 0.9
    MEDIUM = 0.7
    LOW = 0.5
    GUESS = 0.3

@dataclass
class ServiceCall:
    """Detected inter-service communication."""
    source_file: str
    target_service: str
    call_type: Literal["http", "grpc", "queue_publish", "queue_subscribe"]
    line_number: int
    confidence: float  # Use Confidence.HIGH/MEDIUM/LOW/GUESS
    # HTTP-specific fields (None for non-HTTP calls)
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"] | None = None
    url_path: str | None = None  # /api/users/{id}
    target_host: str | None = None  # For resolving service name from URL

class PatternMatcher(Protocol):
    """Matches specific call patterns in AST nodes."""
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]: ...

class LanguageExtractor(Protocol):
    """Extracts service calls from source code in a specific language."""
    language: str
    def extract(self, source: bytes) -> list[ServiceCall]: ...
    def get_patterns(self) -> list[PatternMatcher]: ...
```

### `patterns.py` (~80 lines)
```python
class HttpCallPattern(PatternMatcher):
    """Matches HTTP client calls across languages.

    Python: requests.get/post, httpx.get, aiohttp.ClientSession
    Go: http.Get, http.Post, client.Do
    TS: fetch(), axios.get/post
    C#: HttpClient.GetAsync/PostAsync

    TEST VECTORS - Must Match:
    -------------------------
    Python:
        requests.get("http://user-service/api/users")
        → ServiceCall(target="user-service", method="GET", path="/api/users",
                      confidence=Confidence.HIGH)

        httpx.post(f"http://{SERVICE}/users", json=data)
        → ServiceCall(target=<SERVICE_value>, method="POST", path="/users",
                      confidence=Confidence.MEDIUM)

        async with aiohttp.ClientSession() as s:
            await s.get(url)
        → ServiceCall(target=<from_url>, method="GET", confidence=Confidence.LOW)

    Go:
        http.Get("http://user-service/api/users")
        → ServiceCall(target="user-service", method="GET", path="/api/users")

        resp, _ := client.Do(req)
        → ServiceCall(target=<from_req.URL>, confidence=Confidence.LOW)

    TypeScript:
        fetch("http://user-service/api/users")
        → ServiceCall(target="user-service", method="GET", path="/api/users")

        axios.post(`http://${SERVICE}/users`, data)
        → ServiceCall(target=<SERVICE>, method="POST", confidence=Confidence.MEDIUM)

    Must NOT Match:
    ---------------
        requests.get(local_file_path)      # No http://
        urllib.parse.urlparse(url)         # Parsing, not calling
        http.StatusOK                      # Constant, not call
        "http://example.com" in docstring  # String literal in docs
    """
    URL_REGEX = re.compile(r'https?://([^/:]+)')
    PATH_REGEX = re.compile(r'https?://[^/]+(/[^"\')\s]+)')

    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~30 lines: check node type, extract URL, infer service name
        ...

class GrpcCallPattern(PatternMatcher):
    """Matches gRPC client calls.

    Python: grpc.insecure_channel(), stub.Method()
    Go: grpc.Dial(), client.Method()

    TEST VECTORS - Must Match:
    -------------------------
    Python:
        channel = grpc.insecure_channel("user-service:50051")
        → ServiceCall(target="user-service", call_type="grpc", confidence=HIGH)

        stub = UserServiceStub(channel)
        response = stub.GetUser(request)
        → (channel provides target, stub.GetUser is the call)

    Go:
        conn, _ := grpc.Dial("user-service:50051", grpc.WithInsecure())
        → ServiceCall(target="user-service", call_type="grpc")

    Must NOT Match:
    ---------------
        grpc.StatusCode.OK                 # Enum, not call
        grpc.UnaryUnaryClientInterceptor   # Type, not call
    """
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~25 lines
        ...

class QueuePublishPattern(PatternMatcher):
    """Matches message queue publish operations.

    Python: channel.basic_publish(), producer.send()
    Go: channel.Publish(), producer.Produce()

    TEST VECTORS - Must Match:
    -------------------------
    Python (RabbitMQ):
        channel.basic_publish(exchange='', routing_key='user-events', body=msg)
        → ServiceCall(target="user-events", call_type="queue_publish")

    Python (Kafka):
        producer.send('user-events', value=msg)
        → ServiceCall(target="user-events", call_type="queue_publish")

    Go (RabbitMQ):
        ch.Publish("", "user-events", false, false, msg)
        → ServiceCall(target="user-events", call_type="queue_publish")

    Must NOT Match:
    ---------------
        channel.queue_declare(queue='user-events')  # Declaration, not publish
        consumer.subscribe(['user-events'])         # Subscribe, not publish
    """
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~25 lines
        ...

class QueueSubscribePattern(PatternMatcher):
    """Matches message queue subscribe operations.

    TEST VECTORS - Must Match:
    -------------------------
    Python (RabbitMQ):
        channel.basic_consume(queue='user-events', on_message_callback=handler)
        → ServiceCall(target="user-events", call_type="queue_subscribe")

    Python (Kafka):
        consumer.subscribe(['user-events', 'order-events'])
        → ServiceCall(target="user-events"), ServiceCall(target="order-events")

    Go:
        msgs, _ := ch.Consume("user-events", "", true, false, false, false, nil)
        → ServiceCall(target="user-events", call_type="queue_subscribe")
    """
    def match(self, node: tree_sitter.Node, source: bytes) -> list[ServiceCall]:
        # ~20 lines
        ...
```

### `extractor.py` (~40 lines)
```python
class ServiceExtractor:
    """Main entry point - delegates to language-specific extractors."""

    LANG_MAP = {".py": "python", ".go": "go", ".ts": "typescript", ".cs": "csharp"}

    def __init__(self):
        self._extractors: dict[str, LanguageExtractor] = {
            "python": PythonExtractor(),
            "go": GoExtractor(),
            "typescript": TypeScriptExtractor(),
            "csharp": CSharpExtractor(),
        }

    def extract_from_file(self, path: str, content: bytes) -> list[ServiceCall]:
        """Extract all service calls from a source file."""
        lang = self._detect_language(path)
        if lang not in self._extractors:
            return []
        return self._extractors[lang].extract(content)

    def extract_from_repo(self, repo_path: str) -> Iterator[ServiceCall]:
        """Extract service calls from all files in a repo."""
        for file_path, content in walk_repo_files(repo_path):
            yield from self.extract_from_file(file_path, content)

    def _detect_language(self, path: str) -> str | None:
        ext = Path(path).suffix
        return self.LANG_MAP.get(ext)
```

### `languages/python.py` (~60 lines)
```python
import tree_sitter_python

class PythonExtractor(LanguageExtractor):
    language = "python"

    # AST node types we care about
    CALL_NODES = {"call", "attribute"}

    def __init__(self):
        self._parser = tree_sitter.Parser()
        self._parser.set_language(tree_sitter_python.language())
        self._patterns = [
            HttpCallPattern(),
            GrpcCallPattern(),
            QueuePublishPattern(),
            QueueSubscribePattern(),
        ]

    def extract(self, source: bytes) -> list[ServiceCall]:
        tree = self._parser.parse(source)
        calls = []
        for node in self._walk_calls(tree.root_node):
            for pattern in self._patterns:
                calls.extend(pattern.match(node, source))
        return calls

    def _walk_calls(self, node: tree_sitter.Node) -> Iterator[tree_sitter.Node]:
        """Yield all call expression nodes."""
        if node.type in self.CALL_NODES:
            yield node
        for child in node.children:
            yield from self._walk_calls(child)

    def get_patterns(self) -> list[PatternMatcher]:
        return self._patterns
```

### `languages/go.py`, `typescript.py`, `csharp.py` (~50 lines each)
Same structure as Python, different:
- Parser: `tree_sitter_go`, `tree_sitter_typescript`, `tree_sitter_c_sharp`
- Node types: Go uses `call_expression`, TS uses `call_expression`, C# uses `invocation_expression`
- Pattern adjustments for language-specific idioms

### Line Count Summary

| File | Lines | Purpose |
|------|-------|---------|
| `base.py` | 30 | Protocols, ServiceCall dataclass |
| `patterns.py` | 80 | 4 pattern matchers |
| `extractor.py` | 40 | Main entry point, language dispatch |
| `languages/python.py` | 60 | Python AST walking |
| `languages/go.py` | 50 | Go AST walking |
| `languages/typescript.py` | 50 | TypeScript AST walking |
| `languages/csharp.py` | 50 | C# AST walking |
| **Total** | **360** | |

### Phone-Optimized File Structure

For vibe coding on phone, minimize file switching. Start with consolidated files, split later when stable:

```
rag/
├── types.py           # ALL types, protocols, schema, errors (~200 lines)
│                      # - ChunkID, RawChunk, CleanChunk, EmbeddedChunk
│                      # - ServiceCall, RouteDefinition, ServiceRelation
│                      # - VectorStore, GraphStore, Scrubber protocols
│                      # - All error types
│
├── extractors.py      # ALL extraction code (~750 lines)
│                      # - HttpCallPattern, GrpcCallPattern, QueuePatterns
│                      # - PythonExtractor, GoExtractor, etc.
│                      # - RouteExtractor, framework patterns
│                      # - RouteRegistry, SQLiteRegistry
│                      # - CallLinker
│
├── stores.py          # ALL storage implementations (~300 lines)
│                      # - LanceStore (VectorStore impl)
│                      # - MockGraphStore (testing)
│                      # - GraphitiStore (production)
│
├── retrieval.py       # Retrieval layer (~150 lines)
│                      # - HybridRetriever
│                      # - Reranker
│
├── pipeline.py        # Dagster assets + orchestration (~200 lines)
│                      # - All @asset definitions
│                      # - IngestionOrchestrator
│
└── tests/
    └── test_all.py    # ALL tests in one file (~500 lines)
                       # - Organized by # === SECTION === comments
                       # - Easy to run subset: pytest -k "test_python"
```

**Why consolidated?**
- One file open = full context visible
- No "which file was that in?" confusion
- Copy-paste between sections is easy
- Split into submodules AFTER it works

**Checkpoint markers in code:**
```python
# === CHECKPOINT: Python HTTP extraction complete ===
# Smoke test: pytest tests/test_all.py::test_python_http_calls
# Next: Add gRPC patterns

# === CHECKPOINT: Route registry complete ===
# Smoke test: pytest tests/test_all.py::test_registry_crud
# Next: Add FastAPI route extraction
```

---

## Route Extractor & Call Linking

To link `auth-service calls user-service` to the actual handler file, we need:
1. **RouteExtractor** - scans each service for route definitions
2. **Linker** - matches calls to routes by path pattern

### File Structure
```
rag/extractors/
├── ...existing files...
├── routes.py           # ~80 lines - route extraction
├── linker.py           # ~60 lines - call-to-handler linking
└── frameworks/
    ├── flask.py        # ~30 lines
    ├── fastapi.py      # ~30 lines
    ├── gin.py          # ~30 lines
    ├── express.py      # ~30 lines
    └── aspnet.py       # ~30 lines
```

### `routes.py` (~80 lines)
```python
@dataclass
class RouteDefinition:
    """A route defined in a service."""
    service: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"]
    path: str                    # /api/users/{user_id}
    handler_file: str            # src/controllers/user_controller.py
    handler_function: str        # get_user
    line_number: int

class FrameworkPattern(Protocol):
    """Extracts routes from a specific web framework."""
    def extract(self, node: tree_sitter.Node, source: bytes, file_path: str) -> list[RouteDefinition]: ...

class RouteExtractor:
    """Scans repos for route definitions across frameworks."""

    def __init__(self):
        self._patterns = {
            "python": [FlaskPattern(), FastAPIPattern()],
            "go": [GinPattern(), ChiPattern()],
            "typescript": [ExpressPattern(), NestPattern()],
            "csharp": [AspNetPattern()],
        }

    def extract_from_repo(self, repo_path: str, service_name: str) -> list[RouteDefinition]:
        """Scan all files in repo for route definitions."""
        routes = []
        for file_path, content, lang in walk_repo_files(repo_path):
            for pattern in self._patterns.get(lang, []):
                tree = parse(content, lang)
                routes.extend(pattern.extract(tree.root_node, content, file_path))

        # Attach service name to all routes
        for route in routes:
            route.service = service_name

        return routes
```

### `frameworks/fastapi.py` (~30 lines)
```python
class FastAPIPattern(FrameworkPattern):
    """Extracts routes from FastAPI decorators.

    Matches:
        @router.get("/api/users/{user_id}")
        @app.post("/api/users")
    """

    METHODS = {"get", "post", "put", "delete", "patch"}

    def extract(self, node: Node, source: bytes, file_path: str) -> list[RouteDefinition]:
        routes = []

        for decorator in self._find_decorators(node):
            method = self._get_method(decorator)  # "get", "post", etc.
            path = self._get_path_arg(decorator)   # "/api/users/{user_id}"
            func = self._get_decorated_function(decorator)

            if method and path and func:
                routes.append(RouteDefinition(
                    service="",  # Filled in by RouteExtractor
                    method=method.upper(),
                    path=path,
                    handler_file=file_path,
                    handler_function=func.name,
                    line_number=func.start_point[0],
                ))

        return routes
```

### `linker.py` (~60 lines)
```python
@dataclass
class ServiceRelation:
    """A resolved call from one file to another."""
    source_file: str
    source_line: int
    target_file: str
    target_function: str
    target_line: int
    relation_type: Literal["HTTP_CALL", "GRPC_CALL", "QUEUE_PUBLISH"]
    route_path: str | None  # For HTTP calls

class CallLinker:
    """Links extracted calls to their handler definitions."""

    def __init__(self, route_registry: dict[str, list[RouteDefinition]]):
        self._routes = route_registry  # service_name → routes

    def link(self, call: ServiceCall) -> ServiceRelation | None:
        """Match a call to its handler."""
        routes = self._routes.get(call.target_service, [])

        for route in routes:
            if self._matches(call, route):
                return ServiceRelation(
                    source_file=call.source_file,
                    source_line=call.line_number,
                    target_file=f"{call.target_service}/{route.handler_file}",
                    target_function=route.handler_function,
                    target_line=route.line_number,
                    relation_type="HTTP_CALL",
                    route_path=route.path,
                )

        # No match found - still record the call but without target file
        return ServiceRelation(
            source_file=call.source_file,
            source_line=call.line_number,
            target_file=f"{call.target_service}/<unknown>",
            target_function="<unknown>",
            target_line=0,
            relation_type="HTTP_CALL",
            route_path=call.url_path,
        )

    def _matches(self, call: ServiceCall, route: RouteDefinition) -> bool:
        """Check if call matches route pattern."""
        if call.method and call.method != route.method:
            return False

        # Convert /api/users/{user_id} → regex /api/users/[^/]+
        pattern = re.sub(r'\{[^}]+\}', r'[^/]+', route.path)
        return re.match(f"^{pattern}$", call.url_path) is not None
```

### Example Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. RouteExtractor scans user-service                                │
├─────────────────────────────────────────────────────────────────────┤
│ @router.get("/api/users/{user_id}")                                 │
│ async def get_user(user_id):                                        │
│                                                                     │
│ → RouteDefinition(service="user-service",                           │
│                   method="GET",                                     │
│                   path="/api/users/{user_id}",                      │
│                   handler_file="src/controllers/user_controller.py",│
│                   handler_function="get_user")                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 2. ServiceExtractor scans auth-service                              │
├─────────────────────────────────────────────────────────────────────┤
│ resp = httpx.get(f"http://user-service/api/users/{user_id}")        │
│                                                                     │
│ → ServiceCall(source_file="auth-service/src/auth/login.py",         │
│               target_service="user-service",                        │
│               method="GET",                                         │
│               url_path="/api/users/{user_id}")                      │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 3. CallLinker matches call to route                                 │
├─────────────────────────────────────────────────────────────────────┤
│ → ServiceRelation(                                                  │
│       source_file="auth-service/src/auth/login.py",                 │
│       target_file="user-service/src/controllers/user_controller.py",│
│       target_function="get_user",                                   │
│       relation_type="HTTP_CALL",                                    │
│       route_path="/api/users/{user_id}")                            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ 4. Graph Edge Created                                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  (auth-service/login.py) ──HTTP_CALL──> (user-service/user_ctrl.py) │
│                               │                                     │
│                    GET /api/users/{user_id}                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Updated Line Count

| File | Lines | Purpose |
|------|-------|---------|
| `routes.py` | 80 | Route extraction orchestration |
| `linker.py` | 60 | Call-to-handler matching |
| `frameworks/flask.py` | 30 | Flask route patterns |
| `frameworks/fastapi.py` | 30 | FastAPI route patterns |
| `frameworks/gin.py` | 30 | Go Gin route patterns |
| `frameworks/express.py` | 30 | Express route patterns |
| `frameworks/aspnet.py` | 30 | ASP.NET route patterns |
| **Subtotal** | **290** | Route linking |
| **+ Service Extractor** | **360** | Call detection |
| **Grand Total** | **650** | Full extraction + linking |

---

## RouteRegistry: Intermediate Storage

The RouteRegistry is a critical interface that allows us to decouple route extraction from call linking. Routes are extracted from ALL services first, stored in the registry, then calls are linked.

### Why a Registry?

**Problem:** When `auth-service` calls `user-service`, we need to know what routes `user-service` exposes. But we're processing `auth-service` first.

**Solution:** Extract routes from ALL services into a registry FIRST, then do a second pass to extract calls and link them.

### RouteRegistry Protocol

```python
# rag/extractors/registry.py (~80 lines total)

from typing import Protocol
from dataclasses import dataclass

@dataclass
class RouteDefinition:
    """A route defined in a service."""
    service: str
    method: Literal["GET", "POST", "PUT", "DELETE", "PATCH"]
    path: str                    # /api/users/{user_id}
    handler_file: str            # src/controllers/user_controller.py
    handler_function: str        # get_user
    line_number: int


class RouteRegistry(Protocol):
    """Protocol for storing and querying route definitions.

    Implementations can be in-memory (testing) or persistent (SQLite).

    Thread Safety: Implementations should be thread-safe for concurrent reads.
    Write operations (add_routes, clear) may require external synchronization.
    """

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        """Store routes for a service. Replaces existing routes for that service.

        Args:
            service: Service name (e.g., "user-service")
            routes: List of route definitions to store

        Behavior:
            - Overwrites all existing routes for the service
            - Empty list clears routes for that service
        """
        ...

    def get_routes(self, service: str) -> list[RouteDefinition]:
        """Get all routes for a service.

        Returns:
            List of routes, or empty list if service unknown.
        """
        ...

    def find_route_by_request(
        self,
        service: str,
        method: str,
        request_path: str,
    ) -> RouteDefinition | None:
        """Find a route that matches an actual HTTP request.

        Args:
            service: Target service name
            method: HTTP method (GET, POST, PUT, DELETE, PATCH)
            request_path: Actual request path, e.g., "/api/users/123"

        Returns:
            Matching RouteDefinition or None if no match.

        Matching Rules:
            - /api/users/123 matches pattern /api/users/{user_id}
            - /api/orders/456/items matches pattern /api/orders/{id}/items
            - Exact matches take priority over parameterized matches
            - Method must match exactly (case-insensitive)

        Examples:
            find_route_by_request("user-service", "GET", "/api/users/123")
            → RouteDefinition(path="/api/users/{user_id}", handler="get_user")

            find_route_by_request("user-service", "POST", "/api/users")
            → RouteDefinition(path="/api/users", handler="create_user")

            find_route_by_request("user-service", "GET", "/api/unknown")
            → None
        """
        ...

    def all_services(self) -> list[str]:
        """List all services with registered routes."""
        ...

    def clear(self, service: str | None = None) -> None:
        """Clear routes.

        Args:
            service: If provided, clear only that service. If None, clear all.
        """
        ...
```

### InMemoryRegistry (Testing)

```python
# rag/extractors/registry.py (continued)

class InMemoryRegistry(RouteRegistry):
    """In-memory implementation for testing and small datasets."""

    def __init__(self):
        self._routes: dict[str, list[RouteDefinition]] = {}

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        self._routes[service] = routes

    def get_routes(self, service: str) -> list[RouteDefinition]:
        return self._routes.get(service, [])

    def find_route_by_request(
        self,
        service: str,
        method: str,
        request_path: str,
    ) -> RouteDefinition | None:
        for route in self.get_routes(service):
            if route.method.upper() == method.upper() and self._path_matches(route.path, request_path):
                return route
        return None

    def _path_matches(self, pattern: str, request_path: str) -> bool:
        """Match pattern /api/users/{user_id} against request /api/users/123."""
        import re
        regex = re.sub(r'\{[^}]+\}', r'[^/]+', pattern)
        return re.match(f"^{regex}$", request_path) is not None

    def all_services(self) -> list[str]:
        return list(self._routes.keys())

    def clear(self, service: str | None = None) -> None:
        if service:
            self._routes.pop(service, None)
        else:
            self._routes.clear()
```

### SQLiteRegistry (Production)

```python
# rag/extractors/sqlite_registry.py (~50 lines)

import sqlite3
from contextlib import contextmanager

class SQLiteRegistry(RouteRegistry):
    """SQLite-backed registry for persistence across runs."""

    def __init__(self, db_path: str = "./data/routes.db"):
        self._db_path = db_path
        self._init_db()

    def _init_db(self):
        with self._conn() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS routes (
                    service TEXT,
                    method TEXT,
                    path TEXT,
                    handler_file TEXT,
                    handler_function TEXT,
                    line_number INTEGER,
                    PRIMARY KEY (service, method, path)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_service ON routes(service)")

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def add_routes(self, service: str, routes: list[RouteDefinition]) -> None:
        with self._conn() as conn:
            # Clear existing routes for this service
            conn.execute("DELETE FROM routes WHERE service = ?", (service,))
            # Insert new routes
            conn.executemany(
                "INSERT INTO routes VALUES (?, ?, ?, ?, ?, ?)",
                [(r.service, r.method, r.path, r.handler_file,
                  r.handler_function, r.line_number) for r in routes]
            )

    def get_routes(self, service: str) -> list[RouteDefinition]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM routes WHERE service = ?", (service,)
            ).fetchall()
            return [RouteDefinition(*row) for row in rows]

    def find_route_by_request(
        self, service: str, method: str, request_path: str
    ) -> RouteDefinition | None:
        # For pattern matching, we need to load routes and match in Python
        for route in self.get_routes(service):
            if route.method.upper() == method.upper() and self._path_matches(route.path, request_path):
                return route
        return None

    def _path_matches(self, pattern: str, request_path: str) -> bool:
        import re
        regex = re.sub(r'\{[^}]+\}', r'[^/]+', pattern)
        return re.match(f"^{regex}$", request_path) is not None

    def all_services(self) -> list[str]:
        with self._conn() as conn:
            rows = conn.execute("SELECT DISTINCT service FROM routes").fetchall()
            return [r[0] for r in rows]

    def clear(self, service: str | None = None) -> None:
        with self._conn() as conn:
            if service:
                conn.execute("DELETE FROM routes WHERE service = ?", (service,))
            else:
                conn.execute("DELETE FROM routes")
```

---

## Dagster Control Flow: Route Extraction → Call Linking

The key insight is that **routes must be extracted from ALL services BEFORE calls can be linked**. This is expressed as Dagster asset dependencies:

### Asset Dependency Graph

```
raw_code_files (all repos)
        │
        ├──────────────────────────────────┐
        │                                  │
        ▼                                  ▼
┌───────────────────┐            ┌───────────────────┐
│   route_registry  │            │   code_chunks     │
│ (extract routes,  │            │ (LlamaIndex       │
│  store in SQLite) │            │  CodeSplitter)    │
└─────────┬─────────┘            └───────────────────┘
          │
          │  depends on route_registry
          ▼
┌───────────────────┐
│ service_relations │
│ (extract calls,   │
│  link to routes)  │
└───────────────────┘
          │
          ▼
┌───────────────────┐
│ knowledge_graph   │
│ (Graphiti)        │
└───────────────────┘
```

### Dagster Asset Definitions

```python
# rag/dagster/assets.py

from dataclasses import dataclass
from dagster import asset, AssetIn, Config
from rag.extractors.routes import RouteExtractor
from rag.extractors.sqlite_registry import SQLiteRegistry
from rag.extractors.extractor import ServiceExtractor
from rag.extractors.linker import CallLinker
import asyncio


# === Typed Asset Outputs ===
# Using typed outputs ensures Dagster can validate dependencies

@dataclass
class RawCodeFilesOutput:
    """Output of raw_code_files asset."""
    files_by_service: dict[str, list[Path]]
    total_files: int

@dataclass
class RouteRegistryOutput:
    """Output of route_registry asset."""
    db_path: str
    service_count: int
    route_count: int

    def load(self) -> SQLiteRegistry:
        """Load the registry. Raises if DB doesn't exist."""
        if not Path(self.db_path).exists():
            raise FileNotFoundError(f"Route registry not found: {self.db_path}")
        return SQLiteRegistry(self.db_path)

@dataclass
class ServiceRelationsOutput:
    """Output of service_relations asset."""
    relations: list[ServiceRelation]
    linked_count: int      # Successfully linked to handler
    unlinked_count: int    # Call detected but no handler found

@dataclass
class KnowledgeGraphOutput:
    """Output of knowledge_graph asset."""
    entity_count: int
    relationship_count: int


# === Asset Definitions ===

@asset
def raw_code_files(config: Config) -> RawCodeFilesOutput:
    """Crawl all repos and return files grouped by service."""
    files_by_service = {}
    total = 0
    for repo in config.repos:
        service_name = repo.name
        files = list(crawl_repo(repo.path))
        files_by_service[service_name] = files
        total += len(files)
    return RawCodeFilesOutput(files_by_service=files_by_service, total_files=total)


@asset
def route_registry(raw_code_files: RawCodeFilesOutput) -> RouteRegistryOutput:
    """Extract routes from ALL services and store in SQLite.

    This MUST complete before service_relations can run.
    """
    db_path = "./data/routes.db"
    registry = SQLiteRegistry(db_path)
    registry.clear()  # Fresh start

    extractor = RouteExtractor()
    total_routes = 0

    for service_name, files in raw_code_files.files_by_service.items():
        routes = []
        for file_path in files:
            content = file_path.read_bytes()
            routes.extend(extractor.extract(content, str(file_path), service_name))

        registry.add_routes(service_name, routes)
        total_routes += len(routes)

    return RouteRegistryOutput(
        db_path=db_path,
        service_count=len(raw_code_files.files_by_service),
        route_count=total_routes,
    )


@asset
def service_relations(
    raw_code_files: RawCodeFilesOutput,
    route_registry: RouteRegistryOutput,
) -> ServiceRelationsOutput:
    """Extract service calls and link to handlers using the registry.

    Depends on route_registry so all routes are available before linking.
    """
    registry = route_registry.load()  # Type-safe loading
    linker = CallLinker(registry)
    extractor = ServiceExtractor()

    relations = []
    linked = 0
    unlinked = 0

    for service_name, files in raw_code_files.files_by_service.items():
        for file_path in files:
            content = file_path.read_bytes()

            # Extract raw calls
            calls = extractor.extract_from_file(str(file_path), content)

            # Link each call to its handler
            for call in calls:
                relation = linker.link(call)
                relations.append(relation)
                if relation.target_function != "<unknown>":
                    linked += 1
                else:
                    unlinked += 1

    return ServiceRelationsOutput(
        relations=relations,
        linked_count=linked,
        unlinked_count=unlinked,
    )


@asset
def knowledge_graph(service_relations: ServiceRelationsOutput) -> KnowledgeGraphOutput:
    """Write service relations to Graphiti.

    Creates edges like:
        (auth-service/login.py) --HTTP_CALL--> (user-service/user_controller.py)

    NOTE: This asset uses async internally but presents a sync interface to Dagster.
    """
    async def _ingest() -> tuple[int, int]:
        async with GraphitiStore.from_env() as graph:
            entity_count = 0
            rel_count = 0

            for rel in service_relations.relations:
                # Add source file as entity
                source_entity = await graph.add_entity(Entity(
                    type=EntityType.FILE,
                    name=rel.source_file,
                ))
                entity_count += 1

                # Add target file as entity
                target_entity = await graph.add_entity(Entity(
                    type=EntityType.FILE,
                    name=rel.target_file,
                ))
                entity_count += 1

                # Add relationship
                await graph.add_relationship(
                    source=source_entity.id,
                    target=target_entity.id,
                    rel_type=RelationType.CALLS,
                    properties={
                        "call_type": rel.relation_type,
                        "route_path": rel.route_path,
                        "source_line": rel.source_line,
                    }
                )
                rel_count += 1

            return entity_count, rel_count

    entity_count, rel_count = asyncio.run(_ingest())
    return KnowledgeGraphOutput(
        entity_count=entity_count,
        relationship_count=rel_count,
    )
```

### Execution Order Guarantee

Dagster ensures:

1. `raw_code_files` runs first (no dependencies)
2. `route_registry` runs second (depends on raw_code_files)
3. `service_relations` runs third (depends on BOTH raw_code_files AND route_registry)
4. `knowledge_graph` runs last (depends on service_relations)

**This guarantees all routes are in the registry before any calls are linked.**

### Updated Line Counts

| File | Lines | Purpose |
|------|-------|---------|
| `registry.py` | 50 | Protocol + InMemoryRegistry |
| `sqlite_registry.py` | 50 | SQLite implementation |
| **+ Existing extraction** | **650** | Service + Route extractors |
| **Grand Total** | **750** | Full extraction + linking + registry |

---

## Phase 0: Core Protocols & Types

**Deliverable:** All interfaces, types, and contracts defined. Zero implementation.

**Why First:** This is your "specification" - reviewable, verifiable by inspection, no runtime needed.

### Tasks

#### 0.1 Define Core Data Types
```python
# rag/core/types.py

@dataclass(frozen=True)
class ChunkID:
    """Immutable chunk identifier."""
    value: str  # SHA256(source_uri + byte_range)

    @staticmethod
    def from_content(source_uri: str, start: int, end: int) -> "ChunkID":
        ...

@dataclass
class RawChunk:
    """Pre-scrubbing chunk."""
    id: ChunkID
    text: str
    source_uri: str
    corpus_type: CorpusType
    byte_range: tuple[int, int]
    metadata: dict[str, Any]

@dataclass
class CleanChunk:
    """Post-scrubbing chunk, safe for storage."""
    id: ChunkID
    text: str  # PHI removed
    source_uri: str
    corpus_type: CorpusType
    context_prefix: str  # file > class > function
    metadata: dict[str, Any]
    scrub_log: list[ScrubAction]  # Audit trail

@dataclass
class EmbeddedChunk:
    """Chunk with vector embedding."""
    chunk: CleanChunk
    vector: list[float]  # 768-dim

class CorpusType(Enum):
    CODE_LOGIC = "CODE_LOGIC"
    CODE_TEST = "CODE_TEST"
    DOC_README = "DOC_README"
    DOC_DESIGN = "DOC_DESIGN"
    CONVO_SLACK = "CONVO_SLACK"
    CONVO_TRANSCRIPT = "CONVO_TRANSCRIPT"
```

**Verification:** Type checker passes, all fields documented, invariants clear.

#### 0.2 Define Storage Protocols
```python
# rag/core/protocols.py

from typing import Protocol, AsyncIterator

class VectorStore(Protocol):
    """Protocol for vector similarity search.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id.

        Idempotency:
            - Same ID + same content hash → no-op
            - Same ID + different content → raises DuplicateChunkError

        Raises:
            StorageError: Storage backend unavailable or full
            DimensionMismatchError: Vector dimension != store's configured dimension
            DuplicateChunkError: Same ID exists with different content hash
        """
        ...

    async def insert_batch(self, chunks: list[EmbeddedChunk]) -> int:
        """Batch insert. Returns count successfully inserted.

        Partial Success: Inserts as many as possible, returns count.
        Failed chunks can be identified by re-checking existence.

        Raises:
            StorageError: Storage backend unavailable (no chunks inserted)
            DimensionMismatchError: Any vector has wrong dimension (no chunks inserted)
        """
        ...

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Similarity search. Returns ranked results.

        Returns:
            List of results sorted by descending similarity score.
            Empty list if no matches (not an error).

        Raises:
            StorageError: Storage backend unavailable
            DimensionMismatchError: Query vector dimension != store's dimension
            InvalidFilterError: Filter references unknown field
        """
        ...

    async def delete(self, chunk_id: ChunkID) -> bool:
        """Delete by ID. Returns True if existed.

        Raises:
            StorageError: Storage backend unavailable
        """
        ...


class GraphStore(Protocol):
    """Protocol for knowledge graph operations.

    Thread Safety: All methods should be safe for concurrent calls.
    """

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add or update entity. Returns ID.

        Upsert Behavior:
            - If entity with same (type, name) exists → update properties
            - Otherwise → create new entity

        Raises:
            StorageError: Graph backend unavailable
        """
        ...

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add directed edge. Returns ID.

        Upsert Behavior:
            - If edge (source, target, rel_type) exists → update properties
            - Otherwise → create new edge

        Raises:
            StorageError: Graph backend unavailable
            EntityNotFoundError: Source or target entity doesn't exist
        """
        ...

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Semantic entity search.

        Returns:
            Entities matching query, ranked by relevance.
            Empty list if no matches (not an error).

        Raises:
            StorageError: Graph backend unavailable
        """
        ...

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """Graph traversal. BFS from entity.

        Returns:
            List of (entity, relationship) tuples within max_hops.
            Empty list if entity has no neighbors (not an error).

        Raises:
            StorageError: Graph backend unavailable
            EntityNotFoundError: Starting entity doesn't exist
        """
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Ingest text, extract entities via LLM. Returns extracted entities.

        Episode Semantics:
            - One episode = one semantic unit (fact, conversation thread, etc.)
            - Graphiti uses LLM to extract entities and relationships
            - Extracted entities are automatically added to the graph

        Returns:
            List of entities extracted from the text.
            May be empty if no entities detected.

        Raises:
            StorageError: Graph backend unavailable
            LLMError: Entity extraction LLM call failed
        """
        ...
```

**Verification:** Protocol completeness - can every use case be expressed?

#### 0.3 Define Processing Protocols
```python
# rag/core/protocols.py (continued)

class Chunker(Protocol):
    """Protocol for content chunking."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks from content."""
        ...


@dataclass
class ScrubResult:
    """Result of scrubbing a single chunk."""
    chunk_id: ChunkID
    clean_chunk: CleanChunk | None  # None if failed
    error: str | None  # None if successful

    @property
    def success(self) -> bool:
        return self.clean_chunk is not None


class Scrubber(Protocol):
    """Protocol for PHI removal."""

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk with audit log.

        Raises:
            ScrubError: Scrubbing failed (e.g., encoding issues, analyzer error)
        """
        ...

    def scrub_batch(self, chunks: list[RawChunk]) -> list[ScrubResult]:
        """Batch scrubbing for efficiency. Never raises.

        Returns:
            List of ScrubResult in same order as input chunks.
            Check result.success to determine if scrubbing succeeded.
            Failed chunks have result.error set.

        Error Handling:
            - Individual chunk failures don't affect other chunks
            - All chunks are attempted even if some fail
        """
        ...


class Embedder(Protocol):
    """Protocol for vector embedding."""

    def embed(self, text: str) -> list[float]:
        """Single text to vector."""
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding for efficiency."""
        ...

    @property
    def dimension(self) -> int:
        """Vector dimension (e.g., 768)."""
        ...


class Crawler(Protocol):
    """Protocol for source crawling."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield content from source."""
        ...
```

**Verification:** Interface sufficiency - every pipeline stage covered.

#### 0.4 Define Entity Schema
```python
# rag/core/schema.py

class EntityType(Enum):
    SERVICE = "Service"      # Microservice
    PERSON = "Person"        # Team member
    INCIDENT = "Incident"    # Production incident
    DECISION = "Decision"    # Architecture decision
    ENDPOINT = "Endpoint"    # API endpoint
    QUEUE = "Queue"          # Message queue
    DATABASE = "Database"    # Data store
    FILE = "File"            # Source file
    FUNCTION = "Function"    # Code function/method

class RelationType(Enum):
    CALLS = "CALLS"              # Service → Service
    PUBLISHES_TO = "PUBLISHES_TO"  # Service → Queue
    SUBSCRIBES_TO = "SUBSCRIBES_TO" # Service → Queue
    READS_FROM = "READS_FROM"    # Service → Database
    WRITES_TO = "WRITES_TO"      # Service → Database
    OWNS = "OWNS"                # Person → Service
    MENTIONS = "MENTIONS"        # Conversation → Entity
    CAUSED = "CAUSED"            # Change → Incident
    RESOLVED = "RESOLVED"        # Person → Incident
    IMPORTS = "IMPORTS"          # File → Module
    CONTAINS = "CONTAINS"        # File → Function

@dataclass
class Entity:
    id: EntityID
    type: EntityType
    name: str
    properties: dict[str, Any]
    source_refs: list[str]  # Where this entity was found

@dataclass
class Relationship:
    id: RelationshipID
    type: RelationType
    source_id: EntityID
    target_id: EntityID
    properties: dict[str, Any]
    timestamp: datetime | None
```

**Verification:** Schema completeness - all domain concepts captured.

#### 0.5 Define Error Types
```python
# rag/core/errors.py

class RAGError(Exception):
    """Base error for RAG system."""
    pass

class ChunkingError(RAGError):
    """Failed to chunk content."""
    source_uri: str
    reason: str

class ScrubError(RAGError):
    """PHI scrubbing failed."""
    chunk_id: ChunkID
    reason: str

class StorageError(RAGError):
    """Storage operation failed."""
    operation: str
    reason: str

class EmbeddingError(RAGError):
    """Embedding failed."""
    text_preview: str
    reason: str
```

**Verification:** Error taxonomy covers all failure modes.

### Phase 0 Verification Checklist

- [ ] All types are immutable or clearly mutable
- [ ] All protocols have docstrings specifying behavior
- [ ] No protocol method has side effects not mentioned in name
- [ ] Every async method that could fail has error type documented
- [ ] Entity/Relationship schema covers all design doc examples
- [ ] Type checker passes with strict mode

---

## Phase 1: Chunking Pipeline

**Deliverable:** Working chunkers for code, markdown, and conversations. Tested locally.

**Dependencies:** tree-sitter (local install), no network required.

### Tasks

#### 1.1 Token Counter
```python
# rag/chunking/token_counter.py

class TokenCounter:
    """Model-aligned token counting."""

    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
        self._tokenizer = AutoTokenizer.from_pretrained(model_name)

    def count(self, text: str) -> int:
        """Count tokens in text."""
        return len(self._tokenizer.encode(text, add_special_tokens=False))

    def truncate(self, text: str, max_tokens: int) -> str:
        """Truncate to max tokens, preserving whole words."""
        ...
```

**Tests:**
```python
def test_count_simple():
    tc = TokenCounter()
    assert tc.count("hello world") > 0

def test_count_code():
    tc = TokenCounter()
    code = "def foo(x): return x + 1"
    assert tc.count(code) == expected_token_count

def test_truncate_preserves_meaning():
    tc = TokenCounter()
    long_text = "..." * 1000
    truncated = tc.truncate(long_text, 100)
    assert tc.count(truncated) <= 100
```

**Verification:** Token counts match model's actual tokenization.

#### 1.2 AST Chunker (tree-sitter)
```python
# rag/chunking/ast_chunker.py

class ASTChunker:
    """Chunk code using tree-sitter AST."""

    SUPPORTED_LANGUAGES = {"python", "go", "typescript", "csharp"}

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = 512,
        overlap_tokens: int = 50,
    ):
        self._counter = token_counter
        self._max = max_tokens
        self._overlap = overlap_tokens
        self._parsers: dict[str, Parser] = {}

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str,
    ) -> Iterator[RawChunk]:
        """Yield chunks at function/class boundaries."""
        tree = self._parse(content, language)

        for node in self._walk_top_level(tree.root_node):
            chunk_text = content[node.start_byte:node.end_byte].decode()

            if self._counter.count(chunk_text) <= self._max:
                yield self._make_chunk(node, chunk_text, source_uri, language)
            else:
                # Split large functions
                yield from self._split_large_node(node, content, source_uri, language)

    def _walk_top_level(self, node: Node) -> Iterator[Node]:
        """Yield function/class/method nodes."""
        ...

    def _make_chunk(self, node: Node, text: str, uri: str, lang: str) -> RawChunk:
        """Create chunk with proper metadata."""
        ...
```

**Tests:**
```python
def test_chunks_at_function_boundaries():
    chunker = ASTChunker(TokenCounter())
    code = b'''
def foo():
    pass

def bar():
    pass
'''
    chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))
    assert len(chunks) == 2
    assert "foo" in chunks[0].text
    assert "bar" in chunks[1].text

def test_splits_large_functions():
    chunker = ASTChunker(TokenCounter(), max_tokens=50)
    code = b'def huge(): ' + b'x = 1\n' * 100
    chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))
    assert len(chunks) > 1
    for chunk in chunks:
        assert TokenCounter().count(chunk.text) <= 50 + 10  # Some tolerance
```

**Verification:** Chunks never exceed max tokens, boundaries align with AST.

#### 1.3 Markdown Chunker
```python
# rag/chunking/md_chunker.py

class MarkdownChunker:
    """Chunk markdown at heading boundaries."""

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = 512,
    ):
        self._counter = token_counter
        self._max = max_tokens

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks at heading boundaries."""
        text = content.decode("utf-8")
        sections = self._split_by_headings(text)

        for section in sections:
            if self._counter.count(section.text) <= self._max:
                yield self._make_chunk(section, source_uri)
            else:
                yield from self._split_large_section(section, source_uri)
```

**Verification:** Headings preserved, code blocks not split mid-block.

#### 1.4 Thread Chunker (Conversations)
```python
# rag/chunking/thread_chunker.py

class ThreadChunker:
    """Chunk conversations preserving thread context."""

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks per thread or message group."""
        messages = self._parse_messages(content)

        for thread in self._group_by_thread(messages):
            thread_text = self._format_thread(thread)

            if self._counter.count(thread_text) <= self._max:
                yield self._make_chunk(thread, source_uri)
            else:
                yield from self._split_thread(thread, source_uri)
```

**Verification:** Thread context preserved, speaker attribution maintained.

### Phase 1 Verification Checklist

- [ ] All chunkers implement Chunker protocol
- [ ] Token counts verified against model tokenizer
- [ ] No chunk exceeds max_tokens
- [ ] Chunks have valid byte ranges
- [ ] Context prefix (file > class > function) computed correctly
- [ ] Unit tests pass with real tree-sitter

---

## Phase 2: PHI Scrubbing

**Deliverable:** Working PHI scrubber with consistent pseudonymization. Testable with synthetic data.

**Dependencies:** Presidio (local), spaCy model (download once).

### Tasks

#### 2.1 Scrubber Core
```python
# rag/scrubbing/scrubber.py

class PresidioScrubber:
    """PHI scrubbing using Presidio."""

    def __init__(self, pseudonymizer: Pseudonymizer):
        self._analyzer = AnalyzerEngine()
        self._anonymizer = AnonymizerEngine()
        self._pseudonymizer = pseudonymizer

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        """Remove PHI, return clean chunk."""
        # Analyze for PII
        results = self._analyzer.analyze(
            text=chunk.text,
            entities=["PERSON", "EMAIL", "PHONE_NUMBER", "US_SSN"],
            language="en",
        )

        # Build anonymization config
        operators = self._build_operators(results)

        # Anonymize
        anonymized = self._anonymizer.anonymize(
            text=chunk.text,
            analyzer_results=results,
            operators=operators,
        )

        return CleanChunk(
            id=chunk.id,
            text=anonymized.text,
            source_uri=chunk.source_uri,
            corpus_type=chunk.corpus_type,
            context_prefix=chunk.metadata.get("context_prefix", ""),
            metadata=chunk.metadata,
            scrub_log=self._build_audit_log(results),
        )
```

**Tests:**
```python
def test_scrubs_email():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = RawChunk(text="Contact john@example.com for help", ...)
    clean = scrubber.scrub(chunk)
    assert "john@example.com" not in clean.text
    assert "@" not in clean.text or "example.com" not in clean.text

def test_scrubs_phone():
    scrubber = PresidioScrubber(Pseudonymizer())
    chunk = RawChunk(text="Call me at 555-123-4567", ...)
    clean = scrubber.scrub(chunk)
    assert "555-123-4567" not in clean.text
```

#### 2.2 Pseudonymizer (Consistent Replacement)
```python
# rag/scrubbing/pseudonymizer.py

class Pseudonymizer:
    """Consistent fake data generation."""

    def __init__(self, seed: int = 42):
        self._faker = Faker()
        self._faker.seed_instance(seed)
        self._cache: dict[str, str] = {}  # Original → Replacement

    def get_replacement(self, original: str, entity_type: str) -> str:
        """Get consistent replacement for original value."""
        cache_key = f"{entity_type}:{original}"

        if cache_key not in self._cache:
            self._cache[cache_key] = self._generate(entity_type)

        return self._cache[cache_key]

    def _generate(self, entity_type: str) -> str:
        """Generate fake data by type."""
        generators = {
            "PERSON": self._faker.name,
            "EMAIL": self._faker.email,
            "PHONE_NUMBER": self._faker.phone_number,
        }
        return generators.get(entity_type, lambda: "[REDACTED]")()
```

**Verification:** Same input always produces same output (deterministic).

### Phase 2 Verification Checklist

- [ ] All PII types from design doc detected
- [ ] Pseudonymization is deterministic (same input → same output)
- [ ] Audit log captures what was replaced
- [ ] Code identifiers NOT scrubbed (function names, etc.)
- [ ] Tests with synthetic PII pass

---

## Phase 3: LanceDB Store

**Deliverable:** Working vector store with LanceDB. Fully testable locally.

**Dependencies:** LanceDB (embedded, no server needed).

### Tasks

#### 3.1 LanceDB Store Implementation
```python
# rag/indexing/lance_store.py

class LanceStore:
    """LanceDB implementation of VectorStore protocol."""

    def __init__(self, db_path: str = "./data/lance"):
        self._db = lancedb.connect(db_path)
        self._table: Table | None = None

    async def insert(self, chunk: EmbeddedChunk) -> None:
        """Insert chunk. Idempotent on chunk.id."""
        await self._ensure_table()

        record = {
            "id": chunk.chunk.id.value,
            "text": chunk.chunk.text,
            "vector": chunk.vector,
            "source_uri": chunk.chunk.source_uri,
            "corpus_type": chunk.chunk.corpus_type.value,
            "context_prefix": chunk.chunk.context_prefix,
            **chunk.chunk.metadata,
        }

        await self._table.add([record])

    async def search(
        self,
        query_vector: list[float],
        *,
        limit: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchResult]:
        """Vector similarity search."""
        query = self._table.search(query_vector).limit(limit)

        if filters:
            query = query.where(self._build_filter(filters))

        results = await query.to_list()
        return [self._to_search_result(r) for r in results]
```

**Tests:**
```python
@pytest.fixture
def lance_store(tmp_path):
    return LanceStore(db_path=str(tmp_path / "test.lance"))

async def test_insert_and_search(lance_store):
    chunk = make_embedded_chunk("hello world", [0.1] * 768)
    await lance_store.insert(chunk)

    results = await lance_store.search([0.1] * 768, limit=1)
    assert len(results) == 1
    assert results[0].chunk.text == "hello world"

async def test_filter_by_corpus_type(lance_store):
    await lance_store.insert(make_embedded_chunk("code", corpus_type=CorpusType.CODE_LOGIC))
    await lance_store.insert(make_embedded_chunk("doc", corpus_type=CorpusType.DOC_README))

    results = await lance_store.search(
        [0.1] * 768,
        filters={"corpus_type": "CODE_LOGIC"},
    )
    assert all(r.chunk.corpus_type == CorpusType.CODE_LOGIC for r in results)
```

#### 3.2 Embedder Implementation
```python
# rag/indexing/embedder.py

class CodeRankEmbedder:
    """Embedder using CodeRankEmbed model."""

    def __init__(self, model_name: str = "jinaai/jina-embeddings-v3"):
        self._model = SentenceTransformer(model_name)

    def embed(self, text: str) -> list[float]:
        """Single text to vector."""
        return self._model.encode(text).tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Batch embedding."""
        return self._model.encode(texts).tolist()

    @property
    def dimension(self) -> int:
        return 768
```

### Phase 3 Verification Checklist

- [ ] LanceStore implements VectorStore protocol
- [ ] Insert is idempotent (same ID doesn't duplicate)
- [ ] Search returns results sorted by similarity
- [ ] Filters work correctly
- [ ] Deletion works
- [ ] Embedder dimension matches schema

---

## Phase 4: Graph Store Abstraction

**Deliverable:** GraphStore protocol + MockGraphStore. Graphiti adapter interface defined.

**Why Mocks:** This is the critical phase for vibe coding. You can't spin up Neo4j, so we build everything against mocks, then swap in real Graphiti later.

### Tasks

#### 4.1 Mock Graph Store
```python
# rag/graphiti/mock_store.py

class MockGraphStore:
    """In-memory GraphStore for testing."""

    def __init__(self):
        self._entities: dict[EntityID, Entity] = {}
        self._relationships: dict[RelationshipID, Relationship] = {}
        self._entity_index: dict[str, list[EntityID]] = {}  # name → IDs

    async def add_entity(self, entity: Entity) -> EntityID:
        """Add entity to in-memory store."""
        self._entities[entity.id] = entity
        self._entity_index.setdefault(entity.name.lower(), []).append(entity.id)
        return entity.id

    async def add_relationship(
        self,
        source: EntityID,
        target: EntityID,
        rel_type: RelationType,
        properties: dict[str, Any],
    ) -> RelationshipID:
        """Add relationship."""
        rel_id = RelationshipID(f"{source.value}-{rel_type.value}-{target.value}")
        self._relationships[rel_id] = Relationship(
            id=rel_id,
            type=rel_type,
            source_id=source,
            target_id=target,
            properties=properties,
            timestamp=datetime.now(),
        )
        return rel_id

    async def search_entities(
        self,
        query: str,
        *,
        entity_types: list[EntityType] | None = None,
        limit: int = 10,
    ) -> list[Entity]:
        """Simple substring search for testing."""
        query_lower = query.lower()
        matches = []

        for entity in self._entities.values():
            if query_lower in entity.name.lower():
                if entity_types is None or entity.type in entity_types:
                    matches.append(entity)

        return matches[:limit]

    async def get_neighbors(
        self,
        entity_id: EntityID,
        *,
        rel_types: list[RelationType] | None = None,
        direction: Literal["in", "out", "both"] = "both",
        max_hops: int = 1,
    ) -> list[tuple[Entity, Relationship]]:
        """BFS graph traversal."""
        results = []
        visited = {entity_id}
        frontier = [entity_id]

        for _ in range(max_hops):
            next_frontier = []
            for eid in frontier:
                for rel in self._relationships.values():
                    neighbor_id = None
                    if direction in ("out", "both") and rel.source_id == eid:
                        neighbor_id = rel.target_id
                    if direction in ("in", "both") and rel.target_id == eid:
                        neighbor_id = rel.source_id

                    if neighbor_id and neighbor_id not in visited:
                        if rel_types is None or rel.type in rel_types:
                            visited.add(neighbor_id)
                            next_frontier.append(neighbor_id)
                            results.append((self._entities[neighbor_id], rel))

            frontier = next_frontier

        return results

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Mock: extract entities using simple regex patterns."""
        # This is a simplified mock - real Graphiti uses LLM
        entities = []

        # Simple service detection (mock)
        service_pattern = r'\b(\w+-service|\w+-api)\b'
        for match in re.finditer(service_pattern, text):
            entity = Entity(
                id=EntityID(f"service:{match.group(1)}"),
                type=EntityType.SERVICE,
                name=match.group(1),
                properties={},
                source_refs=[source],
            )
            await self.add_entity(entity)
            entities.append(entity)

        return entities
```

**Tests:** Exhaustive protocol compliance tests.

#### 4.2 Graphiti Adapter (Interface Only)
```python
# rag/graphiti/client.py

class GraphitiStore:
    """Graphiti implementation of GraphStore protocol.

    NOTE: This requires Neo4j + LLM API to function.
    Use MockGraphStore for offline testing.
    """

    def __init__(
        self,
        neo4j_uri: str,
        neo4j_user: str,
        neo4j_password: str,
        llm_client: Any,  # OpenAI or Anthropic client
    ):
        self._graphiti = Graphiti(
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
        )
        self._graphiti.llm_client = llm_client

    async def add_entity(self, entity: Entity) -> EntityID:
        """Delegate to Graphiti."""
        # Convert our Entity to Graphiti's format
        ...

    async def add_episode(
        self,
        text: str,
        *,
        source: str,
        timestamp: datetime | None = None,
    ) -> list[Entity]:
        """Let Graphiti extract entities via LLM."""
        result = await self._graphiti.add_episode(
            name=f"episode:{hash(text)}",
            episode_body=text,
            source_description=source,
            reference_time=timestamp or datetime.now(),
        )
        return self._convert_entities(result)
```

#### 4.3 Graph Store Factory
```python
# rag/graphiti/factory.py

def create_graph_store(config: Config) -> GraphStore:
    """Factory for GraphStore implementations.

    Use mock for testing, real for production.
    """
    if config.use_mock_graph:
        return MockGraphStore()

    return GraphitiStore(
        neo4j_uri=config.neo4j_uri,
        neo4j_user=config.neo4j_user,
        neo4j_password=config.neo4j_password,
        llm_client=config.llm_client,
    )
```

### Phase 4 Verification Checklist

- [ ] MockGraphStore implements GraphStore protocol completely
- [ ] All protocol methods have test coverage
- [ ] Graph traversal (get_neighbors) works correctly
- [ ] Entity search returns expected results
- [ ] GraphitiStore interface matches protocol (may not run without Neo4j)
- [ ] Factory correctly selects implementation

---

## Phase 5: Retrieval Layer

**Deliverable:** Hybrid retrieval combining vector and graph search. Testable with mocks.

### Tasks

#### 5.1 Hybrid Retriever
```python
# rag/retrieval/hybrid.py

class HybridRetriever:
    """Combines vector and graph search."""

    def __init__(
        self,
        vector_store: VectorStore,
        graph_store: GraphStore,
        embedder: Embedder,
        reranker: Reranker | None = None,
    ):
        self._vector = vector_store
        self._graph = graph_store
        self._embedder = embedder
        self._reranker = reranker

    async def search(
        self,
        query: str,
        *,
        top_k: int = 10,
        expand_graph: bool = True,
    ) -> list[SearchResult]:
        """Hybrid search: vector + graph expansion."""

        # 1. Vector search
        query_vector = self._embedder.embed(query)
        vector_results = await self._vector.search(query_vector, limit=top_k)

        if not expand_graph:
            return vector_results[:top_k]

        # 2. Entity search
        entities = await self._graph.search_entities(query, limit=5)

        # 3. Graph expansion
        expanded_entities = []
        for entity in entities:
            neighbors = await self._graph.get_neighbors(
                entity.id,
                rel_types=[RelationType.CALLS, RelationType.OWNS, RelationType.MENTIONS],
                max_hops=2,
            )
            expanded_entities.extend([e for e, _ in neighbors])

        # 4. Fetch chunks for expanded entities
        entity_names = [e.name for e in expanded_entities]
        graph_results = await self._vector.search(
            query_vector,
            filters={"service_name": entity_names},
            limit=top_k,
        )

        # 5. Merge and rerank
        all_results = self._merge_results(vector_results, graph_results)

        if self._reranker:
            all_results = self._reranker.rerank(all_results, query)

        return all_results[:top_k]
```

#### 5.2 Reranker
```python
# rag/retrieval/reranker.py

class Reranker:
    """Rerank results by relevance."""

    def rerank(
        self,
        results: list[SearchResult],
        query: str,
    ) -> list[SearchResult]:
        """Rerank using cross-encoder or simple scoring."""
        # Simple implementation: use original scores
        # Could upgrade to cross-encoder later

        # Deduplicate by chunk ID
        seen = set()
        unique = []
        for r in results:
            if r.chunk.id not in seen:
                seen.add(r.chunk.id)
                unique.append(r)

        # Sort by score
        return sorted(unique, key=lambda r: r.score, reverse=True)
```

### Phase 5 Verification Checklist

- [ ] Vector-only search works
- [ ] Graph expansion finds related entities
- [ ] Results are deduplicated
- [ ] Reranking preserves best results
- [ ] Full integration test with MockGraphStore passes

---

## Phase 6: Crawlers

**Deliverable:** Crawlers for code, docs, and conversations. Testable with local files.

### Tasks

#### 6.1 Code Crawler
```python
# rag/crawlers/code.py

class CodeCrawler:
    """Crawl git repositories for code files."""

    SUPPORTED_EXTENSIONS = {".py", ".go", ".ts", ".cs", ".js"}

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield code files from source."""
        if source.type == "git_repo":
            yield from self._crawl_repo(source.path)
        elif source.type == "directory":
            yield from self._crawl_directory(source.path)

    def _crawl_repo(self, repo_path: str) -> Iterator[CrawlResult]:
        """Walk repo, respecting .gitignore."""
        repo = git.Repo(repo_path)

        for item in repo.tree().traverse():
            if item.type == "blob" and self._should_include(item.path):
                yield CrawlResult(
                    content=item.data_stream.read(),
                    source_uri=f"{repo_path}:{item.path}",
                    language=self._detect_language(item.path),
                    metadata={"repo": repo_path, "path": item.path},
                )
```

#### 6.2 Docs Crawler
```python
# rag/crawlers/docs.py

class DocsCrawler:
    """Crawl markdown documentation."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield markdown files."""
        for path in Path(source.path).rglob("*.md"):
            yield CrawlResult(
                content=path.read_bytes(),
                source_uri=str(path),
                language=None,
                metadata={"type": "markdown"},
            )
```

#### 6.3 Conversation Crawler
```python
# rag/crawlers/conversation.py

class ConversationCrawler:
    """Crawl Slack exports or transcript files."""

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield conversation threads."""
        if source.type == "slack_export":
            yield from self._crawl_slack(source.path)
        elif source.type == "transcript":
            yield from self._crawl_transcript(source.path)
```

### Phase 6 Verification Checklist

- [ ] Code crawler respects .gitignore
- [ ] Language detection works
- [ ] Docs crawler finds nested markdown
- [ ] Conversation crawler preserves threads
- [ ] All crawlers implement Crawler protocol

---

## Phase 7: Orchestrator

**Deliverable:** End-to-end pipeline tying everything together. Testable with mocks.

### Tasks

#### 7.1 Ingestion Orchestrator
```python
# rag/pipeline/orchestrator.py

class IngestionOrchestrator:
    """Orchestrate full ingestion pipeline."""

    def __init__(
        self,
        crawler: Crawler,
        chunker: Chunker,
        scrubber: Scrubber,
        embedder: Embedder,
        vector_store: VectorStore,
        graph_store: GraphStore,
    ):
        self._crawler = crawler
        self._chunker = chunker
        self._scrubber = scrubber
        self._embedder = embedder
        self._vector = vector_store
        self._graph = graph_store

    async def ingest(self, source: CrawlSource) -> IngestionStats:
        """Run full ingestion pipeline."""
        stats = IngestionStats()

        for crawl_result in self._crawler.crawl(source):
            try:
                # Chunk
                chunks = list(self._chunker.chunk(
                    crawl_result.content,
                    source_uri=crawl_result.source_uri,
                    language=crawl_result.language,
                ))
                stats.chunks_created += len(chunks)

                # Scrub
                clean_chunks = [self._scrubber.scrub(c) for c in chunks]
                stats.chunks_scrubbed += len(clean_chunks)

                # Embed
                texts = [c.text for c in clean_chunks]
                vectors = self._embedder.embed_batch(texts)
                embedded = [
                    EmbeddedChunk(chunk=c, vector=v)
                    for c, v in zip(clean_chunks, vectors)
                ]

                # Store vectors
                await self._vector.insert_batch(embedded)
                stats.chunks_stored += len(embedded)

                # Extract relationships for graph
                await self._ingest_to_graph(crawl_result, clean_chunks)

            except Exception as e:
                stats.errors.append(f"{crawl_result.source_uri}: {e}")

        return stats

    async def _ingest_to_graph(
        self,
        crawl_result: CrawlResult,
        chunks: list[CleanChunk],
    ) -> None:
        """Add relationships to graph store."""
        if crawl_result.language:
            # Code: extract via AST
            imports = extract_imports(crawl_result.content, crawl_result.language)
            calls = detect_service_calls(crawl_result.content, crawl_result.language)

            for imp in imports:
                await self._graph.add_episode(
                    f"{crawl_result.source_uri} imports {imp.module}",
                    source="ast_analysis",
                )
            for call in calls:
                await self._graph.add_episode(
                    f"{crawl_result.source_uri} calls {call.target}",
                    source="ast_analysis",
                )
        else:
            # Text: let graph store extract entities
            for chunk in chunks:
                await self._graph.add_episode(
                    chunk.text,
                    source=chunk.source_uri,
                )
```

### Phase 7 Verification Checklist

- [ ] Full pipeline runs with all mocks
- [ ] Stats accurately reflect work done
- [ ] Errors are collected, not thrown
- [ ] Code and text paths both work
- [ ] Integration test with real files passes

---

## Phase 8: Graphiti Integration

**Deliverable:** Real Graphiti working with Neo4j. Production ready.

**This is the ONLY phase requiring external services.**

### Tasks

#### 8.1 Neo4j Setup
- Docker compose for local Neo4j
- Or Neo4j Aura cloud setup
- Connection validation

#### 8.2 Graphiti Client Validation
```python
async def test_graphiti_real():
    """Integration test with real Neo4j."""
    store = GraphitiStore(
        neo4j_uri=os.environ["NEO4J_URI"],
        neo4j_user=os.environ["NEO4J_USER"],
        neo4j_password=os.environ["NEO4J_PASSWORD"],
        llm_client=anthropic.Anthropic(),
    )

    # Test entity extraction
    entities = await store.add_episode(
        "The auth-service calls user-service for authentication.",
        source="test",
    )

    assert any(e.name == "auth-service" for e in entities)
    assert any(e.name == "user-service" for e in entities)
```

#### 8.3 Migration from Mock Data
- Export MockGraphStore state
- Import to Graphiti
- Validate entity/relationship counts

### Phase 8 Verification Checklist

- [ ] Neo4j connection works
- [ ] Graphiti entity extraction functions
- [ ] All MockGraphStore tests pass with GraphitiStore
- [ ] End-to-end ingestion works
- [ ] Hybrid retrieval produces quality results

---

## Control Flow Diagrams

### Ingestion Flow

```
CrawlSource
    │
    ▼
┌─────────┐
│ Crawler │  ─────► CrawlResult (content, uri, language)
└─────────┘
    │
    ▼
┌─────────┐
│ Chunker │  ─────► RawChunk[] (text, byte_range, metadata)
└─────────┘
    │
    ▼
┌──────────┐
│ Scrubber │  ────► CleanChunk[] (text, scrub_log)
└──────────┘
    │
    ├─────────────────────────┐
    │                         │
    ▼                         ▼
┌──────────┐             ┌────────────┐
│ Embedder │             │ GraphStore │
└──────────┘             │ (episode)  │
    │                    └────────────┘
    ▼                         │
┌─────────────┐               │
│ VectorStore │               │
│  (insert)   │               │
└─────────────┘               │
    │                         │
    └─────────┬───────────────┘
              │
              ▼
         IngestionStats
```

### Retrieval Flow

```
Query (string)
    │
    ├─────────────────────────┐
    │                         │
    ▼                         ▼
┌──────────┐             ┌────────────┐
│ Embedder │             │ GraphStore │
│ (embed)  │             │  (search)  │
└──────────┘             └────────────┘
    │                         │
    ▼                         ▼
┌─────────────┐          ┌────────────┐
│ VectorStore │          │ get_neighbors │
│  (search)   │          │  (expand)  │
└─────────────┘          └────────────┘
    │                         │
    │    vector_results       │    entity_names
    │                         │
    └─────────┬───────────────┘
              │
              ▼
         ┌────────┐
         │ Merge  │
         └────────┘
              │
              ▼
         ┌──────────┐
         │ Reranker │
         └──────────┘
              │
              ▼
         SearchResult[]
```

---

## Dependency Graph

```
              ┌────────────────┐
              │ core/types.py  │
              │ core/protocols │
              │ core/schema    │
              │ core/errors    │
              └───────┬────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│ chunking/ │  │ scrubbing/│  │ indexing/ │
│           │  │           │  │           │
│ ast       │  │ scrubber  │  │ embedder  │
│ md        │  │ pseudo    │  │ lance     │
│ thread    │  │           │  │           │
│ tokens    │  │           │  │           │
└─────┬─────┘  └─────┬─────┘  └─────┬─────┘
      │              │              │
      └──────────────┼──────────────┘
                     │
                     ▼
              ┌────────────┐
              │  graphiti/ │
              │            │
              │  mock      │
              │  client    │
              │  factory   │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ retrieval/ │
              │            │
              │ hybrid     │
              │ reranker   │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ crawlers/  │
              │            │
              │ code       │
              │ docs       │
              │ convo      │
              └──────┬─────┘
                     │
                     ▼
              ┌────────────┐
              │ pipeline/  │
              │            │
              │ orchestrator│
              └────────────┘
```

---

## Smoke Tests & Acceptance Criteria

Each phase has a concrete "it works" command and acceptance test.

### Phase 2: Repo Crawler

**Smoke Test:**
```bash
python -c "
from rag.pipeline import raw_code_files, Config
result = raw_code_files(Config(repos=[{'name': 'test', 'path': '.'}]))
print(f'Found {result.total_files} files')
assert result.total_files > 0, 'Should find at least one file'
"
```

### Phase 3: Code Chunks

**Smoke Test:**
```bash
python -c "
from llama_index.core.node_parser import CodeSplitter
from pathlib import Path

splitter = CodeSplitter(language='python', chunk_lines=40, chunk_lines_overlap=10)
code = Path('rag/types.py').read_text()
chunks = splitter.split_text(code)
print(f'Created {len(chunks)} chunks')
assert len(chunks) > 0, 'Should create at least one chunk'
"
```

### Phase 4a: Python Call Extraction

**Smoke Test:**
```bash
python -c "
from rag.extractors import ServiceExtractor

code = b'''
import requests
def fetch_user(user_id):
    return requests.get(f\"http://user-service/api/users/{user_id}\")
'''

extractor = ServiceExtractor()
calls = extractor.extract_from_file('test.py', code)
print(f'Found {len(calls)} calls: {calls}')
assert len(calls) == 1, 'Should find one HTTP call'
assert calls[0].target_service == 'user-service', 'Should detect user-service'
"
```

### Phase 4c: Route Registry

**Smoke Test:**
```bash
python -c "
from rag.extractors import SQLiteRegistry, RouteDefinition
import tempfile, os

with tempfile.TemporaryDirectory() as d:
    registry = SQLiteRegistry(os.path.join(d, 'routes.db'))
    registry.add_routes('user-service', [
        RouteDefinition('user-service', 'GET', '/api/users/{id}', 'user.py', 'get_user', 10)
    ])
    route = registry.find_route_by_request('user-service', 'GET', '/api/users/123')
    print(f'Found route: {route}')
    assert route is not None, 'Should find matching route'
    assert route.handler_function == 'get_user'
"
```

### Phase 4e: Call Linker Integration

**Smoke Test:**
```bash
python -c "
from rag.extractors import CallLinker, SQLiteRegistry, ServiceCall, RouteDefinition
import tempfile, os

with tempfile.TemporaryDirectory() as d:
    registry = SQLiteRegistry(os.path.join(d, 'routes.db'))
    registry.add_routes('user-service', [
        RouteDefinition('user-service', 'GET', '/api/users/{id}', 'controllers/user.py', 'get_user', 10)
    ])

    linker = CallLinker(registry)
    call = ServiceCall(
        source_file='auth/login.py',
        target_service='user-service',
        call_type='http',
        line_number=25,
        confidence=0.9,
        method='GET',
        url_path='/api/users/123',
    )
    relation = linker.link(call)
    print(f'Linked: {relation}')
    assert relation.target_function == 'get_user', 'Should link to handler'
"
```

### Phase 5: Vector Index

**Smoke Test:**
```bash
python -c "
from rag.stores import LanceStore
from rag.types import EmbeddedChunk, CleanChunk, ChunkID, CorpusType
import tempfile, asyncio

async def test():
    with tempfile.TemporaryDirectory() as d:
        store = LanceStore(db_path=d)
        chunk = EmbeddedChunk(
            chunk=CleanChunk(
                id=ChunkID.from_content('test.py', 0, 100),
                text='def hello(): pass',
                source_uri='test.py',
                corpus_type=CorpusType.CODE_LOGIC,
                context_prefix='test.py',
                metadata={},
                scrub_log=[],
            ),
            vector=[0.1] * 768,
        )
        await store.insert(chunk)
        results = await store.search([0.1] * 768, limit=1)
        print(f'Found {len(results)} results')
        assert len(results) == 1, 'Should find inserted chunk'

asyncio.run(test())
"
```

### Phase 7: Hybrid Retriever (Acceptance Test)

**Acceptance Test - MUST PASS for MVP complete:**
```python
async def test_hybrid_retrieval_finds_related_code():
    \"\"\"MUST PASS for Phase 7 to be complete.\"\"\"
    # Setup: index two related services
    await ingest("fixtures/auth-service/")  # calls user-service
    await ingest("fixtures/user-service/")  # has /api/users endpoint

    # Query about auth
    results = await retriever.search("user authentication")

    # MUST find both services
    files = {r.chunk.source_uri for r in results}
    assert any("auth-service" in f for f in files), "Should find auth code"
    assert any("user-service" in f for f in files), "Should find related user code via graph"

    # MUST rank auth higher (direct match)
    auth_rank = next(i for i, r in enumerate(results) if "auth" in r.chunk.source_uri)
    user_rank = next(i for i, r in enumerate(results) if "user" in r.chunk.source_uri)
    assert auth_rank < user_rank, "Direct match should rank higher than graph expansion"
```

---

## Incremental Update Strategy

The base design assumes full reindex. This section adds incremental updates for when the pipeline takes 30+ minutes.

### File Change Detection

```python
@dataclass
class FileChange:
    path: str
    change_type: Literal["added", "modified", "deleted"]
    old_hash: str | None  # SHA256 of previous content
    new_hash: str | None  # SHA256 of current content

@dataclass
class Manifest:
    \"\"\"Tracks indexed file state.\"\"\"
    files: dict[str, str]  # path → content hash
    timestamp: datetime

    def diff(self, current_files: dict[str, str]) -> list[FileChange]:
        \"\"\"Compute changes since last index.\"\"\"
        changes = []

        # Deleted files
        for path, old_hash in self.files.items():
            if path not in current_files:
                changes.append(FileChange(path, "deleted", old_hash, None))

        # Added or modified files
        for path, new_hash in current_files.items():
            old_hash = self.files.get(path)
            if old_hash is None:
                changes.append(FileChange(path, "added", None, new_hash))
            elif old_hash != new_hash:
                changes.append(FileChange(path, "modified", old_hash, new_hash))

        return changes
```

### Incremental Dagster Assets

```python
@asset
def manifest(raw_code_files: RawCodeFilesOutput) -> Manifest:
    \"\"\"Compute current file manifest.\"\"\"
    files = {}
    for service, paths in raw_code_files.files_by_service.items():
        for path in paths:
            content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            files[str(path)] = content_hash
    return Manifest(files=files, timestamp=datetime.now())

@asset
def changed_files(
    manifest: Manifest,
    previous_manifest: Manifest | None,  # From last successful run
) -> list[FileChange]:
    \"\"\"Detect files that changed since last run.\"\"\"
    if previous_manifest is None:
        # First run - everything is "added"
        return [FileChange(p, "added", None, h) for p, h in manifest.files.items()]
    return previous_manifest.diff(manifest.files)

@asset
def incremental_service_relations(
    changed_files: list[FileChange],
    route_registry: RouteRegistryOutput,
    existing_relations: list[ServiceRelation],  # From previous run
) -> ServiceRelationsOutput:
    \"\"\"Only process changed files.\"\"\"
    registry = route_registry.load()
    linker = CallLinker(registry)
    extractor = ServiceExtractor()

    # Start with existing relations, minus deleted files
    deleted_paths = {c.path for c in changed_files if c.change_type == "deleted"}
    relations = [r for r in existing_relations if r.source_file not in deleted_paths]

    # Process added/modified files
    for change in changed_files:
        if change.change_type in ("added", "modified"):
            # Remove old relations for this file
            relations = [r for r in relations if r.source_file != change.path]

            # Extract new relations
            content = Path(change.path).read_bytes()
            calls = extractor.extract_from_file(change.path, content)
            for call in calls:
                relations.append(linker.link(call))

    return ServiceRelationsOutput(
        relations=relations,
        linked_count=sum(1 for r in relations if r.target_function != "<unknown>"),
        unlinked_count=sum(1 for r in relations if r.target_function == "<unknown>"),
    )
```

### When to Use Incremental vs Full

| Scenario | Strategy |
|----------|----------|
| First run | Full index |
| < 10 files changed | Incremental |
| Schema change (new entity types) | Full reindex |
| > 50% files changed | Full reindex (faster) |
| Route patterns changed | Full reindex (call linking affected) |

---

## Verification Summary

### Track A (MVP) - Dagster + LlamaIndex + Graphiti

| Phase | Custom Lines | Dagster Asset | External Dep |
|-------|--------------|---------------|--------------|
| 1 | ~0 | - | Dagster |
| 2 | ~50 | `raw_code_files` | git |
| 3 | ~20 | `code_chunks` | LlamaIndex |
| 4a | ~200 | `service_relations` (Python only) | tree-sitter |
| 4b | ~160 | `service_relations` (+Go, TS, C#) | tree-sitter |
| 4c | ~100 | `route_registry` | SQLite |
| 4d | ~80 | `route_registry` (FastAPI) | tree-sitter |
| 4e | ~60 | `service_relations` (linker) | - |
| 4f | ~150 | `route_registry` (Flask, Gin, Express, ASP.NET) | tree-sitter |
| 5 | ~30 | `vector_index` | LanceDB |
| 6 | ~50 | `knowledge_graph` | Graphiti + Neo4j Aura |
| 7 | ~100 | `retriever` | - |

**MVP Total: ~1000 custom lines**

**Phase 4 Breakdown:** 200 + 160 + 100 + 80 + 60 + 150 = 750 lines, split into testable chunks

### Track B (Post-MVP)

| Phase | Custom Lines | Dagster Asset | External Dep |
|-------|--------------|---------------|--------------|
| 8 | ~50 | `clean_chunks` | Presidio |
| 9 | ~80 | `conversation_docs` | - |

---

## Build Order

### MVP Path (Phases 1-7)

```
1.  Project Setup      → pip install dagster llama-index graphiti-core lancedb
2.  Repo Crawler       → @asset raw_code_files
3.  Code Chunks        → @asset code_chunks (LlamaIndex CodeSplitter)
4a. Python Extraction  → HttpCallPattern + PythonExtractor
4b. Multi-language     → GoExtractor, TypeScriptExtractor, CSharpExtractor
4c. Route Registry     → SQLiteRegistry + InMemoryRegistry
4d. FastAPI Routes     → FastAPIPattern
4e. Call Linker        → CallLinker + ServiceRelation
4f. Other Frameworks   → FlaskPattern, GinPattern, ExpressPattern, AspNetPattern
5.  Vector Index       → @asset vector_index (LanceDB)
6.  Knowledge Graph    → @asset knowledge_graph (Graphiti)
7.  Hybrid Retriever   → Query both stores
```

**Checkpoint Gates:**
- After 4a: Can detect Python HTTP calls → commit
- After 4c: Can store/query routes → commit
- After 4e: Can link calls to handlers → commit
- After 7: Full MVP working → tag release

**At Phase 7:** `dagster dev` shows full pipeline, search works.

### Post-MVP Path (Phases 8-9)
```
8. PHI Scrubbing      → Insert clean_chunks asset between chunks and index
9. Conversations      → Add conversation_docs asset, feeds into graph
```
