"""Documentation crawlers: Markdown files, runbooks, ADRs, Google Docs.

Finds markdown files and classifies them by path into appropriate
corpus types (DOC_README, DOC_RUNBOOK, DOC_ADR, DOC_GOOGLE).
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Iterator

from rag.chunking.md_chunker import markdown_chunk
from rag.config import SOURCE_TYPES
from rag.models.chunk import RawChunk, make_chunk_id
from rag.models.types import CrawlSource, SourceKind


# Rules for classifying doc type based on path
# Checked in order, first match wins
DOC_TYPE_RULES: list[tuple[str, str]] = [
    (r"runbook", "DOC_RUNBOOK"),
    (r"adr|decision", "DOC_ADR"),
    (r"readme|docs/", "DOC_README"),
]

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
    ".venv",
    "venv",
    ".tox",
}


def _classify_doc_type(file_path: str) -> str:
    """Classify a markdown file into a corpus type based on its path.

    Args:
        file_path: Relative path to the markdown file

    Returns:
        Corpus type string (DOC_README, DOC_RUNBOOK, DOC_ADR)
    """
    path_lower = file_path.lower()

    for pattern, corpus_type in DOC_TYPE_RULES:
        if re.search(pattern, path_lower):
            return corpus_type

    # Default to DOC_README
    return "DOC_README"


class DocsCrawler:
    """Walks a repo, finds markdown files, yields RawChunks.

    Classifies docs by path into DOC_README, DOC_RUNBOOK, or DOC_ADR.
    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"DOC_README", "DOC_RUNBOOK", "DOC_ADR"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from markdown files.

        Args:
            source: CrawlSource with path to repository or directory

        Yields:
            RawChunk for each markdown section found
        """
        for file_path in self._walk_markdown_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_markdown_files(self, root: Path) -> Iterator[Path]:
        """Walk directory tree and yield markdown files."""
        if not root.is_dir():
            # Single file mode
            if root.suffix.lower() in (".md", ".markdown"):
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_markdown_files(entry)
            elif entry.is_file():
                if entry.suffix.lower() in (".md", ".markdown"):
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a single markdown file and yield chunks.

        Args:
            file_path: Path to markdown file
            source: CrawlSource for repo info

        Yields:
            RawChunk for each section in the file
        """
        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            return

        # Get relative path for source_uri
        if source.path.is_file():
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                relative_path = str(file_path)

        # Classify doc type using full file path for better classification
        # This ensures that docs/runbooks/deploy.md gets classified as runbook
        # even when crawling from the runbooks directory
        corpus_type = _classify_doc_type(str(file_path))
        source_type = SOURCE_TYPES[corpus_type]

        # Chunk the markdown
        chunks = markdown_chunk(content, relative_path)

        # Get git hash
        repo_root = source.path.parent if source.path.is_file() else source.path
        git_hash = self._get_file_hash(repo_root, file_path)

        for chunk_data in chunks:
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
                file_path=relative_path,
                git_hash=git_hash,
                section_path=chunk_data.section_path,
            )

    def _get_file_hash(self, repo_root: Path, file_path: Path) -> str | None:
        """Get git blob hash for a file."""
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


class RunbookCrawler:
    """Crawls a standalone runbook directory (outside repos).

    All files are classified as DOC_RUNBOOK.
    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"DOC_RUNBOOK"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from runbook files.

        Args:
            source: CrawlSource with path to runbook directory

        Yields:
            RawChunk for each markdown section found
        """
        if source.source_kind != SourceKind.RUNBOOK_DIR:
            return

        for file_path in self._walk_markdown_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_markdown_files(self, root: Path) -> Iterator[Path]:
        """Walk directory tree and yield markdown files."""
        if not root.is_dir():
            if root.suffix.lower() in (".md", ".markdown"):
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_markdown_files(entry)
            elif entry.is_file():
                if entry.suffix.lower() in (".md", ".markdown"):
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a runbook file and yield chunks."""
        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            return

        # Get relative path
        if source.path.is_file():
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                relative_path = str(file_path)

        source_type = SOURCE_TYPES["DOC_RUNBOOK"]
        chunks = markdown_chunk(content, relative_path)

        for chunk_data in chunks:
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
                file_path=relative_path,
                section_path=chunk_data.section_path,
            )


class GoogleDocsCrawler:
    """Crawls exported Google Docs (markdown or HTML format).

    All files are classified as DOC_GOOGLE (SENSITIVE).
    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"DOC_GOOGLE"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from Google Docs exports.

        Args:
            source: CrawlSource with path to Google Docs directory

        Yields:
            RawChunk for each section found
        """
        if source.source_kind != SourceKind.GOOGLE_DOCS_DIR:
            return

        for file_path in self._walk_doc_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_doc_files(self, root: Path) -> Iterator[Path]:
        """Walk directory and yield markdown/HTML files."""
        if not root.is_dir():
            if root.suffix.lower() in (".md", ".markdown", ".html"):
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_doc_files(entry)
            elif entry.is_file():
                if entry.suffix.lower() in (".md", ".markdown", ".html"):
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a Google Docs export and yield chunks.

        Note: HTML files are treated as markdown for now. A more
        sophisticated implementation would convert HTML to markdown first.
        """
        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            return

        # Get relative path
        if source.path.is_file():
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                relative_path = str(file_path)

        source_type = SOURCE_TYPES["DOC_GOOGLE"]

        # For HTML, we'd ideally convert to markdown first
        # For now, treat as markdown (heading-based chunking still works somewhat)
        chunks = markdown_chunk(content, relative_path)

        for chunk_data in chunks:
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
                file_path=relative_path,
                section_path=chunk_data.section_path,
            )
