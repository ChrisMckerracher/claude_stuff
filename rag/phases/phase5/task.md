# Phase 5: Retrieval Layer

## Overview

**Deliverable:** Hybrid retrieval combining vector and graph search. Testable with mocks.

**Custom Code:** ~150 lines

**Dependencies:** Phases 3 (LanceDB) and 4 (MockGraphStore)

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/retrieval/hybrid.py` | HybridRetriever combining vector + graph | ~100 |
| `rag/retrieval/reranker.py` | Result deduplication and reranking | ~50 |

## Tasks

- [ ] [Task 1: Hybrid Retriever](task1.md)
- [ ] [Task 2: Reranker](task2.md)

## Verification Checklist

- [ ] Vector-only search works
- [ ] Graph expansion finds related entities
- [ ] Results are deduplicated
- [ ] Reranking preserves best results
- [ ] Full integration test with MockGraphStore passes

## Quick Check

```bash
python -c "
from rag.retrieval import HybridRetriever
from rag.indexing import LanceStore, MockEmbedder
from rag.graphiti import MockGraphStore
import asyncio

async def test():
    retriever = HybridRetriever(
        vector_store=LanceStore('./test_lance'),
        graph_store=MockGraphStore(),
        embedder=MockEmbedder(),
    )
    # Just verify construction works
    print('QUICK CHECK PASSED: HybridRetriever instantiates')

asyncio.run(test())
"
```

## Prerequisites

- Phase 3 complete (LanceStore, Embedder)
- Phase 4 complete (MockGraphStore for graph expansion)

## Next Phase

Upon completion, proceed to [Phase 6: Crawlers](../phase6/task.md)
