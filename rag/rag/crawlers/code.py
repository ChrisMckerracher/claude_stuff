"""CodeCrawler: Tree-sitter based code file crawler.

Walks a repository, parses source files with tree-sitter,
chunks them by AST structure, and extracts service boundary signals.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterator

from rag.boundary.imports import extract_imports
from rag.boundary.service_calls import detect_service_calls
from rag.chunking.ast_chunker import ast_chunk
from rag.config import SOURCE_TYPES
from rag.models.chunk import RawChunk, make_chunk_id
from rag.models.types import CrawlSource


# Map file extensions to language names
EXTENSION_MAP: dict[str, str] = {
    ".go": "go",
    ".cs": "c_sharp",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
}

# Directories to skip during traversal
SKIP_DIRS: set[str] = {
    "vendor",
    "node_modules",
    ".git",
    "__pycache__",
    "bin",
    "obj",
    "dist",
    "build",
    ".next",
    "generated",
    "proto",
    "mock",
    "mocks",
    ".venv",
    "venv",
    ".tox",
    ".pytest_cache",
    ".mypy_cache",
    "target",
    "packages",
}


class CodeCrawler:
    """Walks a repo, parses code files, yields RawChunks.

    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"CODE_LOGIC"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from the source repository.

        Args:
            source: CrawlSource with path to repository

        Yields:
            RawChunk for each code chunk found
        """
        for file_path in self._walk_code_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_code_files(self, root: Path) -> Iterator[Path]:
        """Walk directory tree and yield code files.

        Skips directories in SKIP_DIRS and only yields files with
        extensions in EXTENSION_MAP.
        """
        if not root.is_dir():
            # If it's a single file, yield it if it's a code file
            if root.suffix in EXTENSION_MAP:
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_code_files(entry)
            elif entry.is_file():
                if entry.suffix in EXTENSION_MAP:
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a single code file and yield chunks.

        Args:
            file_path: Path to code file
            source: CrawlSource for repo info

        Yields:
            RawChunk for each chunk in the file
        """
        language = EXTENSION_MAP.get(file_path.suffix)
        if not language:
            return

        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            # Skip files we can't read
            return

        # Get relative path for source_uri
        if source.path.is_file():
            # Single file mode - use filename
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                # file_path not relative to source.path
                relative_path = str(file_path)

        # Parse and chunk the file
        chunks = ast_chunk(content, language, relative_path)

        # Extract file-level imports
        imports = extract_imports(content, language)

        # Detect service calls
        calls = detect_service_calls(content, language)

        # Get git hash for the file (if in a git repo)
        repo_root = source.path.parent if source.path.is_file() else source.path
        git_hash = self._get_file_hash(repo_root, file_path)

        source_type = SOURCE_TYPES["CODE_LOGIC"]

        for chunk_data in chunks:
            # Find which calls fall within this chunk's byte range
            chunk_calls = [
                c
                for c in calls
                if chunk_data.byte_start <= c.byte_offset < chunk_data.byte_end
            ]

            yield RawChunk(
                id=make_chunk_id(
                    relative_path, chunk_data.byte_start, chunk_data.byte_end
                ),
                source_uri=relative_path,
                byte_range=(chunk_data.byte_start, chunk_data.byte_end),
                source_type=source_type,
                text=chunk_data.text,
                context_prefix=chunk_data.context_prefix,
                repo_name=source.repo_name,
                language=language,
                symbol_name=chunk_data.symbol_name,
                symbol_kind=chunk_data.symbol_kind,
                signature=chunk_data.signature,
                file_path=relative_path,
                git_hash=git_hash,
                imports=imports,
                calls_out=[c.target for c in chunk_calls],
            )

    def _get_file_hash(self, repo_root: Path, file_path: Path) -> str | None:
        """Get git blob hash for a file.

        Returns None if not in a git repo or git command fails.
        """
        try:
            result = subprocess.run(
                ["git", "hash-object", str(file_path)],
                capture_output=True,
                text=True,
                cwd=repo_root,
                timeout=5,
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except (subprocess.SubprocessError, OSError):
            pass
        return None
