# Phase 2: Code Crawler — Tree-sitter AST Chunking & Boundary Detection

**Depends on:** Phase 1 (Foundation)
**Unlocks:** Phase 5 (Embedding & Storage), Phase 4 (PHI — though code is CLEAN)

**Reference:** DESIGN.md Sections 4.1, 6.1–6.2

---

## 1. Scope

Build the `CodeCrawler` that walks a repository, parses source files with
tree-sitter, chunks them by AST structure (the cAST algorithm), and extracts
service boundary signals (imports, outbound HTTP/queue/DB calls). This is
the most complex crawler because it handles four languages and produces the
richest metadata.

### In scope

- Tree-sitter parsing for Go, C#, Python, TypeScript
- cAST chunking algorithm (declaration-level splitting, recursive descent
  for oversized declarations, sliding window fallback)
- Context prefix generation (`file > class > method`)
- Service call detection (regex patterns + tree-sitter AST queries)
- Import extraction per language
- `CodeCrawler` class satisfying the `Crawler` protocol
- Language detection by file extension
- File filtering (skip vendored dirs, generated code, binaries)

### Out of scope

- Service graph construction (Phase 5 — graph is built from accumulated
  `calls_out` after all crawlers finish)
- Service name resolution (Phase 5)
- Embedding/indexing the chunks (Phase 5)
- Non-code crawlers (Phase 3)

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── crawlers/
│   │   ├── __init__.py
│   │   └── code.py               # CodeCrawler
│   ├── chunking/
│   │   ├── __init__.py
│   │   └── ast_chunker.py        # cAST algorithm
│   └── boundary/
│       ├── __init__.py
│       ├── service_calls.py      # regex + AST call detection
│       └── imports.py            # import extraction per language
├── tests/
│   ├── test_code_crawler.py
│   ├── test_ast_chunker.py
│   ├── test_service_calls.py
│   ├── test_imports.py
│   └── fixtures/
│       ├── go/
│       │   ├── simple_handler.go
│       │   ├── large_function.go     # >2048 tokens, tests recursive split
│       │   ├── http_client.go        # contains http.Get/Post calls
│       │   └── interfaces.go         # interface + struct declarations
│       ├── csharp/
│       │   ├── UserController.cs
│       │   ├── HttpClientService.cs  # HttpClient calls
│       │   └── LargeClass.cs         # tests class-level chunking
│       ├── python/
│       │   ├── api_routes.py         # FastAPI/Flask routes
│       │   ├── http_calls.py         # requests/httpx calls
│       │   └── script.py             # top-level statements (no classes)
│       └── typescript/
│           ├── api.controller.ts
│           ├── fetch_client.ts       # fetch/axios calls
│           └── arrow_functions.ts    # named arrow functions
```

---

## 3. Implementation Details

### 3.1 Language Detection

```python
EXTENSION_MAP: dict[str, str] = {
    ".go": "go",
    ".cs": "c_sharp",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
}

SKIP_DIRS: set[str] = {
    "vendor", "node_modules", ".git", "__pycache__", "bin", "obj",
    "dist", "build", ".next", "generated", "proto", "mock", "mocks",
}
```

### 3.2 cAST Algorithm (`rag/chunking/ast_chunker.py`)

```
Input: file bytes + language name
Output: list[ChunkData] (pre-RawChunk, without embedding)

1. Load tree-sitter grammar for language
2. Parse file → AST root node
3. Walk root's children, collecting BOUNDARY_NODES for this language
4. For each boundary node:
   a. Extract text (node.start_byte..node.end_byte)
   b. Count tokens (approximate: split on whitespace, count)
   c. If ≤ 2048 tokens → one chunk
   d. If > 2048 tokens → recurse into child nodes:
      - Greedily merge sibling nodes until sub-chunk hits 2048
      - Each sub-chunk gets context_prefix of parent
   e. Build context_prefix: file_path > enclosing_class > symbol_name
5. For files with no boundary nodes (scripts), use sliding window:
   - 1600-token target, 10% overlap
6. Return list of ChunkData with byte ranges, text, metadata
```

The key data structure between the chunker and the crawler:

```python
@dataclass
class ChunkData:
    """Intermediate output of the AST chunker.
    The CodeCrawler wraps this into a RawChunk."""
    text: str
    byte_start: int
    byte_end: int
    context_prefix: str
    symbol_name: str | None
    symbol_kind: str | None       # "function", "method", "class", etc.
    signature: str | None         # first line of declaration
    enclosing_class: str | None   # for methods inside classes
```

### 3.3 Boundary Node Types per Language

```python
BOUNDARY_NODES: dict[str, list[str]] = {
    "go": [
        "function_declaration",
        "method_declaration",
        "type_declaration",
    ],
    "c_sharp": [
        "method_declaration",
        "class_declaration",
        "interface_declaration",
        "constructor_declaration",
        "property_declaration",
    ],
    "python": [
        "function_definition",
        "class_definition",
    ],
    "typescript": [
        "function_declaration",
        "method_definition",
        "class_declaration",
        "interface_declaration",
        "arrow_function",  # only when assigned to const/let
    ],
}
```

### 3.4 Service Call Detection (`rag/boundary/service_calls.py`)

Two-tier detection:

**Tier 1 — Regex (fast, all languages):**

```python
SERVICE_CALL_PATTERNS: dict[str, list[tuple[str, str]]] = {
    "go": [
        (r'http\.(Get|Post|Put|Delete|Do)\(',               "http"),
        (r'\.NewRequest\(',                                  "http"),
        (r'\.Publish\(|\.Subscribe\(',                       "queue"),
        (r'sql\.Open\(|\.QueryRow\(|\.Exec\(',               "db"),
    ],
    "c_sharp": [
        (r'HttpClient\.\w+Async\(',                          "http"),
        (r'\.PostAsJsonAsync\(|\.GetFromJsonAsync\(',         "http"),
        (r'IServiceBus\.Publish|\.Send\(',                   "queue"),
        (r'DbContext\.|\.ExecuteSqlRaw\(',                   "db"),
    ],
    # ... python, typescript
}
```

Each pattern returns a `(match_text, edge_type)` pair. The match_text is
scanned for URL-like strings to extract the target service hostname.

**Tier 2 — AST queries (precise, Go + TypeScript first):**

Tree-sitter queries that match `call_expression` nodes where the function
name matches known HTTP client methods and extract the URL argument. More
precise than regex (no false positives from comments/strings) but more work
to implement. Start with regex; add AST queries if precision is an issue.

### 3.5 Import Extraction (`rag/boundary/imports.py`)

```python
def extract_imports(source: bytes, language: str) -> list[str]:
    """Extract import paths from source code using tree-sitter.

    Go:    import "net/http" → ["net/http"]
    C#:    using System.Net.Http → ["System.Net.Http"]
    Python: from requests import get → ["requests"]
    TS:    import axios from 'axios' → ["axios"]
    """
```

### 3.6 `CodeCrawler` Integration

```python
class CodeCrawler:
    """Walks a repo, parses code files, yields RawChunks."""

    @property
    def corpus_types(self) -> frozenset[str]:
        return frozenset({"CODE_LOGIC"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        for file_path in self._walk_code_files(source.path):
            language = EXTENSION_MAP.get(file_path.suffix)
            if not language:
                continue

            content = file_path.read_bytes()
            chunks = ast_chunk(content, language, str(file_path))
            imports = extract_imports(content, language)
            calls = detect_service_calls(content, language)

            for chunk_data in chunks:
                # Find which calls fall within this chunk's byte range
                chunk_calls = [
                    c for c in calls
                    if chunk_data.byte_start <= c.byte_offset < chunk_data.byte_end
                ]

                yield RawChunk(
                    id=make_chunk_id(str(file_path), chunk_data.byte_start, chunk_data.byte_end),
                    source_uri=str(file_path.relative_to(source.path)),
                    byte_range=(chunk_data.byte_start, chunk_data.byte_end),
                    source_type=SOURCE_TYPES["CODE_LOGIC"],
                    text=chunk_data.text,
                    context_prefix=chunk_data.context_prefix,
                    repo_name=source.repo_name,
                    language=language,
                    symbol_name=chunk_data.symbol_name,
                    symbol_kind=chunk_data.symbol_kind,
                    signature=chunk_data.signature,
                    file_path=str(file_path.relative_to(source.path)),
                    git_hash=self._get_file_hash(source.path, file_path),
                    imports=imports,
                    calls_out=[c.target for c in chunk_calls],
                )
```

---

## 4. Testing Strategy

### 4.1 Test Fixtures

Create small but realistic source files. Each fixture tests a specific
behavior. Fixtures should be checked into `tests/fixtures/`.

**`tests/fixtures/go/simple_handler.go`:**

```go
package handlers

import (
    "net/http"
    "encoding/json"
)

// GetUser retrieves a user by ID.
func GetUser(w http.ResponseWriter, r *http.Request) {
    userID := r.URL.Query().Get("id")
    json.NewEncoder(w).Encode(map[string]string{"id": userID})
}

// CreateUser creates a new user.
func CreateUser(w http.ResponseWriter, r *http.Request) {
    var body map[string]string
    json.NewDecoder(r.Body).Decode(&body)
    w.WriteHeader(http.StatusCreated)
}
```

Expected: 2 chunks (one per function), each with `symbol_kind="function"`.

**`tests/fixtures/go/http_client.go`:**

```go
package client

import "net/http"

func FetchUserProfile(baseURL string, userID string) (*http.Response, error) {
    return http.Get(baseURL + "/api/users/" + userID)
}

func NotifyService(endpoint string) {
    http.Post(endpoint+"/notify", "application/json", nil)
}
```

Expected: 2 chunks. First has `calls_out` containing an http call. Second too.

**`tests/fixtures/go/large_function.go`:**

A single function with 3000+ tokens (lots of switch cases or if-else blocks).
Expected: splits into 2+ sub-chunks, each ≤2048 tokens.

### 4.2 Unit Tests: `tests/test_ast_chunker.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_go_function_chunking` | `simple_handler.go` | 2 chunks, one per function |
| `test_go_chunk_context_prefix` | `simple_handler.go` | Prefix is `"handlers/simple_handler.go > GetUser"` |
| `test_go_chunk_symbol_metadata` | `simple_handler.go` | `symbol_name="GetUser"`, `symbol_kind="function"` |
| `test_go_chunk_byte_ranges` | `simple_handler.go` | byte_start/end correspond to actual function boundaries |
| `test_go_large_function_splits` | `large_function.go` | Multiple chunks from one function, each ≤2048 tokens |
| `test_go_interface_chunking` | `interfaces.go` | Interface + struct are separate chunks |
| `test_csharp_class_chunking` | `UserController.cs` | Class with methods → one chunk per method |
| `test_csharp_nested_class` | `LargeClass.cs` | Methods within class get context prefix `"File > Class > Method"` |
| `test_python_function_chunking` | `api_routes.py` | One chunk per function/route |
| `test_python_class_with_methods` | `api_routes.py` | Methods get class context prefix |
| `test_python_script_fallback` | `script.py` | No functions/classes → sliding window chunks |
| `test_ts_arrow_function` | `arrow_functions.ts` | `const handler = () => {...}` is chunked |
| `test_ts_interface` | `api.controller.ts` | Interface declaration is a chunk |
| `test_chunk_text_matches_source` | all | `source[byte_start:byte_end]` equals chunk.text |

### 4.3 Unit Tests: `tests/test_service_calls.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_go_http_get` | `http_client.go` | Detects `http.Get(...)`, edge_type="http" |
| `test_go_http_post` | `http_client.go` | Detects `http.Post(...)` |
| `test_go_url_extraction` | `http_client.go` | Extracts URL pattern from argument |
| `test_csharp_httpclient` | `HttpClientService.cs` | Detects `HttpClient.GetAsync(...)` |
| `test_python_requests` | `http_calls.py` | Detects `requests.get(...)` |
| `test_ts_fetch` | `fetch_client.ts` | Detects `fetch(...)` |
| `test_ts_axios` | `fetch_client.ts` | Detects `axios.post(...)` |
| `test_no_false_positive_in_comments` | custom | Comment mentioning `http.Get` is not detected |
| `test_no_false_positive_in_strings` | custom | String literal `"http.Get"` is not detected (if using AST) |
| `test_call_byte_offset` | `http_client.go` | Each detected call has correct byte offset within file |

### 4.4 Unit Tests: `tests/test_imports.py`

| Test | What it verifies |
|------|-----------------|
| `test_go_imports` | `import "net/http"` → `["net/http"]` |
| `test_go_grouped_imports` | `import (...)` block → all paths |
| `test_csharp_using` | `using System.Net.Http;` → `["System.Net.Http"]` |
| `test_python_import` | `import requests` → `["requests"]` |
| `test_python_from_import` | `from httpx import AsyncClient` → `["httpx"]` |
| `test_ts_import` | `import axios from 'axios'` → `["axios"]` |
| `test_ts_require` | `const fs = require('fs')` → `["fs"]` |

### 4.5 Integration Tests: `tests/test_code_crawler.py`

| Test | What it verifies |
|------|-----------------|
| `test_crawl_go_fixtures` | CodeCrawler yields RawChunks from `fixtures/go/` |
| `test_all_chunks_are_raw_chunk` | Every yielded object is a `RawChunk` |
| `test_all_chunks_have_code_logic_type` | `chunk.source_type == SOURCE_TYPES["CODE_LOGIC"]` |
| `test_all_chunks_have_language` | Language field is set for every chunk |
| `test_skip_dirs` | Files in `vendor/`, `node_modules/` are not crawled |
| `test_unknown_extension_skipped` | `.java` files produce no chunks |
| `test_chunk_ids_unique` | No duplicate IDs within a crawl |
| `test_chunk_ids_deterministic` | Crawl twice → same IDs |

---

## 5. Acceptance Criteria

- [ ] `CodeCrawler.crawl()` yields `RawChunk` objects for Go, C#, Python, TS files
- [ ] Each chunk is ≤2048 tokens (or split correctly if the declaration exceeds it)
- [ ] `context_prefix` follows the `"file > class > symbol"` format
- [ ] `calls_out` populated for chunks containing service calls
- [ ] `imports` populated for each file
- [ ] Files in skip directories are not crawled
- [ ] All 30+ unit/integration tests pass
- [ ] `mypy rag/crawlers/ rag/chunking/ rag/boundary/ --strict` passes

---

## 6. Dependencies (pip, this phase)

```
tree-sitter>=0.22
tree-sitter-go>=0.21
tree-sitter-c-sharp>=0.21
tree-sitter-python>=0.21
tree-sitter-typescript>=0.21
```
