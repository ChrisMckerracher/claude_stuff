# NLP Backend Architecture

## Overview

The PHI scrubbing pipeline uses Microsoft Presidio for PII detection. Presidio supports multiple NLP backends for Named Entity Recognition (NER). This document describes our pluggable backend architecture that allows swapping NLP engines without changing application code.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PresidioScrubber                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              AnalyzerEngine                          │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │           NlpEngine (pluggable)               │  │   │
│  │  │                                               │  │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌──────────────┐  │  │   │
│  │  │  │ Regex   │  │ spaCy   │  │ Transformers │  │  │   │
│  │  │  │ Only    │  │ (NER)   │  │ (NER)        │  │  │   │
│  │  │  └─────────┘  └─────────┘  └──────────────┘  │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Available Backends

### 1. Regex-Only (Default)

**No external model downloads required.**

Uses Presidio's built-in pattern recognizers without any NLP model. This is the default backend when no NLP engine is configured.

**Detected entities:**
- `EMAIL_ADDRESS` - Email patterns
- `PHONE_NUMBER` - Phone number patterns
- `US_SSN` - Social Security Numbers
- `CREDIT_CARD` - Credit card numbers
- `IP_ADDRESS` - IPv4/IPv6 addresses
- `IBAN_CODE` - International Bank Account Numbers
- `US_BANK_NUMBER` - US bank account numbers
- `US_DRIVER_LICENSE` - Driver license patterns
- `US_PASSPORT` - Passport numbers
- `CRYPTO` - Cryptocurrency addresses

**Not detected (requires NER):**
- `PERSON` - Human names
- `LOCATION` - Geographic locations
- `DATE_TIME` - Dates and times (partial regex support)
- `NRP` - Nationalities, religious, political groups
- `ORGANIZATION` - Company/org names

**Usage:**
```python
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.scrubbing.nlp_backend import create_analyzer

# Default: regex-only, no model download needed
analyzer = create_analyzer(backend="regex")
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
```

### 2. spaCy Backend

**Requires model download:** `python -m spacy download en_core_web_lg`

Full NER support using spaCy's statistical models. Best accuracy for person names and locations.

**Additional entities detected:**
- `PERSON` - Human names (high accuracy)
- `LOCATION` - Geographic locations
- `DATE_TIME` - Dates and times
- `NRP` - Nationalities, religious, political groups

**Usage:**
```python
from rag.scrubbing.nlp_backend import create_analyzer

# Requires: pip install spacy && python -m spacy download en_core_web_lg
analyzer = create_analyzer(backend="spacy", model="en_core_web_lg")
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
```

**Installation:**
```bash
pip install spacy
python -m spacy download en_core_web_lg
```

### 3. Transformers Backend (Future)

**Requires model download:** Downloads from HuggingFace on first use.

Uses HuggingFace transformer models for NER. Good balance of accuracy and no separate model download step.

**Usage:**
```python
from rag.scrubbing.nlp_backend import create_analyzer

# Requires: pip install transformers torch
analyzer = create_analyzer(backend="transformers", model="dslim/bert-base-NER")
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
```

## Configuration

### Environment Variable

Set `RAG_NLP_BACKEND` to configure the default backend:

```bash
# Use regex-only (default, no downloads)
export RAG_NLP_BACKEND=regex

# Use spaCy (requires model download)
export RAG_NLP_BACKEND=spacy

# Use transformers (downloads on first use)
export RAG_NLP_BACKEND=transformers
```

### Programmatic Configuration

```python
from rag.scrubbing.nlp_backend import create_analyzer, NlpBackend

# Explicit backend selection
analyzer = create_analyzer(backend=NlpBackend.REGEX)
analyzer = create_analyzer(backend=NlpBackend.SPACY, model="en_core_web_lg")
analyzer = create_analyzer(backend=NlpBackend.TRANSFORMERS, model="dslim/bert-base-NER")

# Auto-detect best available backend
analyzer = create_analyzer(backend="auto")
```

### Auto-Detection Logic

When `backend="auto"`:

1. Check if spaCy and `en_core_web_lg` are available → use spaCy
2. Check if transformers is available → use transformers with default model
3. Fall back to regex-only

## Adding spaCy Support Later

When you're ready to enable spaCy NER:

### Step 1: Install Dependencies

```bash
# Add spaCy to your environment
pip install spacy

# Download the English model
python -m spacy download en_core_web_lg
```

### Step 2: Update Configuration

```python
# Option A: Environment variable
export RAG_NLP_BACKEND=spacy

# Option B: Programmatic
analyzer = create_analyzer(backend="spacy")
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)
```

### Step 3: Verify

```python
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.scrubbing.nlp_backend import create_analyzer

analyzer = create_analyzer(backend="spacy")
scrubber = PresidioScrubber(Pseudonymizer(), analyzer=analyzer)

# Test PERSON detection (only works with NER)
from rag.core.types import RawChunk, ChunkID, CorpusType
chunk = RawChunk(
    id=ChunkID.from_content("test", 0, 100),
    text="John Smith wrote this code",
    source_uri="test.py",
    corpus_type=CorpusType.CODE_LOGIC,
    byte_range=(0, 100),
    metadata={},
)
clean = scrubber.scrub(chunk)
assert "John Smith" not in clean.text, "spaCy NER working!"
print("spaCy backend verified!")
```

## Entity Coverage Matrix

| Entity Type | Regex | spaCy | Transformers |
|-------------|-------|-------|--------------|
| EMAIL_ADDRESS | ✅ | ✅ | ✅ |
| PHONE_NUMBER | ✅ | ✅ | ✅ |
| US_SSN | ✅ | ✅ | ✅ |
| CREDIT_CARD | ✅ | ✅ | ✅ |
| IP_ADDRESS | ✅ | ✅ | ✅ |
| IBAN_CODE | ✅ | ✅ | ✅ |
| US_DRIVER_LICENSE | ✅ | ✅ | ✅ |
| PERSON | ❌ | ✅ | ✅ |
| LOCATION | ❌ | ✅ | ✅ |
| DATE_TIME | ⚠️ partial | ✅ | ✅ |
| NRP | ❌ | ✅ | ⚠️ model-dependent |
| ORGANIZATION | ❌ | ✅ | ✅ |

## Performance Comparison

| Backend | Throughput (docs/min) | Memory | Model Size |
|---------|----------------------|--------|------------|
| Regex | ~10,000 | ~50MB | 0 (no model) |
| spaCy (en_core_web_lg) | ~500-2,000 | ~800MB | ~560MB |
| Transformers (bert-base-NER) | ~200-500 | ~1.5GB | ~440MB |

## Design Decisions

### D1: Regex as Default

**Decision:** Use regex-only as the default backend.

**Rationale:**
- No model downloads required for initial setup
- Covers the most critical technical PII (emails, SSNs, API keys)
- Code corpora have high false-positive rates for PERSON NER anyway
- Users can opt-in to NER when needed

### D2: Factory Function Pattern

**Decision:** Use `create_analyzer()` factory rather than subclasses.

**Rationale:**
- Presidio's `AnalyzerEngine` is the real abstraction
- We just need to configure it differently per backend
- Simpler API: one function, backend parameter
- Easy to add new backends without changing interface

### D3: Environment Variable Override

**Decision:** Support `RAG_NLP_BACKEND` environment variable.

**Rationale:**
- Easy to switch backends in different environments (dev vs prod)
- No code changes needed to enable spaCy in production
- Follows 12-factor app configuration principles
