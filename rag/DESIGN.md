# Code Boundaries RAG — Design Document

## 1. Problem Statement

We need a retrieval-augmented generation system that understands **code boundaries** — the structural and contractual edges within and between services — and can answer questions across heterogeneous content types: source code, deployment configs, documentation, conversations, and runbooks.

The system must:

1. Parse and chunk code with structural awareness (functions, classes, modules, service contracts)
2. Map cross-service relationships (HTTP calls, message queues, shared DB access)
3. Ingest non-code content (Slack threads, runbooks, transcripts, markdown docs) with appropriate chunking
4. Provide a **single query interface** that searches all content types, while preserving type-specific semantics
5. Use hybrid retrieval (dense embeddings + sparse BM25) for high recall and precision
6. Run as a containerized crawl job that writes to a local `data/` directory

### Target Codebase

| Language   | Role                        | Service Contract Patterns                          |
|------------|-----------------------------|----------------------------------------------------|
| Go         | Primary backend services    | Interfaces, HTTP handlers, HTTP clients             |
| C#         | Primary backend services    | Interfaces, Controllers, HttpClient                 |
| Python     | Supporting services         | FastAPI/Flask routes, requests/httpx calls          |
| TypeScript | Frontend + one backend svc  | fetch/axios calls, Express/NestJS controllers      |

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Query Interface                         │
│                   query(text, filters?)                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │ Dense Search  │    │ BM25 Search  │    │ Graph Lookup  │  │
│  │ (LanceDB)    │    │ (bm25s)      │    │ (service map) │  │
│  └──────┬───────┘    └──────┬───────┘    └───────┬───────┘  │
│         │                   │                     │          │
│         └───────────┬───────┘                     │          │
│                     ▼                             │          │
│           Reciprocal Rank Fusion                  │          │
│                     │                             │          │
│                     ▼                             │          │
│           Cross-Encoder Reranker                  │          │
│           (top-N refinement)                      │          │
│                     │                             │          │
│                     ▼                             │          │
│              Merged Results ◄─────────────────────┘          │
│              + type metadata                                 │
│              + boundary context                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     Ingest Pipeline                          │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐  │
│  │ Code    │  │ Deploy   │  │ Docs       │  │ Convos    │  │
│  │ Crawler │  │ Crawler  │  │ Crawler    │  │ Crawler   │  │
│  │         │  │          │  │            │  │           │  │
│  │ tree-   │  │ YAML     │  │ markdown   │  │ thread-   │  │
│  │ sitter  │  │ parser   │  │ parser     │  │ aware     │  │
│  │ AST     │  │          │  │            │  │ splitter  │  │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘  └─────┬─────┘  │
│       │            │              │                │         │
│       └────────────┴──────┬───────┴────────────────┘         │
│                           ▼                                  │
│                  ┌─────────────────┐                         │
│                  │  Chunk + Embed  │                         │
│                  │  CodeRankEmbed  │                         │
│                  │  + BM25 index   │                         │
│                  └────────┬────────┘                         │
│                           ▼                                  │
│                  ┌─────────────────┐                         │
│                  │  LanceDB Tables │                         │
│                  │  + bm25s index  │                         │
│                  │  + service graph│                         │
│                  │  (data/)        │                         │
│                  └─────────────────┘                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Content Type Taxonomy

All content is classified into one of these **corpus types**, each with its own chunking strategy, tokenizer, and metadata schema. They share a common embedding model and a unified query surface.

### 3.1 Corpus Type Definitions

```
corpus_type (enum):
  CODE_LOGIC        # Source code: functions, classes, methods
  CODE_DEPLOY       # Kubernetes YAMLs, Dockerfiles, Helm charts, Terraform
  CODE_CONFIG       # .env templates, appsettings.json, go.mod, package.json
  DOC_README        # README.md, markdown docs in repo
  DOC_RUNBOOK       # Operational runbooks (incident response, deploy procedures)
  DOC_ADR           # Architecture decision records
  CONVO_SLACK       # Slack conversations (thread-grouped)
  CONVO_TRANSCRIPT  # Meeting transcripts, call logs
  CONVO_OTHER       # Other unstructured conversation-like content
```

### 3.2 Why Separate Types Matter

| Concern             | Code Logic             | Deploy YAMLs          | Docs/Runbooks         | Conversations          |
|---------------------|------------------------|-----------------------|-----------------------|------------------------|
| **Chunking**        | AST (tree-sitter)      | YAML document/block   | Section/heading-based | Thread/message-based   |
| **BM25 tokenizer**  | Code-aware (camelCase) | Key-path aware        | Standard NLP          | Standard NLP + @mentions |
| **Key metadata**    | Language, function sig  | Resource kind, labels | Section hierarchy     | Author, timestamp, channel |
| **Boundary signals**| Imports, calls, types  | Service names, ports  | Cross-references      | Mentioned services     |
| **Staleness**       | Git hash per file      | Git hash per file     | Git hash or mtime     | Ingest timestamp       |

### 3.3 Unified Chunk Schema

Every chunk, regardless of corpus type, conforms to this schema in LanceDB:

```python
@dataclass
class Chunk:
    # Identity
    id: str                    # deterministic hash: sha256(source_uri + byte_range)
    source_uri: str            # file path, Slack permalink, or URL
    byte_range: tuple[int,int] # start/end offsets in source (0,0 for full-doc)
    corpus_type: str           # enum value from above

    # Content
    text: str                  # raw chunk text (what gets embedded)
    context_prefix: str        # scope context prepended for embedding
                               # e.g. "pkg/auth/service.go > AuthService > Validate"
                               # e.g. "runbooks/deploy.md > ## Rollback Procedure"
                               # e.g. "#incident-channel > @alice thread 2024-01-15"

    # Embedding
    vector: list[float]        # dense embedding (768-dim, CodeRankEmbed)

    # Multi-repo
    repo_name: str | None      # e.g. "auth-service", "frontend", derived from repo dir name

    # Metadata (type-specific fields are nullable)
    language: str | None       # go, csharp, python, typescript, yaml, markdown, None
    symbol_name: str | None    # function/class/method name (code only)
    symbol_kind: str | None    # function, method, class, interface, struct, etc.
    signature: str | None      # full function/method signature (code only)
    file_path: str | None      # relative path in repo
    git_hash: str | None       # commit hash at ingest time
    section_path: str | None   # heading hierarchy for docs: "## Deploy > ### Rollback"
    author: str | None         # message/doc author
    timestamp: str | None      # ISO 8601 for conversations
    channel: str | None        # Slack channel name
    thread_id: str | None      # Slack thread ts

    # Boundary / relationship pointers
    imports: list[str]         # imported packages/modules (code only)
    calls_out: list[str]       # external service calls detected
    called_by: list[str]       # populated post-hoc via graph inversion
    service_name: str | None   # which service this chunk belongs to
    k8s_labels: dict | None    # labels from deploy YAMLs
```

---

## 4. Ingest Pipeline — Per-Type Crawlers

### 4.1 Code Logic Crawler

**Parser:** tree-sitter with language grammars for Go, C#, Python, TypeScript.

**Chunking strategy (cAST algorithm):**

1. Parse file into AST via tree-sitter
2. Walk top-level declarations (functions, methods, classes, interfaces, structs)
3. Each declaration becomes a chunk if it fits within 512 tokens
4. If a declaration exceeds 512 tokens, recursively descend into child nodes and greedily merge siblings until each sub-chunk fits
5. Prepend **context prefix**: `file_path > enclosing_class > symbol_name`
6. For files with only top-level statements (scripts), use sliding window with 400-token target and 10% overlap

**Language-specific tree-sitter node types to extract:**

```python
BOUNDARY_NODES = {
    "go": [
        "function_declaration",
        "method_declaration",
        "type_declaration",      # struct, interface
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
        "arrow_function",        # only named (assigned to const)
    ],
}
```

**Service contract extraction (per chunk):**

After chunking, each code chunk is analyzed for outbound service calls. This populates `calls_out` and feeds the service graph.

```python
# Patterns to detect external calls per language
SERVICE_CALL_PATTERNS = {
    "go": [
        r'http\.(Get|Post|Put|Delete|Do)\(',          # net/http
        r'\.NewRequest\(',                             # http.NewRequest
        r'\.Publish\(|\.Subscribe\(',                  # message queue
        r'sql\.Open\(|\.QueryRow\(|\.Exec\(',          # database
    ],
    "c_sharp": [
        r'HttpClient\.(Get|Post|Put|Delete)Async\(',   # HttpClient
        r'IServiceBus\.Publish|\.Send\(',              # message bus
        r'DbContext\.|\.ExecuteSqlRaw\(',              # EF Core / DB
    ],
    "python": [
        r'requests\.(get|post|put|delete)\(',          # requests
        r'httpx\.(get|post|put|delete|AsyncClient)',   # httpx
    ],
    "typescript": [
        r'fetch\(|axios\.(get|post|put|delete)\(',     # HTTP
        r'\.publish\(|\.subscribe\(',                  # message queue
    ],
}
```

These regex patterns are a first pass. Tree-sitter AST queries can refine this further — for example, matching `call_expression` nodes where the function name matches known HTTP client methods, and extracting the URL argument to identify the target service.

**AST-based call extraction (more precise, Go example):**

```python
# tree-sitter query for Go HTTP calls
GO_HTTP_CALL_QUERY = """
(call_expression
  function: (selector_expression
    operand: (identifier) @client
    field: (field_identifier) @method)
  arguments: (argument_list
    (interpreted_string_literal) @url)
  (#match? @method "^(Get|Post|Put|Delete|Do)$"))
"""
```

### 4.2 Deploy YAML Crawler

**Parser:** PyYAML / ruamel.yaml with multi-document support.

**Chunking strategy:**

1. Split multi-document YAML files on `---` boundaries
2. Each Kubernetes resource (Deployment, Service, ConfigMap, Ingress, etc.) is one chunk
3. For Helm templates, chunk per template file
4. For Terraform, chunk per resource block

**Key metadata extraction:**

```python
def extract_k8s_metadata(doc: dict) -> dict:
    return {
        "kind": doc.get("kind"),
        "name": doc.get("metadata", {}).get("name"),
        "namespace": doc.get("metadata", {}).get("namespace"),
        "labels": doc.get("metadata", {}).get("labels", {}),
        "service_name": doc.get("metadata", {}).get("labels", {}).get("app"),
        "ports": _extract_ports(doc),
        "image": _extract_image(doc),
        "env_refs": _extract_env_refs(doc),  # ConfigMap/Secret references
    }
```

**Service boundary signals from deploy YAMLs:**

- `Service` kind → defines a network boundary (name, port, selector)
- `Ingress` kind → defines an external boundary (host, path, backend)
- `Deployment` env vars referencing other service URLs → cross-service dependency
- `NetworkPolicy` → explicit boundary definitions

### 4.3 Documentation Crawler (README, Runbook, ADR)

**Parser:** `markdown-it-py` or `mistune` for markdown AST.

**Chunking strategy:**

1. Parse markdown into AST
2. Split on heading boundaries (H1, H2, H3)
3. Each section becomes a chunk, with `section_path` capturing the heading hierarchy
4. If a section exceeds 512 tokens, split on paragraph boundaries within it
5. Code blocks inside markdown are tagged with language but **not** AST-parsed (they're documentation, not live code)

**Context prefix format:** `docs/runbooks/deploy.md > ## Rollback > ### Step 3`

**Metadata:**

```python
{
    "section_path": "## Rollback > ### Step 3",
    "file_path": "docs/runbooks/deploy.md",
    "corpus_type": "DOC_RUNBOOK",  # classified by path heuristic
    "git_hash": "abc123",
}
```

**Path-based corpus classification:**

```python
DOC_TYPE_RULES = [
    (r"runbook", "DOC_RUNBOOK"),
    (r"adr|decision", "DOC_ADR"),
    (r"readme|docs/", "DOC_README"),
]
```

### 4.4 Conversation Crawler (Slack, Transcripts)

**Input format:** JSON exports from Slack or structured transcript files.

**Chunking strategy:**

1. **Slack:** Group messages by thread (`thread_ts`). Each thread becomes one chunk. If a thread exceeds 512 tokens, split by sliding window over messages (never splitting mid-message).
2. **Transcripts:** Split on speaker turns. Group consecutive turns into chunks of ~400 tokens. Preserve speaker attribution.
3. Prepend context: `#channel-name > @author > 2024-01-15T10:30:00Z`

**Why threads, not individual messages:**

A single Slack message like "yeah that broke prod" is meaningless without context. The thread is the atomic unit of meaning. Individual messages within a thread are sub-chunks only when the thread is too long.

**Metadata:**

```python
{
    "author": "alice",
    "channel": "incident-response",
    "thread_id": "1705312200.000100",
    "timestamp": "2024-01-15T10:30:00Z",
    "corpus_type": "CONVO_SLACK",
    "mentions": ["@bob", "@deploy-bot"],
    "service_refs": ["auth-service", "api-gateway"],  # extracted from text
}
```

**Service reference extraction from conversations:**

Scan message text for known service names (from deploy YAML crawl) and common patterns:

```python
def extract_service_refs(text: str, known_services: set[str]) -> list[str]:
    """Find references to known services in freeform text."""
    refs = []
    text_lower = text.lower()
    for svc in known_services:
        if svc.lower() in text_lower:
            refs.append(svc)
    # Also match URL-like patterns: http://service-name:port/...
    url_pattern = r'https?://([a-z0-9\-]+)[:\./]'
    for match in re.finditer(url_pattern, text_lower):
        hostname = match.group(1)
        if hostname in known_services:
            refs.append(hostname)
    return refs
```

---

## 5. Embedding and Indexing

### 5.1 Dense Embedding Model: CodeRankEmbed

**Model:** `nomic-ai/CodeRankEmbed` (137M params, 768-dim, 8192-token context)

**Why this model:**

- 77.9 MRR on CodeSearchNet, ~60.1 NDCG@10 on CoIR — state-of-the-art for its size
- Outperforms models 10x its size (beats CodeSage-Large v1 at 1.3B params)
- 521MB on disk, runs comfortably on CPU — no GPU required for the crawl job
- 8192-token context handles large functions and long threads without truncation
- Fully open source (weights, training data, eval code)
- Trained on code and natural language jointly (CoRNStack dataset) — handles both code chunks and doc/conversation chunks

**Usage:**

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer("nomic-ai/CodeRankEmbed", trust_remote_code=True)

# For queries, use the instruction prefix
query_embedding = model.encode(
    "Represent this query for searching relevant code: " + query_text
)

# For documents/chunks, encode directly
chunk_embedding = model.encode(chunk.context_prefix + "\n" + chunk.text)
```

**Context prefix prepended at embed time:** The `context_prefix` field (file path, section hierarchy, channel info) is prepended to the chunk text before encoding. This grounds the embedding in its structural location.

### 5.2 Sparse Index: BM25 via bm25s

**Library:** `bm25s` — pure Python, supports custom tokenizers, fast.

**Separate tokenizer per corpus family:**

```python
import re
from dataclasses import dataclass

@dataclass
class TokenizerConfig:
    split_identifiers: bool  # camelCase/snake_case splitting
    stop_words: set[str]
    lowercase: bool

CODE_TOKENIZER = TokenizerConfig(
    split_identifiers=True,
    stop_words={
        # Go
        "func", "return", "if", "else", "for", "range", "var", "const",
        "type", "struct", "interface", "package", "import", "defer", "go",
        # C#
        "public", "private", "protected", "static", "void", "class",
        "namespace", "using", "async", "await", "new", "this", "base",
        # Python
        "def", "class", "return", "import", "from", "self", "None",
        # TypeScript
        "function", "const", "let", "export", "default", "async",
        # Common
        "true", "false", "null", "nil", "string", "int", "bool", "err",
    },
    lowercase=True,
)

NLP_TOKENIZER = TokenizerConfig(
    split_identifiers=False,
    stop_words=None,  # use default English stop words
    lowercase=True,
)

def tokenize_code(text: str, config: TokenizerConfig) -> list[str]:
    """Code-aware tokenizer: splits identifiers, removes lang keywords."""
    tokens = re.split(r'[\s\.\,\;\:\(\)\[\]\{\}\<\>\=\+\-\*/&|!@#$%^~`"\'\\]+', text)
    result = []
    for token in tokens:
        if not token:
            continue
        if config.split_identifiers:
            # snake_case split
            parts = token.split("_")
            expanded = []
            for part in parts:
                # camelCase split
                expanded.extend(re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', part).split())
            parts = expanded
        else:
            parts = [token]

        for part in parts:
            if config.lowercase:
                part = part.lower()
            if part and (not config.stop_words or part not in config.stop_words):
                result.append(part)
    return result

def get_tokenizer(corpus_type: str) -> TokenizerConfig:
    """Route to the right tokenizer based on corpus type."""
    if corpus_type.startswith("CODE_"):
        return CODE_TOKENIZER
    return NLP_TOKENIZER
```

**Index structure:** One unified BM25 index across all chunks. The tokenizer is applied at index time per chunk based on its `corpus_type`. At query time, the query is tokenized with **both** tokenizers and results are merged.

### 5.3 Storage: LanceDB

**Why LanceDB:**

- Embedded (no server process) — writes directly to `data/` directory
- Native vector search with IVF-PQ indexing
- Columnar storage (Lance format) — efficient metadata filtering
- Python-native API
- Supports hybrid search (vector + where-clause filters)

**Table schema:**

```python
import lancedb
import pyarrow as pa

schema = pa.schema([
    pa.field("id", pa.string()),
    pa.field("source_uri", pa.string()),
    pa.field("byte_start", pa.int64()),
    pa.field("byte_end", pa.int64()),
    pa.field("corpus_type", pa.string()),
    pa.field("text", pa.string()),
    pa.field("context_prefix", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 768)),
    pa.field("language", pa.string()),
    pa.field("symbol_name", pa.string()),
    pa.field("symbol_kind", pa.string()),
    pa.field("signature", pa.string()),
    pa.field("file_path", pa.string()),
    pa.field("git_hash", pa.string()),
    pa.field("section_path", pa.string()),
    pa.field("author", pa.string()),
    pa.field("timestamp", pa.string()),
    pa.field("channel", pa.string()),
    pa.field("thread_id", pa.string()),
    pa.field("imports", pa.list_(pa.string())),
    pa.field("calls_out", pa.list_(pa.string())),
    pa.field("called_by", pa.list_(pa.string())),
    pa.field("service_name", pa.string()),
    pa.field("repo_name", pa.string()),
])

db = lancedb.connect("data/rag.lance")
table = db.create_table("chunks", schema=schema)
```

---

## 6. Service Boundary Graph

Beyond flat retrieval, we build an explicit **service dependency graph** that captures cross-boundary relationships. This is stored as a separate artifact alongside the vector store.

### 6.1 Graph Construction

After the code and deploy crawlers finish, we have:

- From **code chunks**: `calls_out` (HTTP/queue calls detected per function)
- From **deploy YAMLs**: service names, ports, network policies, env var references
- From **conversations**: service name mentions in incident threads

These are unified into a directed graph:

```python
@dataclass
class ServiceNode:
    name: str                        # e.g. "auth-service"
    repo_path: str | None            # e.g. "services/auth/"
    language: str | None             # primary language
    k8s_namespace: str | None
    ports: list[int]
    deploy_chunk_ids: list[str]      # chunk IDs of its k8s manifests

@dataclass
class ServiceEdge:
    source: str                      # calling service
    target: str                      # called service
    edge_type: str                   # "http", "queue", "db", "unknown"
    evidence_chunk_ids: list[str]    # chunks where this call was detected
    url_pattern: str | None          # e.g. "/api/v1/users/{id}"
```

**Graph storage:** Serialized as JSON in `data/service_graph.json`. Loaded into memory at query time. For larger graphs, NetworkX provides traversal.

### 6.2 Service Name Resolution

The challenge: code says `http.Get("http://user-service:8080/api/users")` and we need to map `user-service` to the actual service. Resolution order:

1. Match against Kubernetes `Service` resource names from deploy YAMLs
2. Match against `metadata.labels.app` values
3. Match against directory/repo names
4. Fuzzy match for partial names

```python
def resolve_service_name(raw_target: str, known_services: dict[str, ServiceNode]) -> str | None:
    """Resolve a raw hostname/URL target to a known service."""
    # Exact match
    if raw_target in known_services:
        return raw_target

    # Strip port and protocol
    cleaned = re.sub(r'https?://', '', raw_target)
    cleaned = cleaned.split(':')[0].split('/')[0]

    if cleaned in known_services:
        return cleaned

    # Partial match (e.g., "user-svc" matches "user-service")
    for name in known_services:
        if cleaned in name or name in cleaned:
            return name

    return None
```

### 6.3 Graph-Augmented Retrieval

When a query mentions a service (or retrieval results land on a service boundary), the graph provides:

1. **Upstream/downstream expansion:** "What calls auth-service?" → follow edges inward
2. **Blast radius analysis:** "What would break if user-service goes down?" → transitive closure of dependents
3. **Contract surface:** "What's the API surface of order-service?" → all chunks with `service_name=order-service` and `symbol_kind in (handler, controller, endpoint)`

This is not vector search — it's graph traversal that enriches the retrieval results.

---

## 7. Hybrid Retrieval and Query Interface

### 7.1 Query Flow

```python
@dataclass
class QueryRequest:
    text: str
    corpus_filter: list[str] | None = None   # e.g. ["CODE_LOGIC", "DOC_RUNBOOK"]
    service_filter: str | None = None         # e.g. "auth-service"
    repo_filter: list[str] | None = None     # e.g. ["auth-service", "frontend"]
    top_k: int = 20
    expand_graph: bool = False                # include graph neighbors
    freshness_half_life_days: float = 90.0   # conversation recency decay (0=disabled)
    freshness_weight: float = 0.1            # how much freshness affects score (0=disabled)

@dataclass
class QueryResult:
    chunks: list[Chunk]
    service_context: dict | None   # graph neighborhood if expand_graph=True
```

### 7.2 Retrieval Pipeline

```python
def query(req: QueryRequest) -> QueryResult:
    # 1. Dense search via LanceDB
    query_vec = embed_model.encode(
        "Represent this query for searching relevant code: " + req.text
    )
    lance_results = table.search(query_vec).limit(req.top_k * 2)
    if req.corpus_filter:
        lance_results = lance_results.where(
            f"corpus_type IN {tuple(req.corpus_filter)}"
        )
    if req.service_filter:
        lance_results = lance_results.where(
            f"service_name = '{req.service_filter}'"
        )
    dense_hits = lance_results.to_list()

    # 2. BM25 search (dual tokenization)
    code_tokens = tokenize_code(req.text, CODE_TOKENIZER)
    nlp_tokens = tokenize_code(req.text, NLP_TOKENIZER)
    bm25_code_hits = bm25_index.query(code_tokens, top_k=req.top_k * 2)
    bm25_nlp_hits = bm25_index.query(nlp_tokens, top_k=req.top_k * 2)

    # 3. Reciprocal Rank Fusion (k=60)
    fused = reciprocal_rank_fusion(
        [dense_hits, bm25_code_hits, bm25_nlp_hits],
        k=60,
    )

    # 4. Apply corpus/service filters to BM25 results (post-filter)
    if req.corpus_filter:
        fused = [h for h in fused if h.corpus_type in req.corpus_filter]
    if req.service_filter:
        fused = [h for h in fused if h.service_name == req.service_filter]

    # 5. Rerank top candidates via cross-encoder
    reranked = rerank(req.text, fused[:50], top_k=req.top_k)

    # 6. Apply freshness boost to conversation chunks
    if req.freshness_weight > 0 and req.freshness_half_life_days > 0:
        reranked = apply_freshness_boost(
            reranked,
            half_life_days=req.freshness_half_life_days,
            boost_weight=req.freshness_weight,
        )

    # 7. Graph expansion
    service_context = None
    if req.expand_graph:
        mentioned_services = extract_services_from_results(reranked[:req.top_k])
        service_context = graph.get_neighborhood(mentioned_services, depth=1)

    return QueryResult(
        chunks=reranked[:req.top_k],
        service_context=service_context,
    )
```

### 7.3 Reciprocal Rank Fusion

```python
def reciprocal_rank_fusion(
    result_lists: list[list],
    k: int = 60,
) -> list:
    """Merge multiple ranked lists using RRF. k=60 is the standard constant."""
    scores = {}
    for result_list in result_lists:
        for rank, item in enumerate(result_list):
            item_id = item["id"]
            if item_id not in scores:
                scores[item_id] = {"item": item, "score": 0.0}
            scores[item_id]["score"] += 1.0 / (k + rank + 1)

    ranked = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    return [entry["item"] for entry in ranked]
```

### 7.4 Cross-Encoder Reranker

After RRF fusion, the top-N candidates (default N=50) are refined by a cross-encoder reranker. Unlike bi-encoders (which embed query and document independently), cross-encoders jointly attend over the query-document pair, producing significantly more accurate relevance scores at the cost of higher latency.

**Model:** `cross-encoder/ms-marco-MiniLM-L-6-v2` (22M params, ~10ms per pair on CPU)

This is the starting point. If code-specific reranking quality is insufficient, upgrade to one of:

| Model | Params | Latency (CPU) | Notes |
|-------|--------|---------------|-------|
| `cross-encoder/ms-marco-MiniLM-L-6-v2` | 22M | ~10ms/pair | General-purpose, fast |
| `BAAI/bge-reranker-v2-m3` | 568M | ~50ms/pair | Multilingual, stronger |
| `nomic-ai/CodeRankLLM` | 7B | ~200ms/pair | Code-specific, highest quality, needs GPU |

**Integration in the query pipeline:**

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

def rerank(query: str, candidates: list[dict], top_k: int = 20) -> list[dict]:
    """Rerank RRF candidates using cross-encoder."""
    pairs = [(query, c["text"]) for c in candidates]
    scores = reranker.predict(pairs)
    for candidate, score in zip(candidates, scores):
        candidate["rerank_score"] = float(score)
    ranked = sorted(candidates, key=lambda c: c["rerank_score"], reverse=True)
    return ranked[:top_k]
```

**When to use:** Always. The reranker runs on the top-50 RRF results (not the full corpus), so latency is bounded: 50 pairs * 10ms = ~500ms on CPU. This is acceptable for interactive queries and negligible for batch pipelines.

### 7.5 Conversation Freshness Weighting

For conversation-type chunks (`CONVO_SLACK`, `CONVO_TRANSCRIPT`), recency can be factored into the final score. This is applied as an optional post-rerank multiplier — not baked into embeddings.

```python
import math
from datetime import datetime, timezone

def apply_freshness_boost(
    results: list[dict],
    half_life_days: float = 90.0,
    boost_weight: float = 0.1,
) -> list[dict]:
    """Apply exponential time-decay boost to conversation chunks.

    Args:
        half_life_days: Days until the boost halves. 90 = 3-month half-life.
        boost_weight: How much freshness affects the final score (0-1).
            0.1 means freshness is 10% of the score, relevance is 90%.
    """
    now = datetime.now(timezone.utc)
    for r in results:
        if r.get("corpus_type", "").startswith("CONVO_") and r.get("timestamp"):
            ts = datetime.fromisoformat(r["timestamp"])
            age_days = (now - ts).total_seconds() / 86400
            decay = math.exp(-0.693 * age_days / half_life_days)  # 0.693 = ln(2)
            r["final_score"] = (
                (1 - boost_weight) * r.get("rerank_score", 0)
                + boost_weight * decay
            )
        else:
            r["final_score"] = r.get("rerank_score", 0)
    return sorted(results, key=lambda r: r["final_score"], reverse=True)
```

**Configuration:** Exposed as optional `QueryRequest` parameters:

```python
@dataclass
class QueryRequest:
    text: str
    corpus_filter: list[str] | None = None
    service_filter: str | None = None
    top_k: int = 20
    expand_graph: bool = False
    freshness_half_life_days: float = 90.0   # 0 = disabled
    freshness_weight: float = 0.1            # 0 = disabled
```

When `freshness_half_life_days` is 0 or `freshness_weight` is 0, the boost is skipped entirely. Non-conversation chunks are never affected.

### 7.6 Corpus-Aware Behavior at Query Time

The query interface is unified, but the system can **weight** results by corpus type depending on query characteristics:

| Query Signal              | Boosted Corpus Types              |
|---------------------------|-----------------------------------|
| Contains code identifiers | `CODE_LOGIC`, `CODE_CONFIG`       |
| Contains "deploy/k8s/pod" | `CODE_DEPLOY`, `DOC_RUNBOOK`      |
| Contains "incident/broke" | `CONVO_SLACK`, `DOC_RUNBOOK`      |
| Contains "how to/steps"   | `DOC_RUNBOOK`, `DOC_README`       |
| Default                   | Equal weight across all types     |

This is implemented as a simple keyword-based boost multiplier on the RRF score — not a separate model.

---

## 8. Crawl Job

### 8.1 CLI Entry Point

```python
# rag/crawl.py
"""
Usage:
    python -m rag.crawl \
        --repo-path /path/to/repo \
        --slack-export /path/to/slack-export.json \
        --runbooks /path/to/runbooks/ \
        --output-dir ./data
"""

import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Code Boundaries RAG Crawler")
    parser.add_argument("--repo-path", type=Path, action="append", required=True,
                        help="Path to a git repository root (repeat for multi-repo)")
    parser.add_argument("--repo-name", type=str, action="append", default=None,
                        help="Name for each repo (defaults to directory name)")
    parser.add_argument("--slack-export", type=Path, default=None,
                        help="Path to Slack JSON export")
    parser.add_argument("--transcripts-dir", type=Path, default=None,
                        help="Directory of transcript files")
    parser.add_argument("--runbooks-dir", type=Path, default=None,
                        help="Separate runbooks directory (if outside repo)")
    parser.add_argument("--output-dir", type=Path, default=Path("./data"),
                        help="Output directory for LanceDB and indices")
    parser.add_argument("--incremental", action="store_true",
                        help="Only re-index changed files (by git hash)")

    args = parser.parse_args()

    pipeline = IngestPipeline(output_dir=args.output_dir)

    # Phase 1-2: Crawl code, deploy files, and docs from each repo
    repo_names = args.repo_name or [None] * len(args.repo_path)
    for repo_path, repo_name in zip(args.repo_path, repo_names):
        name = repo_name or repo_path.name
        pipeline.crawl_repo(repo_path, repo_name=name, incremental=args.incremental)
        pipeline.crawl_docs(repo_path, repo_name=name)

    # Phase 3: Crawl external sources
    if args.slack_export:
        pipeline.crawl_slack(args.slack_export)
    if args.transcripts_dir:
        pipeline.crawl_transcripts(args.transcripts_dir)
    if args.runbooks_dir:
        pipeline.crawl_runbooks(args.runbooks_dir)

    # Phase 4: Build service graph from accumulated evidence
    pipeline.build_service_graph()

    # Phase 5: Build BM25 index
    pipeline.build_bm25_index()

    # Phase 6: Write manifest
    pipeline.write_manifest()
```

### 8.2 Incremental Updates

For code and docs, track `git_hash` per file. On re-crawl with `--incremental`:

1. `git diff --name-only <last-indexed-hash>..HEAD` → changed files
2. Delete chunks where `source_uri` matches changed files
3. Re-crawl only changed files
4. Rebuild BM25 index (full rebuild — BM25 indices don't support partial update well)
5. Update service graph edges where evidence chunks were affected

Store the last-indexed commit hash in `data/manifest.json`:

```json
{
    "indexed_at": "2024-01-15T10:30:00Z",
    "chunk_count": 45230,
    "repos": {
        "auth-service": {"last_git_hash": "abc123def", "chunk_count": 12400},
        "frontend": {"last_git_hash": "def456abc", "chunk_count": 8900},
        "user-service": {"last_git_hash": "789fed012", "chunk_count": 10300}
    },
    "corpus_counts": {
        "CODE_LOGIC": 32100,
        "CODE_DEPLOY": 890,
        "CODE_CONFIG": 340,
        "DOC_README": 2100,
        "DOC_RUNBOOK": 450,
        "CONVO_SLACK": 9350
    },
    "service_count": 23,
    "edge_count": 87
}
```

---

## 9. Output: `data/` Directory Layout

```
data/
├── rag.lance/             # LanceDB database directory
│   └── chunks/            # chunks table (vectors + metadata)
├── bm25_index/            # bm25s serialized index
│   ├── vocab.json
│   ├── index.pkl
│   └── doc_ids.json       # maps BM25 doc index → chunk ID
├── service_graph.json     # ServiceNode + ServiceEdge adjacency list
├── manifest.json          # crawl metadata, last git hash, counts
└── models/                # cached embedding model (optional)
    └── CodeRankEmbed/
```

---

## 10. Dockerfile

```dockerfile
FROM python:3.12-slim AS base

WORKDIR /app

# System deps for tree-sitter compilation
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        git \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download embedding model so crawl doesn't fetch at runtime
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('nomic-ai/CodeRankEmbed', trust_remote_code=True)"

# Pre-build tree-sitter grammars
RUN python -c "import tree_sitter_go, tree_sitter_c_sharp, \
    tree_sitter_python, tree_sitter_typescript"

# Copy application code
COPY rag/ ./rag/

# Output volume
VOLUME /data

ENTRYPOINT ["python", "-m", "rag.crawl"]
CMD ["--help"]
```

**`requirements.txt`:**

```
# Embedding + Reranking
sentence-transformers>=3.0
torch>=2.0

# Vector store
lancedb>=0.8
pyarrow>=14.0

# BM25
bm25s>=0.2

# AST parsing
tree-sitter>=0.22
tree-sitter-go>=0.21
tree-sitter-c-sharp>=0.21
tree-sitter-python>=0.21
tree-sitter-typescript>=0.21

# YAML/Markdown parsing
pyyaml>=6.0
mistune>=3.0

# Graph
networkx>=3.0
```

**Build and run:**

```bash
# Build
docker build -t code-rag-crawler .

# Crawl a single repo
docker run --rm \
    -v /path/to/your/repo:/repo:ro \
    -v ./data:/data \
    code-rag-crawler \
    --repo-path /repo \
    --output-dir /data

# Crawl multiple repos
docker run --rm \
    -v /path/to/auth-service:/repos/auth:ro \
    -v /path/to/frontend:/repos/frontend:ro \
    -v /path/to/user-service:/repos/users:ro \
    -v ./data:/data \
    code-rag-crawler \
    --repo-path /repos/auth --repo-name auth-service \
    --repo-path /repos/frontend --repo-name frontend \
    --repo-path /repos/users --repo-name user-service \
    --output-dir /data

# Crawl with Slack export
docker run --rm \
    -v /path/to/your/repo:/repo:ro \
    -v /path/to/slack-export.json:/slack.json:ro \
    -v ./data:/data \
    code-rag-crawler \
    --repo-path /repo \
    --slack-export /slack.json \
    --output-dir /data
```

---

## 11. Project Structure

```
rag/
├── DESIGN.md              # This document
├── Dockerfile
├── requirements.txt
├── rag/
│   ├── __init__.py
│   ├── __main__.py         # python -m rag.crawl entry point
│   ├── crawl.py            # CLI + IngestPipeline orchestrator
│   ├── config.py           # Corpus types, language configs, constants
│   │
│   ├── crawlers/
│   │   ├── __init__.py
│   │   ├── base.py         # BaseCrawler ABC
│   │   ├── code.py         # CodeLogicCrawler (tree-sitter)
│   │   ├── deploy.py       # DeployYAMLCrawler
│   │   ├── docs.py         # DocsCrawler (markdown)
│   │   └── conversation.py # ConversationCrawler (Slack, transcripts)
│   │
│   ├── chunking/
│   │   ├── __init__.py
│   │   ├── ast_chunker.py  # cAST algorithm with tree-sitter
│   │   ├── yaml_chunker.py
│   │   ├── md_chunker.py
│   │   └── thread_chunker.py
│   │
│   ├── boundary/
│   │   ├── __init__.py
│   │   ├── service_calls.py    # Regex + AST-based call detection
│   │   ├── graph.py            # ServiceGraph construction + queries
│   │   └── resolver.py         # Service name resolution
│   │
│   ├── indexing/
│   │   ├── __init__.py
│   │   ├── embedder.py         # CodeRankEmbed wrapper
│   │   ├── lance_store.py      # LanceDB read/write
│   │   ├── bm25_store.py       # bm25s index build/query
│   │   └── tokenizer.py        # Code-aware + NLP tokenizers
│   │
│   ├── retrieval/
│   │   ├── __init__.py
│   │   ├── query.py            # Unified query interface
│   │   └── fusion.py           # RRF implementation
│   │
│   └── models/
│       ├── __init__.py
│       └── chunk.py            # Chunk dataclass + schema
│
├── tests/
│   ├── test_ast_chunker.py
│   ├── test_tokenizer.py
│   ├── test_service_calls.py
│   ├── test_graph.py
│   ├── test_fusion.py
│   └── fixtures/
│       ├── sample.go
│       ├── sample.cs
│       ├── sample.py
│       ├── sample.ts
│       ├── deployment.yaml
│       └── slack_export.json
│
└── data/                  # Gitignored, generated by crawl
    └── .gitkeep
```

---

## 12. Key Design Decisions and Rationale

### D1: Single embedding model for all content types

**Decision:** Use CodeRankEmbed for code, docs, and conversations — no per-type models.

**Rationale:** CodeRankEmbed is trained on CoRNStack, which includes both code and natural language. Maintaining separate models (a code model + a text model) would require either separate vector tables or a shared embedding space, and the alignment problem between two different models is harder than the modest quality gap from using one good model for both. The BM25 index compensates: keyword matches in conversations don't need perfect semantic embeddings.

**Trade-off:** If conversation retrieval quality is measurably poor, we can add a second model later and use a separate LanceDB table. The unified chunk schema supports this — just add a second `vector_text` column.

### D2: BM25 as separate index, not LanceDB full-text

**Decision:** Use `bm25s` as a standalone index rather than LanceDB's built-in FTS.

**Rationale:** LanceDB's FTS uses Tantivy under the hood, which is solid, but doesn't support custom tokenization without forking. Our code-aware tokenizer (camelCase/snake_case splitting, language-specific stop words) is essential for code recall. `bm25s` accepts arbitrary pre-tokenized input.

**Trade-off:** Two separate indices to maintain. The BM25 index must be fully rebuilt on updates (no incremental insert). For our expected corpus sizes (<500k chunks), full BM25 rebuild is fast (seconds).

### D3: Dual tokenization at query time

**Decision:** Run the query through both the code tokenizer and the NLP tokenizer, producing two BM25 result sets that feed into RRF.

**Rationale:** A user query might be natural language ("how does authentication work") or contain code identifiers ("getUserProfile returns null"). We don't know which at query time. Running both tokenizers and fusing results handles both cases without query classification.

### D4: Service graph as separate artifact, not embedded in vector search

**Decision:** The service dependency graph is a JSON file loaded at query time, not stored in LanceDB or used as an embedding.

**Rationale:** Graph relationships are structural, not semantic. "auth-service calls user-service" is a fact, not something that benefits from approximate nearest neighbor search. Graph traversal (BFS/DFS for blast radius, neighbor lookup for contract surface) is the right operation. Mixing graph edges into vector space would dilute both.

### D5: Thread-level chunking for conversations

**Decision:** Chunk Slack by thread, not by individual message.

**Rationale:** Individual messages lack context. "Yes, that's the issue" is meaningless without the thread. The thread is the minimum semantic unit. For long threads, we split by message boundaries (never mid-message) while preserving thread ID so results can be expanded to full thread at display time.

### D6: Tree-sitter over regex-only for boundary detection

**Decision:** Use tree-sitter AST parsing as the primary code chunker and service-call detector, with regex patterns as supplementary heuristics.

**Rationale:** Regex can't reliably distinguish a function call from a variable name or string literal. Tree-sitter gives us actual AST nodes — we know `http.Get(url)` is a `call_expression`, not a comment mentioning it. For Go, C#, Python, and TypeScript, tree-sitter grammars are mature and well-maintained.

**Trade-off:** Tree-sitter requires per-language grammars and compilation. The four target languages (Go, C#, Python, TypeScript) all have stable tree-sitter grammars. Unsupported languages fall back to sliding-window chunking with regex-only call detection.

---

## 13. Resolved Decisions

| # | Question | Decision |
|---|----------|----------|
| Q1 | Reranker? | **Yes.** Cross-encoder reranker added to pipeline (Section 7.4). Start with `ms-marco-MiniLM-L-6-v2`, upgrade to `CodeRankLLM` if code-specific quality is needed. |
| Q2 | Conversation freshness? | **Yes.** Exponential decay with configurable half-life, applied as optional post-rerank multiplier (Section 7.5). |
| Q3 | Multi-repo? | **Yes.** `repo_name` field on all chunks, `--repo-path` accepts multiple values, per-repo git hash tracking in manifest, `repo_filter` on queries. |
| Q5 | gRPC / Proto parsing? | **Not needed.** Stack is HTTP-only. No gRPC in the target codebase. |

---

## 14. Open Questions

### Q1: Embedding model upgrade path

CodeRankEmbed (137M params, Dec 2024) is the right starting point. If we later need higher quality, the upgrade requires:
- Re-embed all chunks (batch job)
- Adjust vector dimension in LanceDB schema
- No changes to BM25, graph, or query interface

**Candidate upgrades:**

| Model | Params | CoIR NDCG@10 | License | GPU Required | Notes |
|-------|--------|-------------|---------|-------------|-------|
| CodeRankEmbed (current) | 137M | 60.1 | Apache 2.0 | No | CPU-friendly baseline |
| Qodo-Embed-1-1.5B | 1.5B | 68.5 | OpenRAIL++ | Yes (~6GB) | Best mid-tier option |
| KaLM-Embedding-Gemma3-12B | 12.2B | Not published | Tencent community | Yes (~24GB) | MTEB #1, no CoIR scores yet |
| Nomic Embed Code | 7B | SOTA (unreported) | Apache 2.0 | Yes (~14GB) | Successor to CodeRankEmbed |

**On KaLM-Embedding specifically:** Currently #1 on MMTEB (general text retrieval score 75.66, overall mean 72.32). However, it has **no published CoIR/code-specific retrieval benchmarks**. It's a 12.2B model requiring ~24GB VRAM (BF16) or ~8-12GB (Q4 quantized). GGUF quantizations are available. Until CoIR scores are published, we cannot evaluate its code retrieval quality vs CodeRankEmbed. Worth re-evaluating once code benchmarks appear.

### Q2: Reranker upgrade to code-specific model

The initial cross-encoder (`ms-marco-MiniLM-L-6-v2`) is general-purpose. If code retrieval precision is insufficient, upgrade to `nomic-ai/CodeRankLLM` (7B, code-specific reranker). This requires GPU and increases rerank latency from ~500ms to ~10s for 50 candidates. Evaluate before upgrading.

### Q3: OpenAPI / Swagger spec parsing

For HTTP services, OpenAPI specs (if available) are the definitive service contract. A dedicated crawler could extract endpoint definitions, request/response schemas, and authentication requirements. **Recommendation:** Add as a follow-up if OpenAPI specs exist in the repos.
