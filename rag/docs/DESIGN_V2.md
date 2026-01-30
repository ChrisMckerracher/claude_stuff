# RAG v2 Design: LanceDB + Graphiti

## Overview

Simplified architecture using two storage backends:
- **LanceDB**: Vector similarity search over code/doc chunks
- **Graphiti**: Knowledge graph for entities and relationships

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ingestion Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Sources              Crawlers              Processing          │
│   ───────              ────────              ──────────          │
│   Git repos    →    CodeCrawler      →    AST Chunking           │
│   Slack        →    SlackCrawler     →    Thread Chunking        │
│   Docs         →    DocsCrawler      →    Markdown Chunking      │
│   Transcripts  →    TranscriptCrawler →   Thread Chunking        │
│                                                                  │
│                            ↓                                     │
│                     PHI Scrubbing                                │
│                     (Presidio)                                   │
│                            ↓                                     │
│              ┌─────────────┴─────────────┐                       │
│              ↓                           ↓                       │
│     ┌────────────────┐          ┌────────────────┐               │
│     │    LanceDB     │          │    Graphiti    │               │
│     │  (embeddings)  │          │  (entities)    │               │
│     └────────────────┘          └────────────────┘               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        Retrieval Layer                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Query → ┌─────────────┐    ┌─────────────┐                     │
│           │ LanceDB     │    │ Graphiti    │                     │
│           │ vector      │    │ graph       │                     │
│           │ search      │    │ traversal   │                     │
│           └──────┬──────┘    └──────┬──────┘                     │
│                  └────────┬─────────┘                            │
│                           ↓                                      │
│                      Reranker                                    │
│                           ↓                                      │
│                      Results                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. LanceDB (Vector Store)

**Purpose**: Semantic similarity search over chunks

**Schema**:
```python
{
    "id": str,              # SHA256(source_uri + byte_range)
    "text": str,            # Chunk content
    "vector": list[float],  # 768-dim CodeRankEmbed
    "source_uri": str,      # File path or message ID
    "corpus_type": str,     # CODE_LOGIC, DOC_README, CONVO_SLACK, etc.
    "context_prefix": str,  # file > class > function

    # Code-specific
    "language": str,
    "symbol_name": str,
    "symbol_kind": str,     # function, class, method
    "signature": str,

    # Conversation-specific
    "author": str,
    "channel": str,
    "timestamp": str,
}
```

**Queries**:
- "Find code similar to this function"
- "Find docs mentioning authentication"
- "Find conversations about deployment"

### 2. Graphiti (Knowledge Graph)

**Purpose**: Entity extraction, relationship tracking, graph traversal

**Entity Types**:
```python
Service     # Microservice (auth-service, payment-api)
Person      # Team member
Incident    # Production incident
Decision    # Architecture decision
Endpoint    # API endpoint (/api/v1/users)
Queue       # Message queue (user-events)
Database    # Data store (users-db)
```

**Relationship Types**:
```python
CALLS           # Service → Service (HTTP, gRPC)
PUBLISHES_TO    # Service → Queue
SUBSCRIBES_TO   # Service → Queue
READS_FROM      # Service → Database
WRITES_TO       # Service → Database
OWNS            # Person → Service
MENTIONS        # Conversation → Service
CAUSED          # Change → Incident
RESOLVED        # Person → Incident
DECIDED         # Decision → Service
```

**Queries**:
- "What services does auth-service call?"
- "Who owns payment-api?"
- "What incidents affected user-service?"
- "What decisions mention the billing system?"

### 3. Custom Ingestion (Keep)

#### AST Chunking (tree-sitter)
- Deterministic code parsing
- Function/class boundary detection
- Import extraction
- Service call detection

```python
# These feed BOTH stores:
# 1. Chunk → LanceDB (for similarity search)
# 2. Relationships → Graphiti (CALLS, IMPORTS edges)
```

#### PHI Scrubbing (Presidio)
- Required before any storage
- Consistent pseudonymization
- Audit logging

#### Tokenizer
- Model-aligned token counting (CodeRankEmbed tokenizer)
- Accurate chunk sizing

## What's Removed

| Component | Reason |
|-----------|--------|
| BM25Store | Graphiti has built-in search |
| NetworkX ServiceGraph | Replaced by Neo4j via Graphiti |
| Custom tokenizer.py | Keep only for BM25-style splits if needed |

## Data Flow

### Code Ingestion

```python
async def ingest_code(source: CrawlSource) -> None:
    for chunk in code_crawler.crawl(source):
        # 1. Scrub PHI
        clean = scrubber.scrub(chunk)

        # 2. Embed and store in LanceDB
        embedded = embedder.embed(clean)
        await lance_store.insert(embedded)

        # 3. Extract relationships for Graphiti
        imports = extract_imports(chunk.source, chunk.language)
        calls = detect_service_calls(chunk.source, chunk.language)

        # 4. Add to knowledge graph
        for imp in imports:
            await graphiti.add_episode(
                f"{chunk.repo_name} imports {imp.module}",
                source="ast_analysis"
            )
        for call in calls:
            await graphiti.add_episode(
                f"{chunk.repo_name} calls {call.target} via {call.protocol}",
                source="ast_analysis"
            )
```

### Conversation Ingestion

```python
async def ingest_conversation(source: CrawlSource) -> None:
    for chunk in slack_crawler.crawl(source):
        # 1. Scrub PHI
        clean = scrubber.scrub(chunk)

        # 2. Embed and store in LanceDB
        embedded = embedder.embed(clean)
        await lance_store.insert(embedded)

        # 3. Let Graphiti extract entities (LLM-based)
        await graphiti.add_episode(
            clean.text,
            source=f"slack:#{chunk.channel}"
        )
        # Graphiti automatically extracts:
        # - Services mentioned
        # - People involved
        # - Incidents discussed
```

### Hybrid Retrieval

```python
async def search(query: str, top_k: int = 10) -> list[Result]:
    # 1. Vector search (semantic similarity)
    vector_results = await lance_store.search(
        query=query,
        limit=top_k,
    )

    # 2. Graph search (entity + relationship)
    graph_results = await graphiti.search(
        query=query,
        num_results=top_k,
    )

    # 3. Expand via graph traversal
    entities = [r.entity for r in graph_results]
    related = await graphiti.get_related_entities(
        entities,
        edge_types=["CALLS", "OWNS", "MENTIONS"],
        max_hops=2,
    )

    # 4. Fetch chunks for related entities
    related_chunks = await lance_store.search_by_metadata(
        filters={"service_name": [e.name for e in related]}
    )

    # 5. Merge and rerank
    all_results = vector_results + related_chunks
    return rerank(all_results, query)[:top_k]
```

## Dependencies

```toml
[project]
dependencies = [
    # Parsing
    "tree-sitter>=0.22",
    "tree-sitter-go>=0.21",
    "tree-sitter-c-sharp>=0.21",
    "tree-sitter-python>=0.21",
    "tree-sitter-typescript>=0.21",
    "mistune>=3.0",

    # PHI Scrubbing
    "presidio-analyzer>=2.2",
    "presidio-anonymizer>=2.2",
    "spacy>=3.7",
    "detect-secrets>=1.4",
    "faker>=22.0",

    # Vector Store
    "lancedb>=0.8",
    "sentence-transformers>=3.0",
    "transformers>=4.36",
    "torch>=2.0",
    "pyarrow>=14.0",

    # Knowledge Graph
    "graphiti-core>=0.3",
    "neo4j>=5.0",
]
```

## Infrastructure

### Required Services

| Service | Purpose | Options |
|---------|---------|---------|
| Neo4j | Graphiti backend | Aura (managed) or self-hosted |
| LLM API | Graphiti extraction | OpenAI, Anthropic, or local |

### Storage

| Store | Location | Size Estimate |
|-------|----------|---------------|
| LanceDB | `./data/lance/` | ~1GB per 100K chunks |
| Neo4j | External service | ~500MB per 100K entities |

## Query Examples

### "Find code that handles user authentication"

```python
# 1. LanceDB: semantic search
chunks = lance_store.search("user authentication handling")
# Returns: auth_middleware.go, login_handler.py, etc.
```

### "What services does auth-service depend on?"

```python
# 2. Graphiti: graph traversal
deps = graphiti.query("""
    MATCH (a:Service {name: 'auth-service'})-[:CALLS]->(b:Service)
    RETURN b.name
""")
# Returns: user-service, redis, postgres
```

### "Show me code related to the payment outage last week"

```python
# 3. Hybrid: entity lookup + vector search
incident = graphiti.search("payment outage last week")[0]
related_services = graphiti.get_related(incident, "AFFECTED")
chunks = lance_store.search(
    query="payment error handling",
    filters={"service_name": related_services}
)
```

## Migration from v1

### Phase 1: Add Graphiti
1. Set up Neo4j
2. Add Graphiti client
3. Dual-write to both NetworkX and Graphiti

### Phase 2: Migrate Data
1. Export NetworkX graph to Graphiti
2. Re-ingest conversations with Graphiti extraction
3. Validate entity/relationship counts

### Phase 3: Remove v1 Components
1. Remove BM25Store
2. Remove NetworkX ServiceGraph
3. Update retrieval to use Graphiti only

### Phase 4: Optimize
1. Tune Graphiti extraction prompts
2. Benchmark hybrid retrieval
3. Add caching if needed

## File Structure (Simplified)

```
rag/
├── chunking/
│   ├── ast_chunker.py      # tree-sitter code chunking
│   ├── md_chunker.py       # markdown chunking
│   ├── thread_chunker.py   # conversation chunking
│   └── token_counter.py    # model-aligned counting
├── crawlers/
│   ├── code.py             # git repo crawler
│   ├── docs.py             # markdown crawler
│   └── conversation.py     # slack/transcript crawler
├── scrubbing/
│   ├── scrubber.py         # Presidio wrapper
│   └── pseudonymizer.py    # consistent replacement
├── indexing/
│   ├── embedder.py         # CodeRankEmbed
│   └── lance_store.py      # LanceDB operations
├── graphiti/
│   ├── client.py           # Graphiti wrapper
│   ├── schema.py           # entity/edge definitions
│   └── ingestion.py        # code + conversation ingestion
├── retrieval/
│   ├── hybrid.py           # combined vector + graph
│   └── reranker.py         # result fusion
└── pipeline/
    └── orchestrator.py     # end-to-end ingestion
```

## Summary

| Concern | v1 Solution | v2 Solution |
|---------|-------------|-------------|
| Semantic search | LanceDB | LanceDB (unchanged) |
| Keyword search | BM25 | Graphiti search |
| Service graph | NetworkX | Graphiti/Neo4j |
| Entity extraction | Manual regex | Graphiti LLM |
| Relationship tracking | Custom code | Graphiti |
| Code parsing | tree-sitter | tree-sitter (unchanged) |
| PHI scrubbing | Presidio | Presidio (unchanged) |

**Result**: Fewer moving parts, unified graph backend, LLM-powered entity extraction.
