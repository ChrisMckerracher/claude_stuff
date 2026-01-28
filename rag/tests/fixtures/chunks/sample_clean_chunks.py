"""Factory functions for creating test CleanChunks and EmbeddedChunks.

These allow tests to create realistic chunks without needing actual
crawlers or scrubbers.
"""

from __future__ import annotations

import random
from typing import Any

from rag.config import SOURCE_TYPES
from rag.models.chunk import CleanChunk, EmbeddedChunk, make_chunk_id
from rag.indexing.embedder import CodeRankEmbedder


def make_code_chunk(
    text: str,
    *,
    source_uri: str = "repo://test-repo/src/handler.go",
    byte_start: int = 0,
    repo_name: str = "test-repo",
    language: str = "go",
    service_name: str = "auth-service",
    symbol_name: str = "HandleRequest",
    symbol_kind: str = "function",
    signature: str = "func HandleRequest(w http.ResponseWriter, r *http.Request)",
    file_path: str = "src/handler.go",
    git_hash: str = "abc1234",
    imports: list[str] | None = None,
    calls_out: list[str] | None = None,
    called_by: list[str] | None = None,
    **kwargs: Any,
) -> CleanChunk:
    """Factory for CODE_LOGIC CleanChunks.

    Args:
        text: The chunk text content.
        source_uri: URI of the source file.
        byte_start: Starting byte offset.
        repo_name: Name of the repository.
        language: Programming language.
        service_name: Name of the owning service.
        symbol_name: Name of the symbol (function/class/etc).
        symbol_kind: Kind of symbol.
        signature: Function/method signature.
        file_path: Path within the repository.
        git_hash: Git commit hash.
        imports: List of imports.
        calls_out: List of outbound service calls.
        called_by: List of inbound callers.
        **kwargs: Additional fields to override.

    Returns:
        A CleanChunk with CODE_LOGIC source type.
    """
    byte_end = byte_start + len(text)
    chunk_id = make_chunk_id(source_uri, byte_start, byte_end)

    return CleanChunk(
        id=kwargs.get("id", chunk_id),
        source_uri=source_uri,
        byte_range=(byte_start, byte_end),
        source_type=SOURCE_TYPES["CODE_LOGIC"],
        text=text,
        context_prefix=kwargs.get(
            "context_prefix",
            f"// {repo_name}/{file_path}\n// {symbol_kind}: {symbol_name}",
        ),
        repo_name=repo_name,
        audit=None,
        language=language,
        symbol_name=symbol_name,
        symbol_kind=symbol_kind,
        signature=signature,
        file_path=file_path,
        git_hash=git_hash,
        imports=imports or [],
        calls_out=calls_out or [],
        called_by=called_by or [],
        service_name=service_name,
    )


def make_deploy_chunk(
    text: str,
    *,
    source_uri: str = "repo://test-repo/k8s/deployment.yaml",
    byte_start: int = 0,
    repo_name: str = "test-repo",
    service_name: str = "auth-service",
    file_path: str = "k8s/deployment.yaml",
    k8s_labels: dict[str, str] | None = None,
    **kwargs: Any,
) -> CleanChunk:
    """Factory for CODE_DEPLOY CleanChunks.

    Args:
        text: The chunk text content.
        source_uri: URI of the source file.
        byte_start: Starting byte offset.
        repo_name: Name of the repository.
        service_name: Name of the service being deployed.
        file_path: Path within the repository.
        k8s_labels: Kubernetes labels.
        **kwargs: Additional fields to override.

    Returns:
        A CleanChunk with CODE_DEPLOY source type.
    """
    byte_end = byte_start + len(text)
    chunk_id = make_chunk_id(source_uri, byte_start, byte_end)

    return CleanChunk(
        id=kwargs.get("id", chunk_id),
        source_uri=source_uri,
        byte_range=(byte_start, byte_end),
        source_type=SOURCE_TYPES["CODE_DEPLOY"],
        text=text,
        context_prefix=kwargs.get(
            "context_prefix",
            f"# {repo_name}/{file_path}\n# Service: {service_name}",
        ),
        repo_name=repo_name,
        audit=None,
        service_name=service_name,
        file_path=file_path,
        k8s_labels=k8s_labels or {"app": service_name},
    )


def make_doc_chunk(
    text: str,
    *,
    source_uri: str = "repo://test-repo/docs/README.md",
    byte_start: int = 0,
    repo_name: str = "test-repo",
    section_path: str = "Getting Started > Installation",
    file_path: str = "docs/README.md",
    corpus_type: str = "DOC_README",
    **kwargs: Any,
) -> CleanChunk:
    """Factory for documentation CleanChunks.

    Args:
        text: The chunk text content.
        source_uri: URI of the source file.
        byte_start: Starting byte offset.
        repo_name: Name of the repository.
        section_path: Markdown section hierarchy.
        file_path: Path within the repository.
        corpus_type: Type of documentation (DOC_README, DOC_RUNBOOK, etc).
        **kwargs: Additional fields to override.

    Returns:
        A CleanChunk with the specified documentation source type.
    """
    byte_end = byte_start + len(text)
    chunk_id = make_chunk_id(source_uri, byte_start, byte_end)

    return CleanChunk(
        id=kwargs.get("id", chunk_id),
        source_uri=source_uri,
        byte_range=(byte_start, byte_end),
        source_type=SOURCE_TYPES[corpus_type],
        text=text,
        context_prefix=kwargs.get(
            "context_prefix",
            f"# {repo_name}/{file_path}\n# Section: {section_path}",
        ),
        repo_name=repo_name,
        audit=None,
        section_path=section_path,
        file_path=file_path,
    )


def make_slack_chunk(
    text: str,
    *,
    source_uri: str = "slack://workspace/C123ABC/thread-456",
    byte_start: int = 0,
    channel: str = "engineering",
    thread_id: str = "thread-456",
    author: str = "[PERSON_1]",
    timestamp: str = "2024-01-15T10:30:00Z",
    **kwargs: Any,
) -> CleanChunk:
    """Factory for CONVO_SLACK CleanChunks.

    Args:
        text: The chunk text content (already scrubbed).
        source_uri: URI of the slack thread.
        byte_start: Starting byte offset.
        channel: Slack channel name.
        thread_id: Thread identifier.
        author: Pseudonymized author name.
        timestamp: Message timestamp.
        **kwargs: Additional fields to override.

    Returns:
        A CleanChunk with CONVO_SLACK source type.
    """
    byte_end = byte_start + len(text)
    chunk_id = make_chunk_id(source_uri, byte_start, byte_end)

    return CleanChunk(
        id=kwargs.get("id", chunk_id),
        source_uri=source_uri,
        byte_range=(byte_start, byte_end),
        source_type=SOURCE_TYPES["CONVO_SLACK"],
        text=text,
        context_prefix=kwargs.get(
            "context_prefix",
            f"# Slack: #{channel}\n# Thread: {thread_id}",
        ),
        repo_name=None,
        audit=kwargs.get("audit"),
        channel=channel,
        thread_id=thread_id,
        author=author,
        timestamp=timestamp,
    )


def make_embedded_chunk(
    chunk: CleanChunk,
    *,
    vector: list[float] | None = None,
) -> EmbeddedChunk:
    """Wrap a CleanChunk with a vector for testing.

    Args:
        chunk: The CleanChunk to embed.
        vector: Optional pre-computed vector. If None, generates a
               deterministic random vector based on the chunk ID.

    Returns:
        An EmbeddedChunk with a 768-dim vector.
    """
    if vector is None:
        # Generate deterministic random vector from chunk ID
        rng = random.Random(chunk.id)
        vector = [rng.gauss(0, 1) for _ in range(CodeRankEmbedder.VECTOR_DIM)]
        # Normalize
        norm = sum(x * x for x in vector) ** 0.5
        vector = [x / norm for x in vector]

    return EmbeddedChunk(chunk=chunk, vector=vector)


def make_batch_chunks(
    count: int,
    *,
    repo_name: str = "test-repo",
    service_name: str = "test-service",
) -> list[CleanChunk]:
    """Generate a batch of diverse test chunks.

    Creates a mix of code, deploy, doc, and slack chunks.

    Args:
        count: Number of chunks to generate.
        repo_name: Repository name for code/deploy/doc chunks.
        service_name: Service name for code/deploy chunks.

    Returns:
        List of diverse CleanChunks.
    """
    chunks: list[CleanChunk] = []

    for i in range(count):
        chunk_type = i % 4

        if chunk_type == 0:
            chunks.append(
                make_code_chunk(
                    f"func Handler{i}() {{\n    // implementation {i}\n}}",
                    source_uri=f"repo://{repo_name}/src/handler_{i}.go",
                    repo_name=repo_name,
                    service_name=service_name,
                    symbol_name=f"Handler{i}",
                )
            )
        elif chunk_type == 1:
            chunks.append(
                make_deploy_chunk(
                    f"apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {service_name}-{i}",
                    source_uri=f"repo://{repo_name}/k8s/deploy_{i}.yaml",
                    repo_name=repo_name,
                    service_name=service_name,
                )
            )
        elif chunk_type == 2:
            chunks.append(
                make_doc_chunk(
                    f"# Section {i}\n\nThis is documentation for feature {i}.",
                    source_uri=f"repo://{repo_name}/docs/section_{i}.md",
                    repo_name=repo_name,
                    section_path=f"Docs > Section {i}",
                )
            )
        else:
            chunks.append(
                make_slack_chunk(
                    f"[PERSON_{i}]: Has anyone seen the issue with component {i}?",
                    source_uri=f"slack://workspace/C123/thread-{i}",
                    thread_id=f"thread-{i}",
                )
            )

    return chunks
