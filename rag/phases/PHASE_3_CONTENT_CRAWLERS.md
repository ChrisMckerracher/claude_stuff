# Phase 3: Content Crawlers — Deploy, Docs, Conversations

**Depends on:** Phase 1 (Foundation)
**Unlocks:** Phase 5 (Embedding & Storage)
**Can run in parallel with:** Phase 2 (Code Crawler)

**Reference:** DESIGN.md Sections 4.2, 4.3, 4.4

---

## 1. Scope

Build the four non-code crawlers. Each handles a different content type but
all produce `RawChunk` objects with appropriate `source_type` from the
registry. These crawlers are simpler than the code crawler — no AST parsing,
no multi-language support — but each has its own chunking strategy.

### In scope

- `DeployCrawler` — Kubernetes YAML, Dockerfiles, Helm templates
- `ConfigCrawler` — `.env` templates, `go.mod`, `package.json`, `appsettings.json`
- `DocsCrawler` — Markdown files (README, runbooks, ADRs), with path-based
  corpus type classification
- `SlackCrawler` — Slack JSON exports, thread-level chunking
- `TranscriptCrawler` — Meeting transcript files, speaker-turn chunking
- `GoogleDocsCrawler` — Exported Google Docs (HTML or markdown)
- `RunbookCrawler` — Standalone runbook directories (outside repos)
- Service reference extraction from conversations (mentions of known services)
- YAML chunkers, markdown chunkers, thread chunkers

### Out of scope

- Code parsing (Phase 2)
- PHI scrubbing (Phase 4 — the crawlers just produce RawChunks)
- Embedding/indexing (Phase 5)

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── crawlers/
│   │   ├── deploy.py             # DeployCrawler
│   │   ├── config.py             # ConfigCrawler
│   │   ├── docs.py               # DocsCrawler, RunbookCrawler, GoogleDocsCrawler
│   │   └── conversation.py       # SlackCrawler, TranscriptCrawler
│   ├── chunking/
│   │   ├── yaml_chunker.py       # YAML document/block splitting
│   │   ├── md_chunker.py         # Markdown heading-based splitting
│   │   └── thread_chunker.py     # Thread/speaker-turn splitting
│   └── boundary/
│       └── service_refs.py       # Extract service mentions from freeform text
├── tests/
│   ├── test_deploy_crawler.py
│   ├── test_docs_crawler.py
│   ├── test_conversation_crawler.py
│   ├── test_yaml_chunker.py
│   ├── test_md_chunker.py
│   ├── test_thread_chunker.py
│   ├── test_service_refs.py
│   └── fixtures/
│       ├── k8s/
│       │   ├── deployment.yaml       # single Deployment
│       │   ├── multi-resource.yaml   # Deployment + Service + ConfigMap (---)
│       │   ├── ingress.yaml          # Ingress with host/path rules
│       │   └── env-refs.yaml         # Deployment with env vars referencing other services
│       ├── config/
│       │   ├── go.mod
│       │   ├── package.json
│       │   └── appsettings.json
│       ├── docs/
│       │   ├── README.md
│       │   ├── runbooks/
│       │   │   └── deploy-rollback.md
│       │   └── adr/
│       │       └── 001-auth-service.md
│       ├── slack/
│       │   └── export.json           # multi-channel, multi-thread export
│       └── transcripts/
│           └── standup-2024-01-15.txt
```

---

## 3. Implementation Details

### 3.1 DeployCrawler

**Parser:** `pyyaml` with `yaml.safe_load_all()` for multi-document support.

**Chunking:** Each YAML document (separated by `---`) becomes one chunk.
Each Kubernetes resource is one chunk.

**Metadata extraction:**

```python
def extract_k8s_metadata(doc: dict) -> dict:
    kind = doc.get("kind", "")
    metadata = doc.get("metadata", {})
    return {
        "symbol_name": metadata.get("name"),
        "symbol_kind": kind.lower(),    # "deployment", "service", etc.
        "service_name": metadata.get("labels", {}).get("app"),
        "k8s_labels": metadata.get("labels"),
    }
```

**Boundary signals:** Extract from:
- `Service` resources → service name, port, selector
- `Deployment` env vars → `value: "http://other-service:8080"` → `calls_out`
- `Ingress` → external boundary (host, path, backend service)

**Corpus type:** `CODE_DEPLOY`

### 3.2 ConfigCrawler

**Strategy:** Whole-file chunking. Config files are small enough to be
single chunks. Classify by filename:

```python
CONFIG_PATTERNS: dict[str, str] = {
    "go.mod": "CODE_CONFIG",
    "go.sum": None,              # skip, too large and noisy
    "package.json": "CODE_CONFIG",
    "package-lock.json": None,   # skip
    "appsettings.json": "CODE_CONFIG",
    ".env.example": "CODE_CONFIG",
    ".env.template": "CODE_CONFIG",
    "Dockerfile": "CODE_DEPLOY",
    "docker-compose.yml": "CODE_DEPLOY",
    "docker-compose.yaml": "CODE_DEPLOY",
}
```

**Never index:** `.env` (secrets), `*.lock` files, `node_modules/`.

### 3.3 DocsCrawler

**Parser:** `mistune` for markdown AST.

**Chunking:** Split on heading boundaries (H1, H2, H3). Each section
becomes a chunk with `section_path` capturing the heading hierarchy.

```python
def chunk_markdown(text: str, file_path: str) -> list[ChunkData]:
    """Split markdown into heading-based chunks.

    section_path format: "## Deploy > ### Rollback > #### Step 3"
    """
```

**Corpus type classification by path:**

```python
DOC_TYPE_RULES: list[tuple[str, str]] = [
    (r"runbook", "DOC_RUNBOOK"),
    (r"adr|decision", "DOC_ADR"),
    (r"readme|docs/", "DOC_README"),
]
```

Default to `DOC_README` if no pattern matches.

**Oversized sections:** If a section exceeds 512 tokens, split on paragraph
boundaries within it. Never split mid-paragraph.

### 3.4 SlackCrawler

**Input:** Slack JSON export format. Each channel is a directory of JSON
files, one per day. Each file contains an array of messages.

**Chunking:**

1. Group messages by `thread_ts` (thread parent timestamp)
2. Messages without `thread_ts` are standalone (their own `ts` is the thread)
3. Each thread becomes one chunk
4. If a thread exceeds 512 tokens, split at message boundaries (never mid-message)
5. Context prefix: `#channel-name > @author > 2024-01-15T10:30:00Z`

**Service reference extraction:** After chunking, scan each chunk's text for
mentions of known service names. Since we don't have the known service list
yet at crawl time (it comes from deploy/code crawlers), store raw mentions
and resolve later, OR accept a `known_services` set as input.

**Metadata:**

```python
{
    "author": message["user"],
    "channel": channel_name,
    "thread_id": thread_ts,
    "timestamp": message["ts"],  # converted to ISO 8601
    "corpus_type": "CONVO_SLACK",
}
```

### 3.5 TranscriptCrawler

**Input:** Plain text or structured transcript files. Assume format:

```
[10:30] Alice: Let's discuss the auth-service migration.
[10:31] Bob: The user-service dependency is blocking us.
[10:32] Alice: Can we mock it for now?
```

**Chunking:** Group consecutive speaker turns into chunks of ~400 tokens.
Preserve speaker attribution. Never split mid-turn.

**Corpus type:** `CONVO_TRANSCRIPT` (SENSITIVE)

### 3.6 GoogleDocsCrawler

**Input:** Directory of exported Google Docs (markdown or HTML format).

**Chunking:** Same as DocsCrawler (heading-based split via mistune).
The only difference is the corpus type: `DOC_GOOGLE` (SENSITIVE).

### 3.7 Service Reference Extraction (`rag/boundary/service_refs.py`)

```python
def extract_service_refs(text: str, known_services: set[str]) -> list[str]:
    """Find mentions of known services in freeform text.

    Matches:
    - Exact service names (case-insensitive)
    - URL patterns: http://service-name:port/...
    - Hyphenated references: "the auth-service is down"
    """
```

This function is used by conversation crawlers AND can be used to enrich
doc chunks. It takes a `known_services` set, which is populated by the
deploy crawler (from k8s Service resource names).

---

## 4. Testing Strategy

### 4.1 Test Fixtures

**`tests/fixtures/k8s/multi-resource.yaml`:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-service
  labels:
    app: auth-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: auth
        image: auth-service:latest
        env:
        - name: USER_SERVICE_URL
          value: "http://user-service:8080"
---
apiVersion: v1
kind: Service
metadata:
  name: auth-service
  labels:
    app: auth-service
spec:
  ports:
  - port: 8080
  selector:
    app: auth-service
```

Expected: 2 chunks (Deployment + Service). Deployment chunk has
`calls_out=["user-service"]` from the env var.

**`tests/fixtures/slack/export.json`:**

```json
{
  "channels": {
    "incident-response": [
      {"ts": "1705312200.000100", "user": "alice",
       "text": "auth-service is returning 503s"},
      {"ts": "1705312260.000200", "user": "bob", "thread_ts": "1705312200.000100",
       "text": "checking the user-service dependency"},
      {"ts": "1705312320.000300", "user": "alice", "thread_ts": "1705312200.000100",
       "text": "looks like user-service is OOMing"}
    ]
  }
}
```

Expected: 1 thread chunk (all 3 messages in one thread).
`service_refs` should contain `["auth-service", "user-service"]`.

### 4.2 Unit Tests: `tests/test_yaml_chunker.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_single_document` | `deployment.yaml` | 1 chunk |
| `test_multi_document_split` | `multi-resource.yaml` | 2 chunks (split on `---`) |
| `test_k8s_metadata_extraction` | `deployment.yaml` | `symbol_name`, `symbol_kind`, `service_name`, `k8s_labels` |
| `test_env_var_service_detection` | `env-refs.yaml` | `calls_out` populated from env var URLs |
| `test_ingress_extraction` | `ingress.yaml` | Backend service references extracted |
| `test_malformed_yaml_handled` | custom | Invalid YAML → skip or warn, don't crash |

### 4.3 Unit Tests: `tests/test_md_chunker.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_heading_split` | `deploy-rollback.md` | Chunks split at H2/H3 boundaries |
| `test_section_path` | `deploy-rollback.md` | `section_path = "## Deploy > ### Rollback"` |
| `test_nested_headings` | custom | H1 > H2 > H3 hierarchy preserved in section_path |
| `test_oversized_section` | custom | Section >512 tokens → split on paragraphs |
| `test_code_blocks_preserved` | custom | Code blocks inside markdown are kept intact (not split) |
| `test_empty_sections_skipped` | custom | Heading with no content → no chunk |

### 4.4 Unit Tests: `tests/test_thread_chunker.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_thread_grouping` | `export.json` | Messages with same `thread_ts` → one chunk |
| `test_standalone_message` | custom | Message without `thread_ts` → own chunk |
| `test_long_thread_split` | custom | Thread >512 tokens → split at message boundaries |
| `test_speaker_attribution` | transcript | Speaker names preserved in chunk text |
| `test_timestamp_extraction` | `export.json` | ISO 8601 timestamp on chunk metadata |
| `test_never_split_mid_message` | custom | Chunk boundaries are always between messages |

### 4.5 Unit Tests: `tests/test_service_refs.py`

| Test | Fixture | What it verifies |
|------|---------|-----------------|
| `test_exact_match` | — | `"auth-service is down"` + `{"auth-service"}` → `["auth-service"]` |
| `test_case_insensitive` | — | `"Auth-Service"` matches `"auth-service"` |
| `test_url_pattern` | — | `"http://user-service:8080/api"` → `["user-service"]` |
| `test_no_false_substring` | — | `"service"` alone doesn't match `"auth-service"` |
| `test_multiple_refs` | — | Text mentioning 3 services → all 3 returned |
| `test_no_known_services` | — | Empty known_services → empty result |

### 4.6 Integration Tests

| Test | What it verifies |
|------|-----------------|
| `test_deploy_crawler_yields_raw_chunks` | DeployCrawler on `fixtures/k8s/` → RawChunks with CODE_DEPLOY type |
| `test_docs_crawler_classifies_correctly` | README → DOC_README, runbook → DOC_RUNBOOK, ADR → DOC_ADR |
| `test_slack_crawler_thread_grouping` | SlackCrawler on `fixtures/slack/` → thread-level chunks |
| `test_config_crawler_skips_lockfiles` | ConfigCrawler skips `package-lock.json`, `go.sum` |
| `test_all_chunks_have_correct_sensitivity` | CODE_DEPLOY → CLEAN, CONVO_SLACK → MAYBE_SENSITIVE |
| `test_crawl_deterministic` | Two runs on same fixtures → same chunk IDs |

---

## 5. Acceptance Criteria

- [ ] All 5 crawlers satisfy the `Crawler` protocol
- [ ] Each crawler yields `RawChunk` with correct `source_type` from registry
- [ ] YAML multi-document splitting works correctly
- [ ] Markdown heading-based chunking preserves section_path hierarchy
- [ ] Slack threads are grouped correctly (never split mid-message)
- [ ] K8s env var URL references populate `calls_out`
- [ ] Service reference extraction works on freeform text
- [ ] Path-based doc classification routes to correct corpus type
- [ ] Lockfiles, `.env`, and vendor dirs are excluded
- [ ] All 30+ unit/integration tests pass
- [ ] `mypy rag/crawlers/ rag/chunking/ --strict` passes

---

## 6. Dependencies (pip, this phase)

```
pyyaml>=6.0
mistune>=3.0
```
