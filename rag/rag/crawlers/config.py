"""ConfigCrawler: Configuration file crawler.

Walks a repository and finds config files like go.mod, package.json,
appsettings.json, .env templates. Uses whole-file chunking.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterator

from rag.config import SOURCE_TYPES
from rag.models.chunk import RawChunk, make_chunk_id
from rag.models.types import CrawlSource


# Mapping of filename patterns to corpus types
# None means skip the file
CONFIG_PATTERNS: dict[str, str | None] = {
    "go.mod": "CODE_CONFIG",
    "go.sum": None,  # Skip - too large and noisy
    "package.json": "CODE_CONFIG",
    "package-lock.json": None,  # Skip - lockfile
    "yarn.lock": None,  # Skip - lockfile
    "pnpm-lock.yaml": None,  # Skip - lockfile
    "appsettings.json": "CODE_CONFIG",
    "appsettings.development.json": "CODE_CONFIG",
    "appsettings.production.json": "CODE_CONFIG",
    ".env.example": "CODE_CONFIG",
    ".env.template": "CODE_CONFIG",
    ".env.sample": "CODE_CONFIG",
    ".env": None,  # Skip - may contain secrets
    ".env.local": None,  # Skip - may contain secrets
    ".env.production": None,  # Skip - may contain secrets
    "dockerfile": "CODE_DEPLOY",
    "docker-compose.yml": "CODE_DEPLOY",
    "docker-compose.yaml": "CODE_DEPLOY",
    "compose.yml": "CODE_DEPLOY",
    "compose.yaml": "CODE_DEPLOY",
    "pyproject.toml": "CODE_CONFIG",
    "requirements.txt": "CODE_CONFIG",
    "setup.py": "CODE_CONFIG",
    "setup.cfg": "CODE_CONFIG",
    "cargo.toml": "CODE_CONFIG",
    "cargo.lock": None,  # Skip - lockfile
    "gemfile": "CODE_CONFIG",
    "gemfile.lock": None,  # Skip - lockfile
    "makefile": "CODE_CONFIG",
    "cmakelists.txt": "CODE_CONFIG",
    "tsconfig.json": "CODE_CONFIG",
    "jsconfig.json": "CODE_CONFIG",
    ".eslintrc.json": "CODE_CONFIG",
    ".prettierrc": "CODE_CONFIG",
    ".prettierrc.json": "CODE_CONFIG",
    "biome.json": "CODE_CONFIG",
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
    ".venv",
    "venv",
    ".tox",
}


def _get_corpus_type(file_path: Path) -> str | None:
    """Get corpus type for a config file based on its name.

    Args:
        file_path: Path to the file

    Returns:
        Corpus type string or None if file should be skipped
    """
    # Check exact filename match (case-insensitive)
    filename_lower = file_path.name.lower()
    if filename_lower in CONFIG_PATTERNS:
        return CONFIG_PATTERNS[filename_lower]

    # Check for appsettings variants
    if filename_lower.startswith("appsettings.") and filename_lower.endswith(".json"):
        return "CODE_CONFIG"

    # Check for .env variants
    if filename_lower.startswith(".env."):
        # Skip anything that looks like a real env file
        if any(
            s in filename_lower
            for s in [".local", ".production", ".staging", ".secret"]
        ):
            return None
        # Template-like env files are ok
        if any(s in filename_lower for s in [".example", ".template", ".sample"]):
            return "CODE_CONFIG"
        return None

    return None


class ConfigCrawler:
    """Walks a repo, finds config files, yields RawChunks.

    Uses whole-file chunking since config files are typically small.
    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"CODE_CONFIG", "CODE_DEPLOY"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from config files.

        Args:
            source: CrawlSource with path to repository or directory

        Yields:
            RawChunk for each config file found
        """
        for file_path in self._walk_config_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_config_files(self, root: Path) -> Iterator[Path]:
        """Walk directory tree and yield config files.

        Skips directories in SKIP_DIRS and lockfiles/secret files.
        """
        if not root.is_dir():
            # Single file mode
            if _get_corpus_type(root) is not None:
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_config_files(entry)
            elif entry.is_file():
                corpus_type = _get_corpus_type(entry)
                if corpus_type is not None:
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a single config file and yield a chunk.

        Uses whole-file chunking.

        Args:
            file_path: Path to config file
            source: CrawlSource for repo info

        Yields:
            RawChunk for the config file
        """
        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            return

        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            return

        # Get relative path for source_uri
        if source.path.is_file():
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                relative_path = str(file_path)

        # Get corpus type
        corpus_type = _get_corpus_type(file_path)
        if corpus_type is None:
            return

        source_type = SOURCE_TYPES[corpus_type]

        # Get git hash
        repo_root = source.path.parent if source.path.is_file() else source.path
        git_hash = self._get_file_hash(repo_root, file_path)

        # Whole-file chunk
        yield RawChunk(
            id=make_chunk_id(relative_path, 0, len(content)),
            source_uri=relative_path,
            byte_range=(0, len(content)),
            source_type=source_type,
            text=text,
            context_prefix=relative_path,
            repo_name=source.repo_name,
            file_path=relative_path,
            git_hash=git_hash,
            symbol_name=file_path.name,
            symbol_kind="config",
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
