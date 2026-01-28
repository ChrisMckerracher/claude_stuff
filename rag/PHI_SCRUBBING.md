# PHI Scrubbing — Design Document

## 1. Problem Statement

Before content enters the RAG index (see `DESIGN.md`), it must be scrubbed of Protected Health Information (PHI), Personally Identifiable Information (PII), and secrets. The system ingests:

- **Source code** — may contain hardcoded credentials, connection strings, internal hostnames, author names in comments
- **Deploy YAMLs** — may contain internal IPs, service account names, secrets referenced by name
- **Markdown docs / runbooks** — may reference people, patients, customers by name
- **Slack conversations** — contain usernames, @mentions, potentially sensitive discussions
- **Meeting transcripts** — contain speaker names, potentially sensitive content

The scrubbing pipeline must run **before embedding** — once data is in the vector store, redaction is too late. The pipeline must be high-recall (missing PHI is a privacy violation) while minimizing over-redaction that would degrade retrieval quality.

---

## 2. What Gets Scrubbed

### 2.1 HIPAA Safe Harbor — 18 Identifiers

The Safe Harbor method is our baseline. All 18 identifier categories must be detected and handled:

| # | Identifier | Detection Method | Scrub Strategy |
|---|-----------|-----------------|----------------|
| 1 | Names | NER (PERSON) | Pseudonymize |
| 2 | Geographic data < state | NER (GPE/LOC) + regex | Generalize to state |
| 3 | Dates (except year) | Regex + NER (DATE) | Generalize to year |
| 4 | Phone numbers | Regex | Redact |
| 5 | Fax numbers | Regex | Redact |
| 6 | Email addresses | Regex | Redact |
| 7 | SSN | Regex | Redact |
| 8 | Medical record numbers | Regex (custom) | Redact |
| 9 | Health plan beneficiary numbers | Regex (custom) | Redact |
| 10 | Account numbers | Regex | Redact |
| 11 | Certificate/license numbers | Regex (custom) | Redact |
| 12 | Vehicle identifiers | Regex | Redact |
| 13 | Device identifiers | Regex (custom) | Redact |
| 14 | URLs | Regex | Redact (personal only) |
| 15 | IP addresses | Regex | Redact |
| 16 | Biometric identifiers | N/A (text pipeline) | N/A |
| 17 | Full-face photographs | N/A (text pipeline) | N/A |
| 18 | Other unique identifiers | Custom recognizers | Redact |

### 2.2 Technical Secrets (Non-PHI, Still Sensitive)

| Type | Examples | Detection |
|------|----------|-----------|
| API keys | `AKIAIOSFODNN7...`, `sk-...`, `ghp_...` | Regex (known prefixes) |
| Connection strings | `postgresql://user:pass@host/db` | Regex |
| Private keys | `-----BEGIN RSA PRIVATE KEY-----` | Regex |
| JWT / Bearer tokens | `eyJhbG...`, `Bearer ...` | Regex |
| Internal hostnames | `*.internal.company.com` | Configurable deny-list |
| Private IPs | RFC 1918 ranges | Regex |
| Cloud resource ARNs | `arn:aws:...` | Regex |

### 2.3 Conversational PII

| Type | Examples | Detection |
|------|----------|-----------|
| Slack usernames | `@john.smith` | Regex + user directory lookup |
| Display names | Author fields in exports | Mapping table |
| Mentioned people | "talked to Sarah about the deploy" | NER (PERSON) |
| Customer names | "Acme Health reported an issue" | NER (ORG) + custom deny-list |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Scrubbing Pipeline                        │
│                                                           │
│  Input (raw text + corpus_type + metadata)                │
│         │                                                 │
│         ▼                                                 │
│  ┌─────────────────┐                                      │
│  │ 1. Secret Scanner│  detect-secrets (API keys, tokens)  │
│  └────────┬────────┘                                      │
│           ▼                                               │
│  ┌─────────────────┐                                      │
│  │ 2. Presidio     │  Regex recognizers (SSN, phone,      │
│  │    Analyzer     │  email, dates, IPs, MRN, etc.)       │
│  │                 │  + spaCy NER (PERSON, ORG, GPE, DATE)│
│  │                 │  + Custom recognizers                 │
│  └────────┬────────┘                                      │
│           ▼                                               │
│  ┌─────────────────┐                                      │
│  │ 3. Allowlist    │  Skip known-safe terms:              │
│  │    Filter       │  variable names, code keywords,      │
│  │                 │  service names, file paths            │
│  └────────┬────────┘                                      │
│           ▼                                               │
│  ┌─────────────────┐                                      │
│  │ 4. Presidio     │  Per-entity-type strategy:           │
│  │    Anonymizer   │  redact / pseudonymize / generalize  │
│  └────────┬────────┘                                      │
│           ▼                                               │
│  Scrubbed text → Chunker → Embedder → LanceDB            │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Why This Order

1. **Secrets first:** Secret patterns are exact and high-confidence. Running them first prevents the NER model from wasting cycles on API keys that look like random strings.
2. **Presidio hybrid (regex + NER) second:** Catches both structured identifiers (SSN, phone) and unstructured ones (names, locations).
3. **Allowlist filter third:** Removes false positives — code variables named `patient_name`, service names like `smith-api`, file paths that contain name-like segments. This must run after detection but before anonymization.
4. **Anonymizer last:** Applies the appropriate strategy per entity type.

---

## 4. Implementation

### 4.1 Secret Scanner

**Tool:** `detect-secrets` (Yelp) — Python-native, plugin-based architecture.

```python
from detect_secrets import SecretsCollection
from detect_secrets.settings import default_settings

def scan_secrets(text: str) -> list[dict]:
    """Detect secrets in text. Returns list of {type, start, end}."""
    # detect-secrets works on files, so we write to a temp file
    # or use the lower-level API
    from detect_secrets.core.scan import scan_line
    results = []
    for i, line in enumerate(text.splitlines()):
        with default_settings():
            for plugin_result in scan_line(line):
                results.append({
                    "type": "SECRET",
                    "subtype": plugin_result.type,
                    "line": i,
                    "value": line.strip(),
                })
    return results
```

**Supplementary regex for patterns `detect-secrets` may miss:**

```python
SECRET_PATTERNS = {
    "aws_key": r"AKIA[0-9A-Z]{16}",
    "openai_key": r"sk-[a-zA-Z0-9]{20,}",
    "github_pat": r"ghp_[a-zA-Z0-9]{36}",
    "github_token": r"gho_[a-zA-Z0-9]{36}",
    "connection_string": r"(postgresql|mysql|mongodb|redis)://\S+",
    "private_key": r"-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----",
    "bearer_token": r"Bearer\s+[a-zA-Z0-9\-._~+/]+=*",
    "jwt": r"eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+",
    "private_ip": r"\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b",
}
```

### 4.2 Presidio Analyzer — Core Detection Engine

```python
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_analyzer.nlp_engine import NlpEngineProvider

# Configure spaCy NER backend
provider = NlpEngineProvider(nlp_configuration={
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
})
nlp_engine = provider.create_engine()

analyzer = AnalyzerEngine(nlp_engine=nlp_engine)

# Register custom recognizers
CUSTOM_RECOGNIZERS = [
    PatternRecognizer(
        supported_entity="MEDICAL_RECORD_NUMBER",
        patterns=[Pattern("mrn", r"\bMRN[-:]?\s?\d{6,10}\b", 0.7)],
        context=["medical", "record", "patient", "chart", "MRN"],
    ),
    PatternRecognizer(
        supported_entity="HEALTH_PLAN_ID",
        patterns=[Pattern("hpid", r"\b[A-Z]{3}\d{9,12}\b", 0.3)],
        context=["insurance", "plan", "beneficiary", "member", "policy"],
    ),
    PatternRecognizer(
        supported_entity="INTERNAL_HOSTNAME",
        patterns=[
            Pattern("internal_dns", r"\b[\w-]+\.internal\.[\w.-]+\b", 0.8),
            Pattern("corp_dns", r"\b[\w-]+\.corp\.[\w.-]+\b", 0.8),
        ],
    ),
]

for recognizer in CUSTOM_RECOGNIZERS:
    analyzer.registry.add_recognizer(recognizer)
```

**Analyzing text:**

```python
def analyze_text(text: str, corpus_type: str) -> list:
    """Run Presidio analysis with corpus-type-aware thresholds."""
    # Lower threshold for conversations (more likely to contain names)
    threshold = 0.3 if corpus_type.startswith("CONVO_") else 0.5

    results = analyzer.analyze(
        text=text,
        language="en",
        score_threshold=threshold,
        entities=[
            "PERSON", "PHONE_NUMBER", "EMAIL_ADDRESS", "US_SSN",
            "CREDIT_CARD", "IP_ADDRESS", "DATE_TIME", "LOCATION",
            "MEDICAL_RECORD_NUMBER", "HEALTH_PLAN_ID",
            "INTERNAL_HOSTNAME", "US_DRIVER_LICENSE",
        ],
    )
    return results
```

### 4.3 Allowlist Filter — Reducing False Positives

Code and technical content produces false positives that natural language doesn't. The allowlist suppresses detections that match known-safe patterns.

```python
@dataclass
class AllowlistConfig:
    # Known service names (from deploy YAML crawl) that look like person names
    service_names: set[str]       # e.g. {"smith-api", "jackson-worker"}

    # Code identifiers that trigger NER
    code_keywords: set[str]       # e.g. {"patient_name", "user_email", "john_doe_test"}

    # File paths and technical patterns
    path_patterns: list[str]      # e.g. [r"\.go$", r"\.cs$", r"/vendor/"]

    # Domain-specific terms that aren't PII
    domain_allowlist: set[str]    # e.g. {"Smith chart", "Johnson noise"}


def filter_false_positives(
    detections: list,
    text: str,
    allowlist: AllowlistConfig,
    corpus_type: str,
) -> list:
    """Remove detections that match allowlisted patterns."""
    filtered = []
    for det in detections:
        detected_text = text[det.start:det.end]

        # Skip known service names
        if detected_text.lower() in {s.lower() for s in allowlist.service_names}:
            continue

        # Skip code identifiers (snake_case/camelCase patterns)
        if re.match(r'^[a-z_][a-zA-Z0-9_]*$', detected_text):
            if detected_text in allowlist.code_keywords:
                continue

        # Skip domain allowlist
        if detected_text in allowlist.domain_allowlist:
            continue

        # For code corpus, skip PERSON detections inside string literals
        # and comments only (not in variable assignments or imports)
        if corpus_type == "CODE_LOGIC" and det.entity_type == "PERSON":
            # Require higher confidence for code
            if det.score < 0.7:
                continue

        filtered.append(det)
    return filtered
```

### 4.4 Presidio Anonymizer — Per-Entity Strategies

```python
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

anonymizer = AnonymizerEngine()

# Per-entity-type anonymization strategies
OPERATORS = {
    # Full redaction — no analytical value, high risk
    "US_SSN": OperatorConfig("replace", {"new_value": "[SSN]"}),
    "CREDIT_CARD": OperatorConfig("replace", {"new_value": "[CREDIT_CARD]"}),
    "PHONE_NUMBER": OperatorConfig("replace", {"new_value": "[PHONE]"}),
    "EMAIL_ADDRESS": OperatorConfig("replace", {"new_value": "[EMAIL]"}),
    "MEDICAL_RECORD_NUMBER": OperatorConfig("replace", {"new_value": "[MRN]"}),
    "HEALTH_PLAN_ID": OperatorConfig("replace", {"new_value": "[HEALTH_PLAN_ID]"}),
    "IP_ADDRESS": OperatorConfig("replace", {"new_value": "[IP]"}),
    "INTERNAL_HOSTNAME": OperatorConfig("replace", {"new_value": "[INTERNAL_HOST]"}),
    "US_DRIVER_LICENSE": OperatorConfig("replace", {"new_value": "[LICENSE]"}),
    "SECRET": OperatorConfig("replace", {"new_value": "[SECRET]"}),

    # Pseudonymize — preserves document coherence for retrieval
    "PERSON": OperatorConfig("replace", {"new_value": "[PERSON]"}),
    # Note: true pseudonymization (consistent fake names) requires the
    # custom pseudonymizer below, not Presidio's built-in replace

    # Generalize — retains partial analytical value
    "DATE_TIME": OperatorConfig("replace", {"new_value": "[DATE]"}),
    "LOCATION": OperatorConfig("replace", {"new_value": "[LOCATION]"}),

    # Default for anything else
    "DEFAULT": OperatorConfig("replace", {"new_value": "[REDACTED]"}),
}

def anonymize(text: str, detections: list) -> str:
    """Apply anonymization operators to detected entities."""
    result = anonymizer.anonymize(
        text=text,
        analyzer_results=detections,
        operators=OPERATORS,
    )
    return result.text
```

### 4.5 Consistent Pseudonymization

For names that appear across multiple chunks (e.g., the same person mentioned in code comments, Slack threads, and runbooks), we need **consistent** fake replacements so retrieval still works across documents.

```python
import hashlib
from faker import Faker

class Pseudonymizer:
    """Deterministic name pseudonymization.

    The same real name always maps to the same fake name within a crawl run.
    The mapping is keyed by a salt that changes per crawl, so different
    crawl runs produce different pseudonyms (preventing rainbow-table attacks).
    """

    def __init__(self, salt: str):
        self.salt = salt
        self._cache: dict[str, str] = {}

    def pseudonymize(self, real_name: str) -> str:
        normalized = real_name.strip().lower()
        if normalized not in self._cache:
            seed = int(hashlib.sha256(
                (self.salt + normalized).encode()
            ).hexdigest(), 16) % (2**32)
            fake = Faker()
            Faker.seed(seed)
            self._cache[normalized] = fake.name()
        return self._cache[normalized]

    def get_mapping(self) -> dict[str, str]:
        """Return the full mapping (for audit/debug only — store securely)."""
        return dict(self._cache)
```

**Important:** The pseudonym mapping must be stored securely or discarded after the crawl. If retained, it is itself sensitive data (it maps real names to fake names). For HIPAA compliance, it should be treated as a re-identification key.

---

## 5. Corpus-Type-Specific Handling

Different content types produce different scrubbing challenges. The pipeline adapts its behavior based on `corpus_type`.

### 5.1 Code Logic (`CODE_LOGIC`)

**Challenges:**
- Variable names like `patient_name`, `john_doe_test` trigger PERSON NER
- Class/method names may coincidentally match person names (`Smith`, `Johnson`)
- Comments contain author names, TODOs with real people referenced
- String literals may contain test data with real-looking names

**Strategy:**
1. Use tree-sitter to separate **comments** from **code tokens**
2. Run full NER pipeline on comments only
3. Run regex-only (secrets, SSN, email, phone) on code tokens
4. Higher confidence threshold (0.7) for PERSON detections in code
5. Allowlist known code identifiers

```python
def scrub_code(text: str, language: str) -> str:
    """Scrub code with AST-aware comment extraction."""
    comments, code_spans = extract_comments_via_treesitter(text, language)

    # Full pipeline on comments
    comment_detections = analyze_text(
        "\n".join(c.text for c in comments),
        corpus_type="CODE_LOGIC"
    )

    # Regex-only on code (no NER — too many false positives)
    code_text = "\n".join(text[s:e] for s, e in code_spans)
    code_detections = scan_secrets(code_text) + scan_regex_only(code_text)

    # Merge and anonymize
    all_detections = remap_offsets(comment_detections, comments) + \
                     remap_offsets(code_detections, code_spans)
    return anonymize(text, all_detections)
```

### 5.2 Deploy YAMLs (`CODE_DEPLOY`)

**Challenges:**
- Secrets referenced by name (e.g., `secretKeyRef: db-password`)
- Internal IPs and hostnames in env vars
- Service account names that may look like person names

**Strategy:**
1. Parse YAML structure
2. Scrub **values** of env vars, annotations, labels
3. Preserve **keys** (they're structural, not PII)
4. Detect and redact secret references, internal hostnames, private IPs

### 5.3 Documentation (`DOC_README`, `DOC_RUNBOOK`, `DOC_ADR`)

**Challenges:**
- Author attribution ("Written by Jane Smith")
- Contact information in runbooks
- Customer names in incident write-ups

**Strategy:**
- Full NER + regex pipeline, standard thresholds
- Pseudonymize person names (preserves document readability)
- Generalize dates to year

### 5.4 Conversations (`CONVO_SLACK`, `CONVO_TRANSCRIPT`)

**Challenges:**
- Every message has an author field (always PII)
- @mentions throughout message text
- Slack display names vs real names vs usernames
- Informal references ("talked to Sarah", "per John's request")
- Quoted content may contain nested PII

**Strategy:**
1. **Pre-scrub metadata:** Pseudonymize author fields using a user directory mapping before text enters the NER pipeline
2. **@mention replacement:** Regex `@[\w.-]+` → pseudonymized equivalent
3. Full NER on message text at lower threshold (0.3) — conversations are high-PII
4. Thread-level consistency: same person pseudonymized the same way across a thread

```python
def scrub_slack_thread(
    messages: list[dict],
    user_directory: dict[str, str],  # real_username -> pseudonym
    pseudonymizer: Pseudonymizer,
) -> list[dict]:
    """Scrub a Slack thread with consistent pseudonymization."""
    scrubbed = []
    for msg in messages:
        # 1. Pseudonymize author
        author = msg.get("user", "unknown")
        pseudo_author = user_directory.get(author, pseudonymizer.pseudonymize(author))

        # 2. Replace @mentions in text
        text = msg["text"]
        for mention in re.findall(r'@([\w.-]+)', text):
            pseudo = user_directory.get(mention, pseudonymizer.pseudonymize(mention))
            text = text.replace(f"@{mention}", f"@{pseudo}")

        # 3. Run full pipeline on remaining text
        detections = analyze_text(text, corpus_type="CONVO_SLACK")
        detections = filter_false_positives(detections, text, allowlist, "CONVO_SLACK")
        text = anonymize(text, detections)

        scrubbed.append({**msg, "user": pseudo_author, "text": text})
    return scrubbed
```

---

## 6. Pipeline Integration with RAG Crawl

The scrubbing pipeline hooks into the RAG ingest pipeline (see `DESIGN.md` Section 8) between crawling and embedding.

```
Crawler output (raw chunks)
         │
         ▼
  PHI Scrubbing Pipeline
  ┌────────────────────────────────────┐
  │  For each chunk:                   │
  │    1. Route to corpus-type handler │
  │    2. Detect (secrets + Presidio)  │
  │    3. Filter (allowlist)           │
  │    4. Anonymize (per-entity ops)   │
  │    5. Log detection counts + types │
  └────────────────────────────────────┘
         │
         ▼
  Scrubbed chunks → Embedder → LanceDB
```

**Key design constraint:** Scrubbing happens on the **raw text before chunking** when possible (full files, full threads), not on individual chunks. This ensures:
- Context around detected entities is available for NER
- Consistent pseudonymization across chunks from the same source
- Comment extraction (tree-sitter) works on complete files

For large files, scrub first, then chunk. For conversations, scrub at thread level, then chunk.

### 6.1 CLI Integration

```python
# In crawl.py, add scrubbing flag
parser.add_argument("--scrub", action="store_true", default=True,
                    help="Enable PHI/PII scrubbing (default: on)")
parser.add_argument("--no-scrub", action="store_false", dest="scrub",
                    help="Disable scrubbing (dev/test only)")
parser.add_argument("--scrub-salt", type=str, default=None,
                    help="Salt for pseudonymization (random if not set)")
parser.add_argument("--user-directory", type=Path, default=None,
                    help="JSON mapping of usernames to pseudonyms")
parser.add_argument("--allowlist", type=Path, default=None,
                    help="JSON allowlist config (service names, keywords)")
```

---

## 7. Evaluation

### 7.1 Metrics

PHI scrubbing is evaluated with a **recall-first** mindset. Missing PHI is a privacy violation; over-redacting is merely inconvenient.

| Metric | Formula | Target |
|--------|---------|--------|
| **Recall** | TP / (TP + FN) | >= 99% |
| **Precision** | TP / (TP + FP) | >= 80% |
| **F2-Score** | 5(P*R) / (4P + R) | >= 95% |

F2 weights recall 4x more than precision, reflecting the asymmetric cost of errors.

### 7.2 Evaluation Dataset

Build a domain-specific gold standard:

1. Sample 100 documents across corpus types (25 code, 25 deploy/config, 25 docs, 25 conversations)
2. Manually annotate all PHI/PII spans with entity type labels
3. Run the pipeline and compare detections against annotations
4. Compute per-entity-type recall and precision

**Annotation schema:**

```json
{
    "source_uri": "path/to/file.go",
    "annotations": [
        {"start": 45, "end": 56, "text": "John Smith", "entity_type": "PERSON"},
        {"start": 120, "end": 134, "text": "123-45-6789", "entity_type": "US_SSN"}
    ]
}
```

### 7.3 Benchmark Datasets (for baseline comparison)

| Dataset | Content | Entities | Notes |
|---------|---------|----------|-------|
| i2b2/n2c2 2014 | 1,304 medical records | All 18 HIPAA types | Gold standard for clinical NER |
| i2b2 2006 | Clinical discharge summaries | Names, dates, locations, IDs | Earlier, smaller benchmark |
| BigCode PII dataset | Source code | Emails, IPs, API keys | Code-specific PII |

### 7.4 Continuous Monitoring

```python
@dataclass
class ScrubReport:
    """Generated per crawl run for audit."""
    total_chunks: int
    chunks_with_detections: int
    detections_by_type: dict[str, int]    # e.g. {"PERSON": 342, "EMAIL": 89}
    detections_by_corpus: dict[str, int]  # e.g. {"CODE_LOGIC": 120, "CONVO_SLACK": 890}
    allowlist_filtered: int               # false positives caught
    low_confidence_skipped: int           # below threshold
    pseudonym_cache_size: int             # unique names pseudonymized
```

This report is written to `data/scrub_report.json` after each crawl.

---

## 8. Performance

### 8.1 Throughput Estimates

| Component | Throughput (CPU) | Notes |
|-----------|-----------------|-------|
| `detect-secrets` (regex) | ~10,000 docs/min | Fast, regex-only |
| Presidio regex recognizers | ~5,000 docs/min | Multiple regex patterns |
| spaCy NER (`en_core_web_lg`) | ~500-2,000 docs/min | Depends on doc length |
| **Combined pipeline** | **~500-1,000 docs/min** | Bottleneck is spaCy NER |

For a corpus of 50,000 chunks, the pipeline runs in roughly 1-2 hours on CPU.

### 8.2 Optimization Strategies

1. **Batch with `nlp.pipe()`:** spaCy's `nlp.pipe()` batches internally for better throughput
2. **Multiprocessing:** Each worker loads its own spaCy model. Use `concurrent.futures.ProcessPoolExecutor` with `n_workers = cpu_count - 1`
3. **Disable unused spaCy components:** `nlp = spacy.load("en_core_web_lg", disable=["parser", "lemmatizer"])` — we only need NER and tokenization
4. **Skip NER for pure-code chunks:** If tree-sitter confirms a chunk has no comments or string literals, skip the NER step entirely and run regex-only
5. **Pre-filter:** Skip chunks that contain no alphabetic characters (binary data, pure numeric configs)

```python
import spacy
from concurrent.futures import ProcessPoolExecutor

def scrub_batch(chunks: list[dict], n_workers: int = 4) -> list[dict]:
    """Scrub chunks in parallel across multiple processes."""
    with ProcessPoolExecutor(max_workers=n_workers) as executor:
        results = list(executor.map(scrub_single_chunk, chunks))
    return results
```

---

## 9. Dependencies

```
# PHI Scrubbing
presidio-analyzer>=2.2
presidio-anonymizer>=2.2
spacy>=3.7
detect-secrets>=1.4
faker>=20.0

# spaCy model (downloaded separately)
# python -m spacy download en_core_web_lg
```

**Dockerfile addition** (appended to the RAG Dockerfile):

```dockerfile
# PHI scrubbing deps
RUN pip install --no-cache-dir presidio-analyzer presidio-anonymizer detect-secrets faker

# spaCy NER model
RUN python -m spacy download en_core_web_lg
```

---

## 10. Project Structure

Additions to the `rag/` project (see `DESIGN.md` Section 11):

```
rag/
├── rag/
│   ├── scrubbing/
│   │   ├── __init__.py
│   │   ├── pipeline.py         # ScrubPipeline orchestrator
│   │   ├── secrets.py          # detect-secrets + custom regex
│   │   ├── presidio_setup.py   # Analyzer/Anonymizer factory + custom recognizers
│   │   ├── allowlist.py        # AllowlistConfig + false positive filter
│   │   ├── pseudonymizer.py    # Consistent name pseudonymization
│   │   ├── code_scrubber.py    # AST-aware code scrubbing
│   │   ├── convo_scrubber.py   # Slack/transcript scrubbing
│   │   └── report.py           # ScrubReport generation
│   ...
├── tests/
│   ├── test_scrubbing.py
│   ├── test_allowlist.py
│   ├── test_pseudonymizer.py
│   └── fixtures/
│       ├── phi_annotated.json  # Gold standard annotations
│       ...
```

---

## 11. Design Decisions

### D1: Presidio as the core framework

**Decision:** Microsoft Presidio, not a custom-built pipeline.

**Rationale:** Presidio provides the hybrid regex+NER architecture we need, with a plugin system for custom recognizers, built-in anonymization operators, and decision logging. Building this from scratch would take significant effort and we'd end up with the same architecture anyway. Presidio is MIT-licensed and actively maintained.

### D2: Scrub before chunk, not after

**Decision:** Run scrubbing on full files/threads before the chunking step.

**Rationale:** NER models perform better with more context. A function-level chunk may have a name that's only identifiable as PERSON because of surrounding context in the same file. Also, tree-sitter comment extraction needs the full file AST.

### D3: Pseudonymize names, redact everything else

**Decision:** Person names get consistent fake replacements; all other PHI types get type-tag redaction (`[SSN]`, `[PHONE]`, etc.).

**Rationale:** Names appear across many documents and their relationships matter for retrieval ("who worked on this?"). If we redacted names to `[PERSON]`, all person references would collapse into one embedding, destroying retrieval signal. Pseudonymization preserves the distinction between different people while removing real identity. Other PHI types (SSN, phone) carry no analytical value for code/operations retrieval.

### D4: AST-aware code scrubbing

**Decision:** Use tree-sitter to separate comments from code before running NER.

**Rationale:** Running NER on raw code produces excessive false positives. `Smith` as a class name is not PII; `// Fixed by John Smith` is. Tree-sitter lets us target NER precisely at the text that could contain PII (comments, string literals) while running only regex on code tokens.

### D5: Allowlist populated from deploy crawl

**Decision:** The allowlist of known service names comes from the deploy YAML crawler's output.

**Rationale:** Service names like `jackson-service` or `smith-api` will trigger PERSON NER. Rather than manually maintaining an allowlist, we auto-populate it from the Kubernetes service names discovered during the deploy crawl phase. This means the deploy crawler must run before scrubbing.

---

## 12. Open Questions

### Q1: LLM-based verification layer

Should we add a local LLM (Llama-3 8B) as a secondary verification pass on flagged entities? This would catch NER misses but adds ~10x latency. **Recommendation:** Not in v1. Evaluate recall without it first. Add if recall < 99%.

### Q2: Pseudonymization persistence across crawls

Should the same real name map to the same pseudonym across different crawl runs? Currently, a new random salt per run means pseudonyms change. Persistent mapping requires secure storage of the mapping table. **Recommendation:** Start with per-run salt. If cross-run consistency is needed (e.g., for incremental indexing), store the mapping encrypted at rest in `data/pseudonym_map.enc`.

### Q3: Clinical-specific NER model

If the corpus includes actual clinical notes (not just software for healthcare), should we add a clinical NER model (Med7, SciSpaCy, or a HuggingFace clinical transformer)? **Recommendation:** Not needed unless clinical notes are in scope. The current spaCy `en_core_web_lg` handles general PERSON/ORG/GPE/DATE well enough for software-adjacent content.
