"""DeployCrawler: Kubernetes YAML and deployment file crawler.

Walks a repository or directory, finds deployment-related YAML files,
chunks them by document separator (---), and extracts K8s metadata.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Iterator

from rag.chunking.yaml_chunker import yaml_chunk
from rag.config import SOURCE_TYPES
from rag.models.chunk import RawChunk, make_chunk_id
from rag.models.types import CrawlSource


# File patterns that indicate deployment files
DEPLOY_FILE_PATTERNS: set[str] = {
    ".yaml",
    ".yml",
}

# Directory patterns that indicate deployment content
DEPLOY_DIR_PATTERNS: set[str] = {
    "k8s",
    "kubernetes",
    "deploy",
    "deployments",
    "manifests",
    "helm",
    "charts",
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


def _is_k8s_yaml(content: bytes) -> bool:
    """Check if content looks like a Kubernetes YAML file.

    Args:
        content: Raw file content

    Returns:
        True if the file appears to be a K8s manifest
    """
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return False

    # Quick heuristics for K8s manifests
    k8s_indicators = [
        "apiVersion:",
        "kind:",
        "metadata:",
        "spec:",
    ]

    # Need at least 2 indicators to be considered K8s
    count = sum(1 for indicator in k8s_indicators if indicator in text)
    return count >= 2


def _is_in_deploy_dir(file_path: Path, source_root: Path) -> bool:
    """Check if file is in a deployment-related directory.

    Args:
        file_path: Path to the file
        source_root: Root of the source directory

    Returns:
        True if the file is in a deployment directory
    """
    try:
        relative = file_path.relative_to(source_root)
        for part in relative.parts[:-1]:  # Exclude filename
            if part.lower() in DEPLOY_DIR_PATTERNS:
                return True
    except ValueError:
        pass
    return False


class DeployCrawler:
    """Walks a repo, finds K8s/deploy YAMLs, yields RawChunks.

    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"CODE_DEPLOY"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from deployment files.

        Args:
            source: CrawlSource with path to repository or directory

        Yields:
            RawChunk for each YAML document found
        """
        for file_path in self._walk_deploy_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_deploy_files(self, root: Path) -> Iterator[Path]:
        """Walk directory tree and yield deployment-related YAML files.

        Only yields files that:
        1. Have .yaml or .yml extension
        2. Are in a deployment directory OR contain K8s markers
        """
        if not root.is_dir():
            # Single file mode
            if root.suffix.lower() in DEPLOY_FILE_PATTERNS:
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if entry.name not in SKIP_DIRS and not entry.name.startswith("."):
                    yield from self._walk_deploy_files(entry)
            elif entry.is_file():
                if entry.suffix.lower() in DEPLOY_FILE_PATTERNS:
                    # Check if it's in a deploy dir or looks like K8s
                    try:
                        content = entry.read_bytes()
                        is_in_deploy = _is_in_deploy_dir(entry, root)
                        is_k8s = _is_k8s_yaml(content)
                        if is_in_deploy or is_k8s:
                            yield entry
                    except (OSError, IOError):
                        continue

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a single YAML file and yield chunks.

        Args:
            file_path: Path to YAML file
            source: CrawlSource for repo info

        Yields:
            RawChunk for each YAML document in the file
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

        # Chunk the YAML file
        chunks = yaml_chunk(content, relative_path)

        # Get git hash
        repo_root = source.path.parent if source.path.is_file() else source.path
        git_hash = self._get_file_hash(repo_root, file_path)

        source_type = SOURCE_TYPES["CODE_DEPLOY"]

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
                symbol_name=chunk_data.symbol_name,
                symbol_kind=chunk_data.symbol_kind,
                service_name=chunk_data.service_name,
                k8s_labels=chunk_data.k8s_labels,
                calls_out=chunk_data.calls_out,
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
