# Graphiti Integration Plan

## Overview

This document outlines the integration of [Graphiti](https://github.com/getzep/graphiti) into the existing RAG pipeline to add knowledge graph capabilities alongside vector search.

## Current Architecture

```
Crawlers → Chunkers → PHI Scrubbing → Embedder → Storage
                                                    ├── LanceDB (vectors)
                                                    ├── BM25 (keywords)
                                                    └── NetworkX (service graph)
```

**Current capabilities:**
- Semantic search via LanceDB (768-dim CodeRankEmbed vectors)
- Keyword search via BM25
- Service dependency graph via NetworkX (from AST analysis)

**Limitations:**
- No entity extraction from unstructured text (Slack, docs)
- No temporal tracking of relationships
- Service graph only captures code-level dependencies

## What Graphiti Adds

| Capability | Current | With Graphiti |
|------------|---------|---------------|
| Code relationships | tree-sitter (deterministic) | tree-sitter + Graphiti |
| Doc/Slack relationships | None | LLM extraction |
| Temporal awareness | None | Versioned facts |
| Entity linking | None | Cross-source entity resolution |
| Semantic search | LanceDB | LanceDB + Graphiti embeddings |

## Proposed Architecture

```
                           ┌─────────────────────────────────┐
                           │         Graphiti + Neo4j        │
                           │   (entities + relationships)    │
                           └─────────────────────────────────┘
                                          ↑
                    ┌─────────────────────┴─────────────────────┐
                    │                                           │
         ┌──────────┴──────────┐                 ┌──────────────┴──────────────┐
         │  tree-sitter AST    │                 │   Graphiti LLM Extraction   │
         │  (deterministic)    │                 │   (fuzzy, from text)        │
         └──────────┬──────────┘                 └──────────────┬──────────────┘
                    │                                           │
         ┌──────────┴──────────┐                 ┌──────────────┴──────────────┐
         │   Code Chunks       │                 │   Doc/Slack Chunks          │
         │   (CODE_LOGIC)      │                 │   (DOC_*, CONVO_*)          │
         └─────────────────────┘                 └─────────────────────────────┘

                           ┌─────────────────────────────────┐
                           │           LanceDB               │
                           │   (vector search over chunks)   │
                           └─────────────────────────────────┘
```

## What We Keep

### LanceDB (vector store)
- Semantic search over chunks
- Fast similarity queries
- Metadata filtering

### tree-sitter (code parsing)
- Deterministic relationship extraction
- `extract_imports()` → IMPORTS edges
- `detect_service_calls()` → CALLS edges
- AST-based chunking

### BM25 (keyword search)
- Exact term matching
- Code identifier search

## What Graphiti Replaces

### NetworkX ServiceGraph → Neo4j
- Current: `rag/boundary/graph.py` using NetworkX
- New: Graphiti's Neo4j backend
- Migration: Feed existing `ServiceGraph` data into Graphiti

## Integration Points

### 1. Code Relationship Ingestion

Feed tree-sitter extractions into Graphiti:

```python
# rag/graphiti/code_ingestion.py

from graphiti_core import Graphiti
from rag.boundary.service_calls import detect_service_calls
from rag.boundary.imports import extract_imports

async def ingest_code_relationships(
    graphiti: Graphiti,
    chunk: CleanChunk,
    source: bytes,
    language: str,
) -> None:
    """Ingest deterministic code relationships into Graphiti."""

    # Service calls (HTTP, queue, DB)
    for call in detect_service_calls(source, language):
        await graphiti.add_episode(
            name=f"service_call:{chunk.source_uri}:{call.line}",
            episode_body=f"{chunk.repo_name} calls {call.target_service} via {call.call_type}",
            source_description="AST analysis",
        )

    # Import relationships
    for imp in extract_imports(source, language):
        await graphiti.add_episode(
            name=f"import:{chunk.source_uri}:{imp.line}",
            episode_body=f"{chunk.file_path} imports {imp.module}",
            source_description="AST analysis",
        )
```

### 2. Conversation/Doc Extraction

Let Graphiti extract entities from unstructured text:

```python
# rag/graphiti/text_ingestion.py

async def ingest_conversation(
    graphiti: Graphiti,
    chunk: CleanChunk,
) -> None:
    """Let Graphiti extract entities from conversations."""

    await graphiti.add_episode(
        name=f"conversation:{chunk.id}",
        episode_body=chunk.text,
        source_description=f"Slack #{chunk.channel}" if chunk.channel else "transcript",
        # Graphiti's LLM will extract:
        # - People mentioned
        # - Services discussed
        # - Incidents referenced
        # - Decisions made
    )
```

### 3. Custom Entity Types

Define domain-specific entity types:

```python
# rag/graphiti/schema.py

from graphiti_core.nodes import EntityNode
from graphiti_core.edges import EntityEdge

class ServiceEntity(EntityNode):
    """A microservice in our system."""
    label = "Service"

class PersonEntity(EntityNode):
    """A team member."""
    label = "Person"

class IncidentEntity(EntityNode):
    """A production incident."""
    label = "Incident"

# Relationship types
class CallsEdge(EntityEdge):
    """Service A calls Service B."""
    label = "CALLS"
    properties = ["protocol", "async", "file_path"]

class OwnsEdge(EntityEdge):
    """Person owns a service."""
    label = "OWNS"
    properties = ["role", "since"]

class CausedEdge(EntityEdge):
    """Change caused an incident."""
    label = "CAUSED"
    properties = ["timestamp", "severity"]
```

### 4. Hybrid Retrieval

Query both vector store and knowledge graph:

```python
# rag/retrieval/hybrid.py

async def hybrid_search(
    query: str,
    lance_store: LanceStore,
    graphiti: Graphiti,
    top_k: int = 10,
) -> list[SearchResult]:
    """Combine vector search with graph traversal."""

    # 1. Vector search for semantically similar chunks
    vector_results = await lance_store.search(query, limit=top_k)

    # 2. Extract entities from query
    query_entities = await graphiti.search(query, limit=5)

    # 3. Expand via graph relationships
    related_entities = []
    for entity in query_entities:
        neighbors = await graphiti.get_neighbors(
            entity.uuid,
            edge_types=["CALLS", "OWNS", "MENTIONS"],
            max_hops=2,
        )
        related_entities.extend(neighbors)

    # 4. Fetch chunks for related entities
    graph_chunks = await get_chunks_for_entities(related_entities, lance_store)

    # 5. Merge and rerank
    return rerank(vector_results + graph_chunks, query)
```

## Dependencies

Add to `pyproject.toml`:

```toml
[project]
dependencies = [
    # ... existing deps ...

    # Graphiti
    "graphiti-core>=0.3",
    "neo4j>=5.0",
]
```

## Infrastructure Requirements

### Neo4j
- **Option 1**: Neo4j Aura (managed, free tier available)
- **Option 2**: Self-hosted Neo4j Community Edition
- **Memory**: 2-4GB minimum for graph operations

### LLM for Extraction
- Graphiti uses OpenAI/Anthropic for entity extraction
- Cost: ~$0.01-0.05 per chunk for extraction
- Can batch to reduce API calls

## Migration Steps

### Phase 1: Add Graphiti Infrastructure
1. [ ] Add Graphiti dependencies to `pyproject.toml`
2. [ ] Set up Neo4j (local Docker or Aura)
3. [ ] Create Graphiti client wrapper

### Phase 2: Define Schema
1. [ ] Define entity types (Service, Person, Incident, etc.)
2. [ ] Define edge types (CALLS, OWNS, MENTIONS, etc.)
3. [ ] Map existing `ServiceGraph` relationships to schema

### Phase 3: Code Relationship Ingestion
1. [ ] Create adapter to feed tree-sitter extractions to Graphiti
2. [ ] Migrate existing `ServiceGraph` data to Neo4j
3. [ ] Validate deterministic relationships preserved

### Phase 4: Text Extraction
1. [ ] Enable Graphiti LLM extraction for DOC_* chunks
2. [ ] Enable for CONVO_* chunks (Slack, transcripts)
3. [ ] Review extraction quality, tune prompts

### Phase 5: Hybrid Retrieval
1. [ ] Implement hybrid search combining LanceDB + Graphiti
2. [ ] Add reranking logic
3. [ ] Benchmark retrieval quality

## Rollback Plan

If Graphiti doesn't work out:
1. NetworkX `ServiceGraph` remains functional
2. LanceDB vector search unaffected
3. Can disable Graphiti ingestion without data loss

## Decision: Keep LanceDB?

**Yes, keep LanceDB.** Here's why:

| Query Type | Best Tool |
|------------|-----------|
| "Find code similar to X" | LanceDB (vector similarity) |
| "What calls auth-service?" | Graphiti (graph traversal) |
| "Who owns payment-service?" | Graphiti (entity lookup) |
| "Code mentioning retry logic" | BM25 (keyword) + LanceDB |

Graphiti's semantic search is optimized for entity resolution, not chunk-level similarity. LanceDB remains the right tool for "find similar code" queries.

## Open Questions

1. **LLM cost**: How many chunks need Graphiti extraction vs. tree-sitter only?
2. **Extraction quality**: How reliable is entity extraction from Slack messages?
3. **Neo4j hosting**: Self-host or use Aura managed service?
4. **Query latency**: Acceptable to add graph traversal to retrieval path?

## References

- [Graphiti Documentation](https://github.com/getzep/graphiti)
- [Graphiti + LangChain](https://python.langchain.com/docs/integrations/graphs/graphiti)
- [Neo4j Python Driver](https://neo4j.com/docs/python-manual/current/)
