# Phase 7: Orchestrator

## Overview

**Deliverable:** End-to-end ingestion pipeline with Dagster assets. Testable with mocks.

**Custom Code:** ~200 lines

**Dependencies:** Dagster for orchestration

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/pipeline/orchestrator.py` | Main ingestion orchestration | ~100 |
| `rag/pipeline/assets.py` | Dagster asset definitions | ~100 |

## Tasks

- [ ] [Task 1: Ingestion Orchestrator](task1.md)
- [ ] [Task 2: Dagster Assets](task2.md)

## Verification Checklist

- [ ] Full pipeline runs with all mocks
- [ ] Stats accurately reflect work done
- [ ] Errors are collected, not thrown
- [ ] Code and text paths both work
- [ ] Integration test with real files passes
- [ ] `dagster dev` shows all assets green

## Quick Check

```bash
python -c "
from rag.pipeline import IngestionOrchestrator
from rag.crawlers import CodeCrawler
from rag.chunking import ASTChunker, TokenCounter
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.indexing import LanceStore, MockEmbedder
from rag.graphiti import MockGraphStore

# Verify all components wire together
orchestrator = IngestionOrchestrator(
    crawler=CodeCrawler(),
    chunker=ASTChunker(TokenCounter()),
    scrubber=PresidioScrubber(Pseudonymizer()),
    embedder=MockEmbedder(),
    vector_store=LanceStore('./test_lance'),
    graph_store=MockGraphStore(),
)
print('QUICK CHECK PASSED: Orchestrator instantiates')
"
```

## Prerequisites

- Phases 1-6 complete
- Install: `pip install dagster dagster-webserver`

## Next Phase

Upon completion, proceed to [Phase 8: Graphiti Integration](../phase8/task.md)
