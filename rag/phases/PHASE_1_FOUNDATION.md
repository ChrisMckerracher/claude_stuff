# Phase 1: Foundation — Types, Schema, and Project Scaffolding

**Depends on:** Nothing (this is the starting point)
**Unlocks:** All other phases

**Reference:** DESIGN.md Sections 3, 5.2, 11, 15.2–15.5

---

## 1. Scope

This phase builds the skeleton: project structure, all shared types, the
chunk schema, the source type registry, the sensitivity tier system, BM25
tokenizers, and the test infrastructure. No external models, no tree-sitter,
no Presidio. Just pure Python with zero heavyweight dependencies.

After this phase, every other phase imports from this foundation and writes
code that produces/consumes these types.

### In scope

- Python package scaffolding (`rag/` package, `__init__`, `__main__`)
- `pyproject.toml` / `requirements.txt` with pinned deps
- All core dataclasses: `RawChunk`, `CleanChunk`, `EmbeddedChunk`
- All enums: `SensitivityTier`, `SourceKind`, `CorpusType`
- `SourceTypeDef` and the `SOURCE_TYPES` registry
- Protocol definitions: `Crawler`, `Scrubber`, `Embedder`, `Indexer`
- `CrawlSource` input type
- `ScrubAuditEntry`, `ScrubGate` (the routing logic, not Presidio)
- BM25 tokenizers (code-aware + NLP)
- Chunk ID generation (deterministic SHA-256)
- `IngestManifest` and `SourceManifest` dataclasses
- Test fixtures directory and pytest configuration

### Out of scope

- Actual crawlers (Phases 2–3)
- Presidio / detect-secrets integration (Phase 4)
- CodeRankEmbed / LanceDB / bm25s (Phase 5)
- Query interface (Phase 6)
- CLI / Docker (Phase 7)

---

## 2. Files to Create

```
rag/
├── pyproject.toml
├── requirements.txt
├── requirements-dev.txt
├── rag/
│   ├── __init__.py
│   ├── __main__.py               # stub: prints "not yet implemented"
│   ├── config.py                 # constants, corpus types, language configs
│   ├── models/
│   │   ├── __init__.py
│   │   ├── types.py              # SensitivityTier, SourceKind, SourceTypeDef
│   │   ├── chunk.py              # RawChunk, CleanChunk, EmbeddedChunk
│   │   ├── manifest.py           # IngestManifest, SourceManifest
│   │   └── audit.py              # ScrubAuditEntry
│   ├── pipeline/
│   │   ├── __init__.py
│   │   ├── protocols.py          # Crawler, Scrubber, Embedder, Indexer protocols
│   │   └── scrub_gate.py         # ScrubGate (routing, not actual scrubbing)
│   └── indexing/
│       ├── __init__.py
│       └── tokenizer.py          # CODE_TOKENIZER, NLP_TOKENIZER, tokenize_code
├── tests/
│   ├── conftest.py               # shared fixtures
│   ├── test_types.py
│   ├── test_chunk.py
│   ├── test_tokenizer.py
│   ├── test_scrub_gate.py
│   └── fixtures/
│       └── .gitkeep
└── data/
    └── .gitkeep
```

---

## 3. Implementation Details

### 3.1 `rag/models/types.py`

```python
from dataclasses import dataclass
from enum import Enum


class SensitivityTier(Enum):
    CLEAN = "clean"
    SENSITIVE = "sensitive"
    MAYBE_SENSITIVE = "maybe_sensitive"


class SourceKind(Enum):
    REPO = "repo"
    SLACK_EXPORT = "slack_export"
    TRANSCRIPT_DIR = "transcript_dir"
    RUNBOOK_DIR = "runbook_dir"
    GOOGLE_DOCS_DIR = "gdocs_dir"


@dataclass(frozen=True)
class SourceTypeDef:
    corpus_type: str
    sensitivity: SensitivityTier
    description: str
    chunker_kind: str       # "ast", "yaml", "markdown", "thread", "sliding"
    bm25_tokenizer: str     # "code" or "nlp"


@dataclass
class CrawlSource:
    source_kind: SourceKind
    path: "Path"
    repo_name: str | None = None
```

### 3.2 `rag/config.py` — The Registry

```python
SOURCE_TYPES: dict[str, SourceTypeDef] = {
    "CODE_LOGIC":         SourceTypeDef("CODE_LOGIC",         SensitivityTier.CLEAN,           "Source code",               "ast",      "code"),
    "CODE_DEPLOY":        SourceTypeDef("CODE_DEPLOY",        SensitivityTier.CLEAN,           "K8s manifests",             "yaml",     "code"),
    "CODE_CONFIG":        SourceTypeDef("CODE_CONFIG",        SensitivityTier.CLEAN,           "Config files",              "yaml",     "code"),
    "DOC_README":         SourceTypeDef("DOC_README",         SensitivityTier.CLEAN,           "In-repo markdown",          "markdown", "nlp"),
    "DOC_RUNBOOK":        SourceTypeDef("DOC_RUNBOOK",        SensitivityTier.MAYBE_SENSITIVE, "Operational runbooks",      "markdown", "nlp"),
    "DOC_ADR":            SourceTypeDef("DOC_ADR",            SensitivityTier.MAYBE_SENSITIVE, "Architecture decisions",    "markdown", "nlp"),
    "DOC_GOOGLE":         SourceTypeDef("DOC_GOOGLE",         SensitivityTier.SENSITIVE,       "Google Docs exports",       "markdown", "nlp"),
    "CONVO_SLACK":        SourceTypeDef("CONVO_SLACK",        SensitivityTier.MAYBE_SENSITIVE, "Slack threads",             "thread",   "nlp"),
    "CONVO_TRANSCRIPT":   SourceTypeDef("CONVO_TRANSCRIPT",   SensitivityTier.SENSITIVE,       "Meeting transcripts",       "thread",   "nlp"),
    "CONVO_OTHER":        SourceTypeDef("CONVO_OTHER",        SensitivityTier.MAYBE_SENSITIVE, "Other conversations",       "sliding",  "nlp"),
}
```

### 3.3 `rag/models/chunk.py` — Chunk ID Generation

Chunk IDs are deterministic: `sha256(source_uri + ":" + str(byte_start) + ":" + str(byte_end))`. This means re-crawling the same unchanged file produces the same chunk IDs, which is critical for incremental diffing.

```python
import hashlib

def make_chunk_id(source_uri: str, byte_start: int, byte_end: int) -> str:
    key = f"{source_uri}:{byte_start}:{byte_end}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]
```

### 3.4 `rag/pipeline/scrub_gate.py`

The ScrubGate routes based on sensitivity. At this phase, it uses a **stub
scrubber** that raises `NotImplementedError` — the real scrubber comes in
Phase 4. But the routing logic is tested here.

```python
class ScrubGate:
    def __init__(self, scrubber: Scrubber):
        self._scrubber = scrubber

    def process(self, chunk: RawChunk) -> CleanChunk:
        tier = chunk.source_type.sensitivity
        if tier == SensitivityTier.CLEAN:
            return self._promote_clean(chunk)
        return self._scrubber.scrub(chunk)
```

For testing, provide a `PassthroughScrubber` that converts without
modification, and a `MockScrubber` that replaces known patterns.

### 3.5 `rag/indexing/tokenizer.py`

The BM25 tokenizers are pure functions with no external dependencies.
Implement both `CODE_TOKENIZER` and `NLP_TOKENIZER` configs, and the
`tokenize_code()` function. See DESIGN.md Section 5.2 for the full
implementation.

---

## 4. Testing Strategy

### 4.1 Unit Tests: `tests/test_types.py`

| Test | What it verifies |
|------|-----------------|
| `test_sensitivity_tier_values` | All three enum values exist and are distinct |
| `test_source_kind_values` | All five enum values exist |
| `test_source_type_def_frozen` | `SourceTypeDef` is immutable (attempt assignment → TypeError) |
| `test_source_types_registry_complete` | All 10 corpus types are registered |
| `test_source_types_sensitivity_mapping` | CODE_* → CLEAN, DOC_GOOGLE → SENSITIVE, CONVO_SLACK → MAYBE |
| `test_source_types_tokenizer_mapping` | CODE_* → "code", DOC_*/CONVO_* → "nlp" |
| `test_crawl_source_defaults` | `repo_name` defaults to None |

### 4.2 Unit Tests: `tests/test_chunk.py`

| Test | What it verifies |
|------|-----------------|
| `test_make_chunk_id_deterministic` | Same inputs → same ID, always |
| `test_make_chunk_id_different_inputs` | Different inputs → different IDs |
| `test_raw_chunk_construction` | All fields populated, source_type carries sensitivity |
| `test_clean_chunk_construction` | audit field is None for CLEAN, populated for scrubbed |
| `test_embedded_chunk_wraps_clean` | EmbeddedChunk.chunk is a CleanChunk, not RawChunk |
| `test_chunk_id_length` | IDs are 16 hex chars |

### 4.3 Unit Tests: `tests/test_tokenizer.py`

| Test | What it verifies |
|------|-----------------|
| `test_code_tokenizer_camel_case` | `"getUserProfile"` → `["get", "user", "profile"]` |
| `test_code_tokenizer_snake_case` | `"get_user_profile"` → `["get", "user", "profile"]` |
| `test_code_tokenizer_mixed` | `"getUser_profileData"` → `["get", "user", "profile", "data"]` |
| `test_code_tokenizer_stop_words` | `"func getUserProfile return string"` → `["get", "user", "profile"]` (func, return, string removed) |
| `test_code_tokenizer_punctuation` | `"http.Get(url)"` → `["http", "get", "url"]` |
| `test_code_tokenizer_all_caps` | `"HTTPClient"` → `["h", "t", "t", "p", "client"]` or `["http", "client"]` (decide and document behavior) |
| `test_nlp_tokenizer_no_split` | `"getUserProfile"` stays as one token (no identifier splitting) |
| `test_nlp_tokenizer_lowercase` | `"The Quick Fox"` → `["the", "quick", "fox"]` |
| `test_get_tokenizer_routing` | `CODE_LOGIC` → code tokenizer, `CONVO_SLACK` → NLP tokenizer |

### 4.4 Unit Tests: `tests/test_scrub_gate.py`

Use a mock scrubber for these tests. The real scrubber doesn't exist yet.

| Test | What it verifies |
|------|-----------------|
| `test_clean_passthrough` | `CODE_LOGIC` chunk → CleanChunk with unchanged text, audit=None |
| `test_sensitive_scrubs` | `DOC_GOOGLE` chunk → scrubber.scrub() called, CleanChunk has audit |
| `test_maybe_sensitive_scrubs` | `CONVO_SLACK` chunk → scrubber.scrub() called |
| `test_clean_does_not_call_scrubber` | `CODE_DEPLOY` chunk → scrubber.scrub() never called |
| `test_all_metadata_preserved` | All fields from RawChunk appear in CleanChunk |

### 4.5 Type-checking

```bash
# Run mypy in strict mode on the package
mypy rag/ --strict --ignore-missing-imports

# Verify the type invariant: Embedder cannot accept RawChunk
# This should be a mypy error in a deliberately-broken test file
```

Create a `tests/test_type_safety.py` that is NOT run by pytest but IS
checked by mypy:

```python
# tests/type_checks/check_embed_invariant.py
# This file should FAIL mypy, proving the type system works.
from rag.models.chunk import RawChunk, EmbeddedChunk
from rag.pipeline.protocols import Embedder

def bad_embed(embedder: Embedder, raw: RawChunk) -> None:
    embedder.embed_batch([raw])  # mypy error: RawChunk is not CleanChunk
```

---

## 5. Acceptance Criteria

- [ ] `pip install -e .` succeeds from the `rag/` root
- [ ] `python -m rag` runs without error (prints stub message)
- [ ] All 25+ unit tests pass: `pytest tests/ -v`
- [ ] `mypy rag/ --strict` passes with zero errors
- [ ] Type invariant test confirms mypy rejects `Embedder.embed_batch([RawChunk(...)])`
- [ ] `SOURCE_TYPES` registry has all 10 entries with correct sensitivities
- [ ] Tokenizer produces expected output for all test cases
- [ ] ScrubGate routes CLEAN/SENSITIVE/MAYBE correctly with mock scrubber
- [ ] No external service dependencies (no model downloads, no Docker)

---

## 6. Dependencies (pip)

**Runtime (this phase only):**

None beyond stdlib. All types are pure dataclasses/enums.

**Dev:**

```
pytest>=8.0
mypy>=1.8
```

Later phases add `sentence-transformers`, `lancedb`, `tree-sitter`, etc.
This phase is deliberately dependency-free for fast iteration.
