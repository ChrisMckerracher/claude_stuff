# Phase 3: LanceDB Vector Store

## Overview

**Deliverable:** Working vector store with LanceDB. Fully testable locally.

**Custom Code:** ~50 lines

**Dependencies:** LanceDB (embedded, no server needed)

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/indexing/lance_store.py` | LanceDB VectorStore implementation | ~40 |
| `rag/indexing/embedder.py` | Jina embeddings wrapper | ~25 |

## Tasks

- [x] [Task 1: LanceDB Store Implementation](task1.md)
- [x] [Task 2: Embedder Implementation](task2.md)

## Verification Checklist

- [x] LanceStore implements VectorStore protocol
- [x] Insert is idempotent (same ID doesn't duplicate)
- [x] Search returns results sorted by similarity
- [x] Filters work correctly (corpus_type, service_name)
- [x] Deletion works
- [x] Embedder dimension matches config (768)

## Quick Check

```bash
python -c "
import tempfile
from rag.indexing import LanceStore, CodeRankEmbedder
from rag.core.types import CleanChunk, ChunkID, CorpusType, EmbeddedChunk
import asyncio

async def test():
    with tempfile.TemporaryDirectory() as d:
        store = LanceStore(db_path=d)
        embedder = CodeRankEmbedder()

        chunk = CleanChunk(
            id=ChunkID.from_content('test', 0, 100),
            text='hello world',
            source_uri='test.py',
            corpus_type=CorpusType.CODE_LOGIC,
            context_prefix='',
            metadata={},
            scrub_log=[]
        )
        vector = embedder.embed(chunk.text)
        await store.insert(EmbeddedChunk(chunk=chunk, vector=vector))

        results = await store.search(vector, limit=1)
        assert len(results) == 1
        print('QUICK CHECK PASSED: LanceDB store works')

asyncio.run(test())
"
```

## Prerequisites

- Phase 0 complete (protocols defined)
- Phase 1 complete (chunks available)
- Phase 2 complete (clean chunks)
- Install: `pip install lancedb sentence-transformers`

## Next Phase

Upon completion, proceed to [Phase 4: Service Extraction](../phase4/task.md)
