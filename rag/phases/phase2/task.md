# Phase 2: PHI Scrubbing

## Overview

**Deliverable:** Working PHI scrubber with consistent pseudonymization. Testable with synthetic data.

**Custom Code:** ~50 lines

**Dependencies:** Presidio (local), spaCy model (download once)

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/scrubbing/scrubber.py` | Presidio-based PHI scrubbing | ~35 |
| `rag/scrubbing/pseudonymizer.py` | Consistent fake data replacement | ~25 |

## Tasks

- [ ] [Task 1: Scrubber Core](task1.md)
- [ ] [Task 2: Pseudonymizer](task2.md)

## Verification Checklist

- [ ] All PII types from design doc detected (PERSON, EMAIL, PHONE, SSN)
- [ ] Pseudonymization is deterministic (same input -> same output)
- [ ] Audit log captures what was replaced
- [ ] Code identifiers NOT scrubbed (function names, variable names)
- [ ] Tests with synthetic PII pass

## Quick Check

```bash
python -c "
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.core.types import RawChunk, ChunkID, CorpusType
scrubber = PresidioScrubber(Pseudonymizer())
chunk = RawChunk(
    id=ChunkID.from_content('test', 0, 100),
    text='Contact john@example.com for help',
    source_uri='test.py',
    corpus_type=CorpusType.CODE_LOGIC,
    byte_range=(0, 100),
    metadata={}
)
clean = scrubber.scrub(chunk)
assert 'john@example.com' not in clean.text
print('QUICK CHECK PASSED: PHI scrubbing works')
"
```

## Prerequisites

- Phase 0 complete (types defined)
- Phase 1 complete (chunks available)
- Install: `pip install presidio-analyzer presidio-anonymizer`
- Download spaCy model: `python -m spacy download en_core_web_lg`

## Next Phase

Upon completion, proceed to [Phase 3: LanceDB Store](../phase3/task.md)
