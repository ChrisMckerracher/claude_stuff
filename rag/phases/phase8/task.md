# Phase 8: Graphiti Integration (Post-MVP)

## Overview

**Deliverable:** Real Graphiti working with Neo4j. Production ready.

**This is the ONLY phase requiring external services (Neo4j + LLM API).**

**Custom Code:** ~100 lines (mostly adapter code)

**Dependencies:** Neo4j (Docker or Aura), LLM API (Anthropic/OpenAI)

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/graphiti/client.py` | GraphitiStore implementation | ~70 |
| `rag/graphiti/factory.py` | Factory for mock vs real graph store | ~30 |

## Tasks

- [ ] [Task 1: Neo4j Setup](task1.md)
- [ ] [Task 2: Graphiti Client](task2.md)
- [ ] [Task 3: Migration from Mock](task3.md)

## Verification Checklist

- [ ] Neo4j connection works
- [ ] Graphiti entity extraction functions
- [ ] All MockGraphStore tests pass with GraphitiStore
- [ ] End-to-end ingestion works with real graph
- [ ] Hybrid retrieval produces quality results

## Quick Check

```bash
# Requires Neo4j running and environment variables set
python -c "
import os
from rag.graphiti import GraphitiStore

if not os.environ.get('NEO4J_URI'):
    print('SKIP: NEO4J_URI not set')
else:
    store = GraphitiStore.from_env()
    print('QUICK CHECK PASSED: GraphitiStore connects')
"
```

## Prerequisites

- Phases 0-7 complete (full pipeline working with mocks)
- Neo4j running (Docker or Aura)
- Environment variables:
  - `NEO4J_URI`
  - `NEO4J_USER`
  - `NEO4J_PASSWORD`
  - `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

## Environment Setup

```bash
# Option 1: Docker
docker run -d \
  --name neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/password \
  neo4j:latest

# Option 2: Neo4j Aura (cloud)
# Create free instance at https://neo4j.com/cloud/aura/

# Set environment
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=password
export ANTHROPIC_API_KEY=sk-ant-...
```

## Next Phase

This is the final MVP phase. Post-MVP work includes:
- Phase 9: Conversation Loader (Slack/transcript ingestion)
- Performance optimization
- Advanced query features
