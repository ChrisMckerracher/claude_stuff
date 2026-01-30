# Task 7.2: Dagster Assets

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Define Dagster assets for the ingestion pipeline with proper dependencies.

## File

`rag/pipeline/assets.py`

## Implementation

```python
from dataclasses import dataclass
from pathlib import Path
from dagster import asset, AssetIn, Config, Definitions, define_asset_job
from rag.extractors import RouteExtractor, ServiceExtractor, CallLinker
from rag.extractors.registry import SQLiteRegistry
from rag.crawlers import CodeCrawler
from rag.chunking import ASTChunker, TokenCounter
from rag.scrubbing import PresidioScrubber, Pseudonymizer
from rag.indexing import LanceStore, CodeRankEmbedder
from rag.graphiti import MockGraphStore

# === Config ===

class RAGConfig(Config):
    """Configuration for RAG pipeline."""
    repos: list[dict]  # [{"name": "auth-service", "path": "./auth"}]
    lance_db_path: str = "./data/lance"
    routes_db_path: str = "./data/routes.db"
    use_mock_graph: bool = True


# === Asset Output Types ===

@dataclass
class RawCodeFilesOutput:
    files_by_service: dict[str, list[Path]]
    total_files: int

@dataclass
class RouteRegistryOutput:
    db_path: str
    service_count: int
    route_count: int

@dataclass
class CodeChunksOutput:
    chunks_by_service: dict[str, list]
    total_chunks: int

@dataclass
class VectorIndexOutput:
    db_path: str
    chunks_indexed: int

@dataclass
class ServiceRelationsOutput:
    relations: list
    linked_count: int
    unlinked_count: int


# === Assets ===

@asset
def raw_code_files(config: RAGConfig) -> RawCodeFilesOutput:
    """Crawl all configured repositories."""
    crawler = CodeCrawler()
    files_by_service = {}
    total = 0

    for repo in config.repos:
        from rag.core.types import CrawlSource
        source = CrawlSource("git_repo", repo["path"], {"service": repo["name"]})
        files = list(crawler.crawl(source))
        files_by_service[repo["name"]] = [Path(f.source_uri) for f in files]
        total += len(files)

    return RawCodeFilesOutput(files_by_service=files_by_service, total_files=total)


@asset
def route_registry(
    config: RAGConfig,
    raw_code_files: RawCodeFilesOutput,
) -> RouteRegistryOutput:
    """Extract routes from all services and store in SQLite.

    MUST complete before service_relations can run.
    """
    registry = SQLiteRegistry(config.routes_db_path)
    registry.clear()

    extractor = RouteExtractor()
    total_routes = 0

    for service_name, files in raw_code_files.files_by_service.items():
        routes = []
        for file_path in files:
            content = file_path.read_bytes()
            routes.extend(extractor.extract(content, str(file_path), service_name))

        registry.add_routes(service_name, routes)
        total_routes += len(routes)

    return RouteRegistryOutput(
        db_path=config.routes_db_path,
        service_count=len(raw_code_files.files_by_service),
        route_count=total_routes,
    )


@asset
def code_chunks(
    config: RAGConfig,
    raw_code_files: RawCodeFilesOutput,
) -> CodeChunksOutput:
    """Chunk all code files using AST-aware chunking."""
    chunker = ASTChunker(TokenCounter())
    chunks_by_service = {}
    total = 0

    for service_name, files in raw_code_files.files_by_service.items():
        service_chunks = []
        for file_path in files:
            content = file_path.read_bytes()
            language = _detect_language(file_path)
            chunks = list(chunker.chunk(content, source_uri=str(file_path), language=language))
            service_chunks.extend(chunks)
        chunks_by_service[service_name] = service_chunks
        total += len(service_chunks)

    return CodeChunksOutput(chunks_by_service=chunks_by_service, total_chunks=total)


@asset
def service_relations(
    config: RAGConfig,
    raw_code_files: RawCodeFilesOutput,
    route_registry: RouteRegistryOutput,
) -> ServiceRelationsOutput:
    """Extract service calls and link to handlers."""
    registry = SQLiteRegistry(route_registry.db_path)
    linker = CallLinker(registry)
    extractor = ServiceExtractor()

    relations = []
    unlinked = []

    for service_name, files in raw_code_files.files_by_service.items():
        for file_path in files:
            content = file_path.read_bytes()
            calls = extractor.extract_from_file(str(file_path), content)

            for call in calls:
                call.source_file = str(file_path)
                result = linker.link(call)
                if result.linked:
                    relations.append(result.relation)
                else:
                    unlinked.append((call, result.miss_reason))

    return ServiceRelationsOutput(
        relations=relations,
        linked_count=len(relations),
        unlinked_count=len(unlinked),
    )


@asset
def vector_index(
    config: RAGConfig,
    code_chunks: CodeChunksOutput,
) -> VectorIndexOutput:
    """Embed and store chunks in LanceDB."""
    import asyncio

    store = LanceStore(config.lance_db_path)
    embedder = CodeRankEmbedder()
    scrubber = PresidioScrubber(Pseudonymizer())

    async def index():
        indexed = 0
        for service_chunks in code_chunks.chunks_by_service.values():
            for chunk in service_chunks:
                clean = scrubber.scrub(chunk)
                vector = embedder.embed(clean.text)
                from rag.core.types import EmbeddedChunk
                await store.insert(EmbeddedChunk(chunk=clean, vector=vector))
                indexed += 1
        return indexed

    count = asyncio.run(index())
    return VectorIndexOutput(db_path=config.lance_db_path, chunks_indexed=count)


def _detect_language(path: Path) -> str | None:
    """Detect language from file extension."""
    ext_map = {".py": "python", ".go": "go", ".ts": "typescript", ".cs": "csharp"}
    return ext_map.get(path.suffix.lower())


# === Job Definitions ===

ingestion_job = define_asset_job(
    name="full_ingestion",
    selection="*",
    description="Run full ingestion pipeline",
)


# === Dagster Definitions ===

defs = Definitions(
    assets=[raw_code_files, route_registry, code_chunks, service_relations, vector_index],
    jobs=[ingestion_job],
)
```

## Tests

```python
def test_raw_code_files_asset(tmp_path):
    (tmp_path / "main.py").write_text("def foo(): pass")
    config = RAGConfig(repos=[{"name": "test", "path": str(tmp_path)}])

    result = raw_code_files(config)

    assert result.total_files == 1
    assert "test" in result.files_by_service

def test_asset_dependencies():
    """Verify asset dependency graph is correct."""
    # route_registry depends on raw_code_files
    # service_relations depends on raw_code_files AND route_registry
    # vector_index depends on code_chunks
    from dagster import AssetKey

    # This would use Dagster's asset graph validation
    pass

def test_dagster_dev_starts():
    """Verify dagster dev can load definitions."""
    from rag.pipeline.assets import defs
    assert len(defs.get_asset_graph().all_asset_keys) == 5
```

## Acceptance Criteria

- [ ] All assets defined with proper dependencies
- [ ] route_registry runs before service_relations
- [ ] Config allows specifying repo paths
- [ ] `dagster dev` starts without errors
- [ ] Jobs can be triggered from UI
- [ ] Asset outputs are typed dataclasses

## Estimated Time

45 minutes
