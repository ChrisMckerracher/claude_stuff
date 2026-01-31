# Phase 2: PHI Scrubbing

## Overview

**Deliverable:** Working PHI scrubber with consistent pseudonymization. Testable with synthetic data.

**Custom Code:** ~80 lines

**Dependencies:** Presidio (local), spaCy model (optional - for PERSON/LOCATION detection)

## NLP Backend Architecture

The scrubber uses a **pluggable NLP backend** design. See [NLP_BACKENDS.md](../../docs/NLP_BACKENDS.md) for full documentation.

| Backend | PERSON Detection | Model Download | Default |
|---------|-----------------|----------------|---------|
| `regex` | ❌ No | Not required | ✅ Yes |
| `spacy` | ✅ Yes | `en_core_web_lg` | No |
| `transformers` | ✅ Yes | Auto-downloads | No |

**Default behavior:** Regex-only mode detects EMAIL, PHONE, SSN, CREDIT_CARD, IP_ADDRESS without any model downloads. Add spaCy later for PERSON/LOCATION detection.

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/scrubbing/__init__.py` | Package exports | ~10 |
| `rag/scrubbing/nlp_backend.py` | Pluggable NLP engine factory | ~50 |
| `rag/scrubbing/scrubber.py` | Presidio-based PHI scrubbing | ~40 |
| `rag/scrubbing/pseudonymizer.py` | Consistent fake data replacement | ~25 |

## Tasks

- [ ] [Task 1: NLP Backend](task1.md) - Pluggable analyzer factory
- [ ] [Task 2: Pseudonymizer](task2.md) - Consistent fake data
- [ ] [Task 3: Scrubber Core](task3.md) - Main scrubbing logic

## Verification Checklist

- [ ] Regex mode detects EMAIL, PHONE, SSN without model download
- [ ] Pseudonymization is deterministic (same input -> same output)
- [ ] Audit log captures what was replaced
- [ ] Code identifiers NOT scrubbed (function names, variable names)
- [ ] Tests with synthetic PII pass
- [ ] spaCy can be enabled via `backend="spacy"` parameter
- [ ] NLP_BACKENDS.md documents how to add spaCy later

## Quick Check (Regex Mode)

```bash
python -c "
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.core.types import RawChunk, ChunkID, CorpusType
scrubber = PresidioScrubber(Pseudonymizer())  # Uses regex backend by default
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
print('QUICK CHECK PASSED: PHI scrubbing works (regex mode)')
"
```

## Quick Check (spaCy Mode - Optional)

```bash
# Only run if spaCy is installed
python -c "
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.scrubbing.nlp_backend import create_analyzer
from rag.core.types import RawChunk, ChunkID, CorpusType

analyzer = create_analyzer(backend='spacy')
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
chunk = RawChunk(
    id=ChunkID.from_content('test', 0, 100),
    text='John Smith wrote this code',
    source_uri='test.py',
    corpus_type=CorpusType.CODE_LOGIC,
    byte_range=(0, 100),
    metadata={}
)
clean = scrubber.scrub(chunk)
assert 'John Smith' not in clean.text
print('QUICK CHECK PASSED: PHI scrubbing works (spaCy mode)')
"
```

## Prerequisites

- Phase 0 complete (types defined)
- Phase 1 complete (chunks available)
- Install: `pip install presidio-analyzer presidio-anonymizer faker`
- **Optional** (for PERSON detection): `pip install spacy && python -m spacy download en_core_web_lg`

## Next Phase

Upon completion, proceed to [Phase 3: LanceDB Store](../phase3/task.md)
