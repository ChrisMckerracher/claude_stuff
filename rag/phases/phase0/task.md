# Phase 0: Core Protocols & Types

## Overview

**Deliverable:** All interfaces, types, and contracts defined. Zero implementation.

**Why First:** This is your "specification" - reviewable, verifiable by inspection, no runtime needed.

**Custom Code:** 0 lines (all contracts/interfaces)

**Dependencies:** None

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/core/types.py` | ChunkID, RawChunk, CleanChunk, EmbeddedChunk, CorpusType | ~80 |
| `rag/core/protocols.py` | VectorStore, GraphStore, Chunker, Scrubber, Embedder, Crawler protocols | ~120 |
| `rag/core/schema.py` | EntityType, RelationType, Entity, Relationship | ~50 |
| `rag/core/errors.py` | RAGError hierarchy with retry semantics | ~50 |

## Tasks

- [ ] [Task 1: Define Core Data Types](task1.md)
- [ ] [Task 2: Define Storage Protocols](task2.md)
- [ ] [Task 3: Define Processing Protocols](task3.md)
- [ ] [Task 4: Define Entity Schema](task4.md)
- [ ] [Task 5: Define Error Types](task5.md)

## Verification Checklist

- [ ] All types are immutable or clearly mutable
- [ ] All protocols have docstrings specifying behavior
- [ ] No protocol method has side effects not mentioned in name
- [ ] Every async method that could fail has error type documented
- [ ] Entity/Relationship schema covers all design doc examples
- [ ] Type checker passes with strict mode

## Quick Check

```bash
python -c "
from rag.core.types import ChunkID, RawChunk, CleanChunk, EmbeddedChunk, CorpusType
from rag.core.protocols import VectorStore, GraphStore, Chunker, Scrubber, Embedder
from rag.core.schema import EntityType, RelationType, Entity, Relationship
from rag.core.errors import RAGError, StorageError, ChunkingError
print('QUICK CHECK PASSED: All core types import successfully')
"
```

## Next Phase

Upon completion, proceed to [Phase 1: Chunking Pipeline](../phase1/task.md)
