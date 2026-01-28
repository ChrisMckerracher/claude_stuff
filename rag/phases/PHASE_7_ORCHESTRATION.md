# Phase 7: Orchestration & Deployment — CLI, Pipeline, Incremental, Docker

**Depends on:** All previous phases (1–6)
**Unlocks:** Production use

**Reference:** DESIGN.md Sections 8, 10, 15.8, 15.12

---

## 1. Scope

Wire everything together: the CLI entry point, the `IngestPipeline`
orchestrator with incremental support, the staleness checker, the query
HTTP server, the Dockerfile (separate crawl and serve images), and
end-to-end integration tests.

### In scope

- CLI entry point (`python -m rag.crawl` and `python -m rag.serve`)
- `IngestPipeline` orchestrator (full + incremental modes)
- `StalenessChecker` (manifest comparison)
- Manifest read/write (`data/manifest.json`)
- Query HTTP server (FastAPI, single `/query` endpoint)
- Dockerfile.crawl (crawl job image)
- Dockerfile.serve (query server image, bakes in `data/`)
- End-to-end integration tests (crawl fixture repo → query → verify)
- Health check endpoint

### Out of scope

- Production deployment (Kubernetes manifests, CI/CD)
- Monitoring/alerting
- Authentication on the query endpoint
- Rate limiting

---

## 2. Files to Create

```
rag/
├── rag/
│   ├── __main__.py               # CLI dispatch (crawl or serve)
│   ├── crawl.py                  # CLI for ingestion
│   ├── serve.py                  # FastAPI query server
│   ├── pipeline/
│   │   ├── ingest.py             # IngestPipeline orchestrator
│   │   └── staleness.py          # StalenessChecker
│   ├── models/
│   │   └── manifest.py           # IngestManifest (already created in Phase 1, extend here)
├── Dockerfile.crawl
├── Dockerfile.serve
├── docker-compose.yml            # optional: crawl + serve in one file
├── tests/
│   ├── test_cli.py
│   ├── test_ingest_pipeline.py   # unit tests with mocks
│   ├── test_staleness.py
│   ├── test_serve.py             # FastAPI test client
│   ├── test_e2e.py               # full end-to-end
│   └── fixtures/
│       └── repo/                 # mini git repo for e2e tests
│           ├── .git/             # (init in test setup)
│           ├── main.go
│           ├── handlers/
│           │   └── user.go
│           ├── k8s/
│           │   └── deployment.yaml
│           └── docs/
│               └── README.md
```

---

## 3. Implementation Details

### 3.1 CLI Entry Point (`rag/__main__.py`)

```python
import sys

def main():
    if len(sys.argv) < 2:
        print("Usage: python -m rag <command>")
        print("Commands: crawl, serve")
        sys.exit(1)

    command = sys.argv[1]
    if command == "crawl":
        from rag.crawl import main as crawl_main
        crawl_main()
    elif command == "serve":
        from rag.serve import main as serve_main
        serve_main()
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)

if __name__ == "__main__":
    main()
```

### 3.2 Crawl CLI (`rag/crawl.py`)

```python
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="Code Boundaries RAG Crawler")
    parser.add_argument("--repo-path", type=Path, action="append", default=[],
                        help="Path to git repo (repeatable for multi-repo)")
    parser.add_argument("--repo-name", type=str, action="append", default=[],
                        help="Name for each repo (defaults to dir name)")
    parser.add_argument("--slack-export", type=Path, default=None)
    parser.add_argument("--transcripts-dir", type=Path, default=None)
    parser.add_argument("--runbooks-dir", type=Path, default=None)
    parser.add_argument("--gdocs-dir", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=Path("./data"))
    parser.add_argument("--incremental", action="store_true",
                        help="Only re-index changed sources")
    parser.add_argument("--scrub-seed", type=int, default=42,
                        help="Seed for consistent pseudonymization")
    args = parser.parse_args()

    # Build source list
    sources = build_sources(args)

    # Construct pipeline components
    scrubber = PresidioScrubber(seed=args.scrub_seed)
    embedder = CodeRankEmbedder()
    resolver = ServiceNameResolver()
    indexer = CompositeIndexer(args.output_dir, resolver)

    pipeline = IngestPipeline(
        output_dir=args.output_dir,
        scrubber=scrubber,
        embedder=embedder,
        indexer=indexer,
    )

    pipeline.ingest(sources, incremental=args.incremental)

def build_sources(args) -> list[CrawlSource]:
    """Convert CLI args to typed CrawlSource objects."""
    sources = []
    repo_names = args.repo_name or [None] * len(args.repo_path)
    for path, name in zip(args.repo_path, repo_names):
        sources.append(CrawlSource(
            source_kind=SourceKind.REPO,
            path=path,
            repo_name=name or path.name,
        ))
    if args.slack_export:
        sources.append(CrawlSource(SourceKind.SLACK_EXPORT, args.slack_export))
    if args.transcripts_dir:
        sources.append(CrawlSource(SourceKind.TRANSCRIPT_DIR, args.transcripts_dir))
    if args.runbooks_dir:
        sources.append(CrawlSource(SourceKind.RUNBOOK_DIR, args.runbooks_dir))
    if args.gdocs_dir:
        sources.append(CrawlSource(SourceKind.GOOGLE_DOCS_DIR, args.gdocs_dir))
    return sources
```

### 3.3 `IngestPipeline` (Full Implementation)

```python
class IngestPipeline:
    def __init__(self, output_dir, scrubber, embedder, indexer, batch_size=64):
        self._scrub_gate = ScrubGate(scrubber)
        self._embedder = embedder
        self._indexer = indexer
        self._batch_size = batch_size
        self._output_dir = output_dir
        self._manifest = self._load_manifest()
        self._staleness = StalenessChecker(self._manifest)

    def ingest(self, sources: list[CrawlSource], incremental: bool = False):
        new_chunks: list[CleanChunk] = []
        processed_sources: list[CrawlSource] = []

        for source in sources:
            if incremental:
                result = self._staleness.check(source)
                if result.status == "fresh":
                    logger.info("skip_fresh", source=str(source.path))
                    continue
                if result.status == "stale":
                    self._indexer.delete_by_source(source)

            crawler_classes = CRAWLER_ROUTING[source.source_kind]
            for crawler_cls in crawler_classes:
                crawler = crawler_cls()
                for raw_chunk in crawler.crawl(source):
                    clean = self._scrub_gate.process(raw_chunk)
                    new_chunks.append(clean)

            processed_sources.append(source)

        if not new_chunks:
            logger.info("nothing_to_ingest")
            return

        # Batch embed
        for i in range(0, len(new_chunks), self._batch_size):
            batch = new_chunks[i : i + self._batch_size]
            embedded = self._embedder.embed_batch(batch)
            self._indexer.index(embedded)

        # Rebuild BM25 + service graph
        self._indexer.finalize()

        # Update manifest
        self._update_manifest(processed_sources, new_chunks)

    def _load_manifest(self) -> IngestManifest:
        path = self._output_dir / "manifest.json"
        if path.exists():
            return IngestManifest.from_json(path.read_text())
        return IngestManifest()

    def _update_manifest(self, sources, chunks):
        now = datetime.now(timezone.utc).isoformat()
        for source in sources:
            key = f"{source.source_kind.value}:{source.repo_name or source.path.name}"
            source_chunks = [c for c in chunks if self._chunk_from_source(c, source)]
            self._manifest.sources[key] = SourceManifest(
                source_kind=source.source_kind.value,
                path_hash=hashlib.sha256(str(source.path).encode()).hexdigest(),
                repo_name=source.repo_name,
                last_git_hash=git_rev_parse(source.path) if source.source_kind == SourceKind.REPO else None,
                last_file_hash=file_hash(source.path) if source.path.is_file() else None,
                last_ingest_at=now,
                chunk_count=len(source_chunks),
                corpus_types_indexed=list({c.source_type.corpus_type for c in source_chunks}),
            )
        self._manifest.updated_at = now
        self._manifest.total_chunk_count = self._indexer.count()
        manifest_path = self._output_dir / "manifest.json"
        manifest_path.write_text(self._manifest.to_json())
```

### 3.4 `StalenessChecker`

```python
class StalenessChecker:
    def __init__(self, manifest: IngestManifest):
        self._manifest = manifest

    def check(self, source: CrawlSource) -> StalenessResult:
        key = f"{source.source_kind.value}:{source.repo_name or source.path.name}"
        existing = self._manifest.sources.get(key)

        if existing is None:
            return StalenessResult(status="new", reason="never indexed")

        if source.source_kind == SourceKind.REPO:
            current = git_rev_parse(source.path)
            if current != existing.last_git_hash:
                return StalenessResult(
                    status="stale",
                    reason=f"git: {existing.last_git_hash[:8]}→{current[:8]}",
                    changed_files=git_diff_names(source.path, existing.last_git_hash),
                )
            return StalenessResult(status="fresh")

        if source.path.is_file():
            current = file_hash(source.path)
            if current != existing.last_file_hash:
                return StalenessResult(status="stale", reason="file changed")
            return StalenessResult(status="fresh")

        if source.path.is_dir():
            newest = max_mtime_in_dir(source.path)
            if newest > existing.last_ingest_at:
                return StalenessResult(status="stale", reason="dir has newer files")
            return StalenessResult(status="fresh")

        return StalenessResult(status="stale", reason="unknown")
```

### 3.5 Query Server (`rag/serve.py`)

```python
from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Code Boundaries RAG")

# Global pipeline (loaded once at startup)
pipeline: RetrievalPipeline | None = None

@app.on_event("startup")
def startup():
    global pipeline
    data_dir = Path(os.environ.get("RAG_DATA_DIR", "/data"))
    pipeline = load_retrieval_pipeline(data_dir)

@app.get("/health")
def health():
    return {"status": "ok", "chunk_count": pipeline.chunk_count()}

@app.post("/query")
def query(req: QueryRequest) -> QueryResult:
    return pipeline.query(req)

def main():
    uvicorn.run(app, host="0.0.0.0", port=8080)
```

### 3.6 Dockerfiles

**`Dockerfile.crawl`:**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential git && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('nomic-ai/CodeRankEmbed', trust_remote_code=True)"
RUN python -c "from sentence_transformers import CrossEncoder; \
    CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"
RUN python -m spacy download en_core_web_sm

COPY rag/ ./rag/

ENTRYPOINT ["python", "-m", "rag", "crawl"]
CMD ["--help"]
```

**`Dockerfile.serve`:**

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download models (needed for query-time embedding + reranking)
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('nomic-ai/CodeRankEmbed', trust_remote_code=True)"
RUN python -c "from sentence_transformers import CrossEncoder; \
    CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')"

COPY rag/ ./rag/

# Bake in the data directory (built by crawl)
COPY data/ /data/

ENV RAG_DATA_DIR=/data

EXPOSE 8080
ENTRYPOINT ["python", "-m", "rag", "serve"]
```

**Build workflow:**

```bash
# Step 1: Crawl (writes to ./data)
docker build -f Dockerfile.crawl -t code-rag-crawl .
docker run --rm \
    -v /path/to/repos:/repos:ro \
    -v ./data:/data \
    code-rag-crawl \
    --repo-path /repos/auth --repo-path /repos/frontend \
    --output-dir /data

# Step 2: Build serve image (bakes in ./data)
docker build -f Dockerfile.serve -t code-rag-serve .

# Step 3: Run query server
docker run -d -p 8080:8080 code-rag-serve

# Step 4: Query
curl -X POST http://localhost:8080/query \
    -H "Content-Type: application/json" \
    -d '{"text": "how does authentication work"}'
```

---

## 4. Testing Strategy

### 4.1 Unit Tests: `tests/test_cli.py`

| Test | What it verifies |
|------|-----------------|
| `test_build_sources_single_repo` | 1 repo path → 1 CrawlSource(REPO) |
| `test_build_sources_multi_repo` | 3 repo paths → 3 CrawlSources with correct names |
| `test_build_sources_with_slack` | --slack-export → CrawlSource(SLACK_EXPORT) |
| `test_build_sources_all_options` | All args → correct list of CrawlSources |
| `test_repo_name_defaults_to_dirname` | No --repo-name → uses path.name |

### 4.2 Unit Tests: `tests/test_staleness.py`

| Test | What it verifies |
|------|-----------------|
| `test_new_source` | Source not in manifest → status="new" |
| `test_fresh_repo` | Same git hash → status="fresh" |
| `test_stale_repo` | Different git hash → status="stale" with changed_files |
| `test_fresh_file` | Same file hash → status="fresh" |
| `test_stale_file` | Different file hash → status="stale" |
| `test_stale_dir` | Dir has newer files → status="stale" |
| `test_fresh_dir` | No newer files → status="fresh" |

### 4.3 Unit Tests: `tests/test_ingest_pipeline.py`

Use mock crawlers, scrubber, embedder, indexer.

| Test | What it verifies |
|------|-----------------|
| `test_full_ingest_calls_all_stages` | Crawl → scrub → embed → index → finalize |
| `test_incremental_skips_fresh` | Fresh source → crawler.crawl() not called |
| `test_incremental_deletes_stale` | Stale source → indexer.delete_by_source() called |
| `test_incremental_processes_new` | New source → full pipeline runs |
| `test_manifest_updated` | After ingest, manifest reflects new state |
| `test_empty_ingest` | No sources → no crash, "nothing_to_ingest" logged |
| `test_batch_embedding` | 200 chunks → embedded in batches of 64 |
| `test_finalize_called_once` | Finalize (BM25 + graph rebuild) called exactly once |

### 4.4 API Tests: `tests/test_serve.py`

Use FastAPI's `TestClient` (no real server needed).

| Test | What it verifies |
|------|-----------------|
| `test_health_endpoint` | GET /health → 200 with status "ok" |
| `test_query_endpoint` | POST /query → 200 with QueryResult shape |
| `test_query_with_filters` | Corpus/service/repo filters applied |
| `test_query_empty_text` | Empty text → 400 or empty results |
| `test_query_result_shape` | Response has `chunks` and `service_context` keys |

### 4.5 End-to-End Tests: `tests/test_e2e.py`

**The definitive confidence test.** Build a fixture mini-repo, crawl it,
query it, verify results make sense.

**Setup:**

```python
@pytest.fixture
def e2e_env(tmp_path):
    """Create a mini git repo with Go code, k8s YAML, and markdown."""
    repo_path = tmp_path / "test-service"
    repo_path.mkdir()

    # Initialize git repo
    subprocess.run(["git", "init"], cwd=repo_path)

    # Write Go handler
    (repo_path / "handlers").mkdir()
    (repo_path / "handlers" / "user.go").write_text('''
package handlers

import (
    "net/http"
    "encoding/json"
)

func GetUser(w http.ResponseWriter, r *http.Request) {
    resp, _ := http.Get("http://auth-service:8080/validate")
    defer resp.Body.Close()
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
''')

    # Write k8s manifest
    (repo_path / "k8s").mkdir()
    (repo_path / "k8s" / "deployment.yaml").write_text('''
apiVersion: apps/v1
kind: Deployment
metadata:
  name: test-service
  labels:
    app: test-service
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: app
        image: test-service:latest
''')

    # Write docs
    (repo_path / "docs").mkdir()
    (repo_path / "docs" / "README.md").write_text('''
# Test Service

Handles user requests and delegates to auth-service for validation.

## API

### GET /users/:id

Returns user data after auth validation.
''')

    # Commit
    subprocess.run(["git", "add", "."], cwd=repo_path)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo_path)

    return repo_path, tmp_path / "data"
```

| Test | What it verifies |
|------|-----------------|
| `test_e2e_crawl_creates_data_dir` | After crawl, `data/` contains rag.lance, bm25_index, service_graph, manifest |
| `test_e2e_manifest_populated` | manifest.json has correct repo hash, chunk counts |
| `test_e2e_query_finds_code` | Query "GetUser" → returns the Go handler chunk |
| `test_e2e_query_finds_docs` | Query "auth validation" → returns README chunk |
| `test_e2e_query_finds_deploy` | Query "test-service deployment" → returns k8s chunk |
| `test_e2e_service_graph_has_edge` | Graph shows test-service → auth-service edge |
| `test_e2e_graph_expansion` | Query with expand_graph → service_context includes auth-service |
| `test_e2e_incremental_skip_fresh` | Re-run crawl with --incremental (no changes) → nothing re-indexed |
| `test_e2e_incremental_detects_change` | Modify handler, re-crawl → only code chunks re-indexed |
| `test_e2e_add_new_source` | Add Slack fixture, re-crawl → Slack chunks added, code unchanged |
| `test_e2e_clean_chunks_no_phi` | All CODE_LOGIC chunks passed through ScrubGate as CLEAN |
| `test_e2e_chunk_ids_deterministic` | Crawl twice (full) → same chunk IDs |

### 4.6 Docker Tests (manual or CI)

These are heavier and may run in CI only:

| Test | What it verifies |
|------|-----------------|
| `test_docker_crawl_build` | `docker build -f Dockerfile.crawl` succeeds |
| `test_docker_crawl_help` | Container prints help when run with no args |
| `test_docker_crawl_fixture` | Crawl fixture repo via Docker → data/ populated |
| `test_docker_serve_build` | `docker build -f Dockerfile.serve` succeeds (with data/) |
| `test_docker_serve_health` | Health endpoint returns 200 |
| `test_docker_serve_query` | Query endpoint returns results |

---

## 5. Acceptance Criteria

- [ ] `python -m rag crawl --help` prints usage
- [ ] `python -m rag crawl --repo-path <path> --output-dir <dir>` produces valid `data/`
- [ ] `python -m rag serve` starts HTTP server, `/health` returns 200
- [ ] `/query` endpoint accepts QueryRequest and returns QueryResult
- [ ] Incremental mode skips fresh sources, re-indexes stale ones
- [ ] Manifest tracks per-source git hashes, file hashes, timestamps
- [ ] `Dockerfile.crawl` builds and runs successfully
- [ ] `Dockerfile.serve` builds with baked-in data and serves queries
- [ ] End-to-end test: crawl fixture repo → query → correct results
- [ ] Incremental e2e: modify file → re-crawl → only changed chunks re-indexed
- [ ] All 35+ tests pass
- [ ] `mypy rag/ --strict` passes (entire package)

---

## 6. Dependencies (pip, this phase)

```
fastapi>=0.110
uvicorn>=0.27
```

All other deps installed in previous phases.

---

## 7. Phase Dependency Graph (All Phases)

```
Phase 1: Foundation
    │
    ├──────────────────────┐
    │                      │
    ▼                      ▼
Phase 2: Code Crawler    Phase 3: Content Crawlers
    │                      │
    │    ┌─────────────────┘
    │    │
    ▼    ▼
Phase 4: PHI Scrubbing
    │
    ▼
Phase 5: Embedding & Storage
    │
    ▼
Phase 6: Retrieval Pipeline
    │
    ▼
Phase 7: Orchestration & Deployment (this phase)
```

Phases 2 and 3 can run in parallel. Phase 4 can start once Phase 1 is done
(for the ScrubGate routing) and finalize once at least one crawler exists
to produce test RawChunks. Phase 5 needs Phase 4 because it takes
CleanChunks as input.
