# Phase 4: PHI Scrubbing — Presidio, Secrets Detection, ScrubGate

**Depends on:** Phase 1 (Foundation), Phase 2 or 3 (need RawChunks to test against)
**Unlocks:** Phase 5 (Embedding & Storage — can't index without CleanChunks)

**Reference:** DESIGN.md Section 15.6, PHI_SCRUBBING.md (full design)

---

## 1. Scope

Build the `Scrubber` implementation that detects and replaces PHI/PII in
chunk text. Wire it into the `ScrubGate` (routing logic built in Phase 1).
After this phase, the full path from `RawChunk` to `CleanChunk` works end
to end.

### In scope

- `PresidioScrubber` class satisfying the `Scrubber` protocol
- Microsoft Presidio analyzer + anonymizer integration
- Custom Presidio recognizers for domain-specific patterns
- `detect-secrets` integration for API keys, tokens, connection strings
- Allowlist for false positive suppression in code contexts
- Consistent pseudonymization (same input → same fake output via seeded Faker)
- Audit trail (`ScrubAuditEntry`) for every scrubbed chunk
- AST-aware code comment scrubbing (use tree-sitter to isolate comments
  from code before running NER — only for MAYBE_SENSITIVE code-adjacent docs)
- Integration with `ScrubGate`: CLEAN → passthrough, SENSITIVE/MAYBE → scrub

### Out of scope

- Tree-sitter parsing itself (Phase 2 — we import the parser)
- Scrubbing performance optimization (profile after Phase 7)
- Training custom NER models (use spaCy's off-the-shelf `en_core_web_sm`)

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── scrubbing/
│   │   ├── __init__.py
│   │   ├── scrubber.py           # PresidioScrubber (main implementation)
│   │   ├── recognizers.py        # Custom Presidio recognizers
│   │   ├── pseudonymizer.py      # Consistent fake-name generation
│   │   ├── allowlist.py          # False positive suppression
│   │   └── secrets.py            # detect-secrets wrapper
├── tests/
│   ├── test_scrubber.py          # PresidioScrubber unit tests
│   ├── test_pseudonymizer.py
│   ├── test_allowlist.py
│   ├── test_secrets_detection.py
│   ├── test_scrub_gate_e2e.py    # Full ScrubGate with real scrubber
│   └── fixtures/
│       ├── phi/
│       │   ├── slack_with_phi.json     # Slack messages containing names, emails
│       │   ├── transcript_with_phi.txt # Transcript with real-looking names
│       │   ├── clean_code.go           # Code that should NOT trigger scrubbing
│       │   ├── code_with_comments.py   # PHI in comments, not in code
│       │   └── gdoc_with_phi.md        # Google Doc with names, phone numbers
```

---

## 3. Implementation Details

### 3.1 `PresidioScrubber` — Core Implementation

```python
from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

class PresidioScrubber:
    """Satisfies the Scrubber protocol.

    Detects PHI/PII entities using Presidio NER + custom recognizers,
    then replaces them with consistent pseudonyms.
    """

    def __init__(
        self,
        seed: int = 42,
        score_threshold: float = 0.35,
        allowlist: Allowlist | None = None,
    ):
        self._registry = RecognizerRegistry()
        self._registry.load_predefined_recognizers()
        # Add custom recognizers
        self._registry.add_recognizer(SlackMentionRecognizer())
        self._registry.add_recognizer(InternalEmailRecognizer())

        self._analyzer = AnalyzerEngine(registry=self._registry)
        self._anonymizer = AnonymizerEngine()
        self._pseudonymizer = ConsistentPseudonymizer(seed=seed)
        self._allowlist = allowlist or Allowlist()
        self._threshold = score_threshold

    def scrub(self, chunk: RawChunk) -> CleanChunk:
        # 1. Detect entities
        results = self._analyzer.analyze(
            text=chunk.text,
            language="en",
            score_threshold=self._threshold,
            entities=[
                "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER",
                "US_SSN", "CREDIT_CARD", "IP_ADDRESS",
                "MEDICAL_LICENSE", "US_DRIVER_LICENSE",
            ],
        )

        # 2. Filter allowlist (suppress false positives)
        results = self._allowlist.filter(results, chunk.text)

        # 3. Detect secrets
        secret_findings = detect_secrets_in_text(chunk.text)

        # 4. Anonymize with consistent pseudonyms
        if results or secret_findings:
            scrubbed_text = self._apply_replacements(
                chunk.text, results, secret_findings
            )
        else:
            scrubbed_text = chunk.text

        # 5. Build audit entry
        audit = ScrubAuditEntry(
            chunk_id=chunk.id,
            tier=chunk.source_type.sensitivity,
            entities_found=len(results),
            entity_types=list({r.entity_type for r in results}),
            secrets_found=len(secret_findings),
            scrubbed=bool(results or secret_findings),
        )

        # 6. Return CleanChunk
        return CleanChunk(
            id=chunk.id,
            source_uri=chunk.source_uri,
            byte_range=chunk.byte_range,
            source_type=chunk.source_type,
            text=scrubbed_text,
            context_prefix=chunk.context_prefix,
            repo_name=chunk.repo_name,
            audit=audit,
            # ... carry forward all metadata
        )
```

### 3.2 Consistent Pseudonymization

```python
from faker import Faker

class ConsistentPseudonymizer:
    """Same real name → same fake name across all chunks.

    Uses a salted hash to deterministically map real → fake.
    Thread-safe (no shared mutable state after init).
    """

    def __init__(self, seed: int = 42):
        self._faker = Faker()
        self._faker.seed_instance(seed)
        self._cache: dict[str, str] = {}

    def pseudonymize(self, entity_text: str, entity_type: str) -> str:
        key = f"{entity_type}:{entity_text.lower().strip()}"
        if key not in self._cache:
            if entity_type == "PERSON":
                self._cache[key] = self._faker.name()
            elif entity_type == "EMAIL_ADDRESS":
                self._cache[key] = self._faker.email()
            elif entity_type == "PHONE_NUMBER":
                self._cache[key] = self._faker.phone_number()
            else:
                self._cache[key] = f"[REDACTED_{entity_type}]"
        return self._cache[key]
```

### 3.3 Allowlist — False Positive Suppression

Code and technical text trigger false positives. `nil` flagged as a name,
`func` flagged as a word, Go package paths flagged as addresses.

```python
class Allowlist:
    """Suppress known false positives from Presidio."""

    DEFAULT_TERMS: set[str] = {
        # Go/Python/TS keywords that trigger NER
        "nil", "null", "none", "true", "false",
        # Common code identifiers
        "admin", "root", "localhost", "master", "main",
        # Technical terms that look like names
        "spring", "docker", "redis", "kafka", "nginx",
    }

    def __init__(self, extra_terms: set[str] | None = None):
        self._terms = self.DEFAULT_TERMS | (extra_terms or set())

    def filter(self, results: list, text: str) -> list:
        """Remove results whose matched text is in the allowlist."""
        return [
            r for r in results
            if text[r.start:r.end].lower().strip() not in self._terms
        ]
```

### 3.4 Secrets Detection

```python
from detect_secrets import SecretsCollection
from detect_secrets.settings import default_settings

def detect_secrets_in_text(text: str) -> list[SecretFinding]:
    """Detect API keys, tokens, connection strings using detect-secrets."""
    secrets = SecretsCollection()
    with default_settings():
        secrets.scan_string(text)
    return [
        SecretFinding(
            secret_type=secret.type,
            line_number=secret.line_number,
        )
        for secret in secrets
    ]
```

### 3.5 AST-Aware Code Comment Scrubbing

For chunks from code-adjacent docs (DOC_RUNBOOK that contains code blocks),
or for future expansion where MAYBE_SENSITIVE code might exist:

1. Use tree-sitter to parse the chunk and identify comment nodes
2. Run Presidio NER only on comment text (not on code)
3. Replace PHI in comments, leave code untouched

This prevents false positives from code identifiers while catching
real PHI in comments like `// TODO: Ask Dr. Smith about this`.

---

## 4. Testing Strategy

### 4.1 PHI Detection Accuracy Tests

These tests use fixtures with **known, labeled PHI** to measure detection
recall and precision.

**`tests/fixtures/phi/slack_with_phi.json`:**

```json
[
  {
    "text": "Hey @john.doe, the patient record for Jane Smith (SSN 123-45-6789) was sent to dr.wilson@hospital.com",
    "expected_entities": [
      {"type": "PERSON", "text": "john.doe"},
      {"type": "PERSON", "text": "Jane Smith"},
      {"type": "US_SSN", "text": "123-45-6789"},
      {"type": "EMAIL_ADDRESS", "text": "dr.wilson@hospital.com"}
    ]
  }
]
```

### 4.2 Unit Tests: `tests/test_scrubber.py`

| Test | What it verifies |
|------|-----------------|
| `test_detect_person_name` | "Jane Smith" → PERSON entity detected |
| `test_detect_email` | "user@example.com" → EMAIL detected |
| `test_detect_phone` | "(555) 123-4567" → PHONE detected |
| `test_detect_ssn` | "123-45-6789" → US_SSN detected |
| `test_scrub_replaces_text` | Original name replaced with pseudonym |
| `test_scrub_preserves_structure` | Non-PHI text unchanged after scrub |
| `test_clean_code_no_detections` | Go source code → zero entities (no false positives) |
| `test_multiple_entities` | Text with 3 different entity types → all detected |
| `test_scrubber_returns_clean_chunk` | Output type is CleanChunk with audit populated |
| `test_scrubber_audit_counts` | Audit entry counts match actual detections |

### 4.3 Unit Tests: `tests/test_pseudonymizer.py`

| Test | What it verifies |
|------|-----------------|
| `test_consistent_same_input` | "Jane Smith" → same fake name every time |
| `test_different_inputs_different_outputs` | "Jane Smith" ≠ "Bob Jones" |
| `test_case_insensitive` | "jane smith" and "Jane Smith" → same output |
| `test_type_specific` | PERSON → fake name, EMAIL → fake email, PHONE → fake phone |
| `test_deterministic_with_seed` | Same seed → same output across runs |
| `test_different_seeds` | Different seed → different outputs |

### 4.4 Unit Tests: `tests/test_allowlist.py`

| Test | What it verifies |
|------|-----------------|
| `test_filter_known_keywords` | "nil" flagged as PERSON → filtered out |
| `test_filter_tech_terms` | "Redis" flagged as PERSON → filtered out |
| `test_real_name_not_filtered` | "Jane Smith" → NOT filtered (not in allowlist) |
| `test_custom_extra_terms` | Extra allowlist terms respected |
| `test_case_insensitive` | "NIL" and "nil" both filtered |

### 4.5 Unit Tests: `tests/test_secrets_detection.py`

| Test | What it verifies |
|------|-----------------|
| `test_detect_aws_key` | `AKIAIOSFODNN7EXAMPLE` detected |
| `test_detect_generic_api_key` | `api_key = "sk-..."` detected |
| `test_detect_connection_string` | `postgresql://user:pass@host/db` detected |
| `test_no_false_positive_on_code` | Normal code strings not flagged |

### 4.6 Integration Tests: `tests/test_scrub_gate_e2e.py`

| Test | What it verifies |
|------|-----------------|
| `test_clean_code_chunk_passthrough` | CODE_LOGIC chunk → CleanChunk, text unchanged, audit=None |
| `test_sensitive_gdoc_scrubbed` | DOC_GOOGLE chunk with name → text scrubbed, audit populated |
| `test_maybe_sensitive_slack_scrubbed` | CONVO_SLACK with name → text scrubbed |
| `test_clean_yaml_passthrough` | CODE_DEPLOY chunk → text unchanged |
| `test_scrubbed_text_no_phi` | Re-run analyzer on scrubbed text → zero entities |
| `test_all_metadata_preserved` | file_path, language, etc. survive scrub |
| `test_chunk_id_unchanged` | CleanChunk.id == original RawChunk.id |

### 4.7 Recall Benchmark

Create a labeled test set of 50+ text snippets with known PHI entities.
Run the scrubber and measure:

```python
def test_scrubber_recall_benchmark():
    """Scrubber must detect ≥95% of known PHI entities in test set."""
    labeled = load_phi_test_set("fixtures/phi/labeled_set.json")
    tp, fn = 0, 0
    for item in labeled:
        results = scrubber.analyze(item["text"])
        detected_spans = {(r.start, r.end) for r in results}
        for expected in item["expected_entities"]:
            if any(overlaps(detected, expected) for detected in detected_spans):
                tp += 1
            else:
                fn += 1
    recall = tp / (tp + fn)
    assert recall >= 0.95, f"Recall {recall:.2%} below 95% threshold"
```

Target: ≥95% recall on the labeled set. Track precision separately but
don't gate on it (allowlist handles false positives).

---

## 5. Acceptance Criteria

- [ ] `PresidioScrubber` satisfies the `Scrubber` protocol
- [ ] Detects PERSON, EMAIL, PHONE, SSN at ≥95% recall on labeled test set
- [ ] No false positives on clean Go/C#/Python/TypeScript source code
- [ ] Consistent pseudonymization: same input → same output
- [ ] detect-secrets catches API keys and connection strings
- [ ] Allowlist suppresses known false positives
- [ ] `ScrubGate` routes CLEAN → passthrough, SENSITIVE/MAYBE → scrub
- [ ] Audit trail populated for every scrubbed chunk
- [ ] Re-analyzing scrubbed text produces zero new detections
- [ ] All 35+ tests pass
- [ ] `mypy rag/scrubbing/ --strict` passes

---

## 6. Dependencies (pip, this phase)

```
presidio-analyzer>=2.2
presidio-anonymizer>=2.2
spacy>=3.7
detect-secrets>=1.4
faker>=22.0
```

Plus the spaCy English model:

```bash
python -m spacy download en_core_web_sm
```
