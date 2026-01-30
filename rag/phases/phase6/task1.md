# Task 6.1: Code Crawler

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement a code crawler that traverses git repositories and directories, respecting .gitignore.

## File

`rag/crawlers/code.py`

## Implementation

```python
from pathlib import Path
from typing import Iterator
import git
from rag.core.types import CrawlSource, CrawlResult
from rag.core.protocols import Crawler

class CodeCrawler:
    """Crawl git repositories and directories for source code.

    Respects .gitignore patterns and filters by file extension.
    """

    SUPPORTED_EXTENSIONS = {
        ".py": "python",
        ".go": "go",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".js": "javascript",
        ".jsx": "javascript",
        ".cs": "csharp",
        ".java": "java",
        ".rs": "rust",
        ".rb": "ruby",
    }

    # Directories to always skip
    SKIP_DIRS = {
        "__pycache__",
        "node_modules",
        ".git",
        ".venv",
        "venv",
        "dist",
        "build",
        ".tox",
        ".pytest_cache",
        ".mypy_cache",
    }

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield code files from source.

        Args:
            source: CrawlSource specifying what to crawl

        Yields:
            CrawlResult for each code file found
        """
        if source.type == "git_repo":
            yield from self._crawl_git_repo(source.path, source.metadata)
        elif source.type == "directory":
            yield from self._crawl_directory(source.path, source.metadata)

    def _crawl_git_repo(
        self,
        repo_path: str,
        metadata: dict,
    ) -> Iterator[CrawlResult]:
        """Crawl a git repository, respecting .gitignore."""
        try:
            repo = git.Repo(repo_path)
        except git.InvalidGitRepositoryError:
            # Fall back to directory crawling
            yield from self._crawl_directory(repo_path, metadata)
            return

        # Use git ls-files to get tracked files (respects .gitignore)
        tracked_files = repo.git.ls_files().split('\n')

        for rel_path in tracked_files:
            if not rel_path:
                continue

            full_path = Path(repo_path) / rel_path
            if not full_path.is_file():
                continue

            ext = full_path.suffix.lower()
            if ext not in self.SUPPORTED_EXTENSIONS:
                continue

            try:
                content = full_path.read_bytes()
                yield CrawlResult(
                    content=content,
                    source_uri=str(full_path),
                    language=self.SUPPORTED_EXTENSIONS.get(ext),
                    metadata={
                        **metadata,
                        "repo": repo_path,
                        "relative_path": rel_path,
                        "extension": ext,
                    },
                )
            except Exception:
                # Skip files that can't be read
                continue

    def _crawl_directory(
        self,
        dir_path: str,
        metadata: dict,
    ) -> Iterator[CrawlResult]:
        """Crawl a directory without git."""
        root = Path(dir_path)

        for path in root.rglob("*"):
            # Skip directories
            if path.is_dir():
                continue

            # Check if in skip directory
            if any(skip in path.parts for skip in self.SKIP_DIRS):
                continue

            ext = path.suffix.lower()
            if ext not in self.SUPPORTED_EXTENSIONS:
                continue

            try:
                content = path.read_bytes()
                rel_path = path.relative_to(root)
                yield CrawlResult(
                    content=content,
                    source_uri=str(path),
                    language=self.SUPPORTED_EXTENSIONS.get(ext),
                    metadata={
                        **metadata,
                        "directory": dir_path,
                        "relative_path": str(rel_path),
                        "extension": ext,
                    },
                )
            except Exception:
                continue

    def _detect_language(self, path: Path) -> str | None:
        """Detect programming language from file extension."""
        return self.SUPPORTED_EXTENSIONS.get(path.suffix.lower())
```

## Tests

```python
def test_crawls_python_files(tmp_path):
    # Create test files
    (tmp_path / "main.py").write_text("print('hello')")
    (tmp_path / "test.js").write_text("console.log('hi')")
    (tmp_path / "readme.txt").write_text("ignored")

    crawler = CodeCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert len(results) == 2  # .py and .js
    extensions = {r.metadata["extension"] for r in results}
    assert extensions == {".py", ".js"}

def test_respects_gitignore(tmp_path):
    # Create git repo
    repo = git.Repo.init(tmp_path)
    (tmp_path / ".gitignore").write_text("ignored.py\n")
    (tmp_path / "tracked.py").write_text("tracked")
    (tmp_path / "ignored.py").write_text("ignored")
    repo.index.add(["tracked.py", ".gitignore"])
    repo.index.commit("initial")

    crawler = CodeCrawler()
    results = list(crawler.crawl(CrawlSource("git_repo", str(tmp_path), {})))

    files = {Path(r.source_uri).name for r in results}
    assert "tracked.py" in files
    assert "ignored.py" not in files

def test_skips_node_modules(tmp_path):
    (tmp_path / "main.py").write_text("main")
    nm = tmp_path / "node_modules"
    nm.mkdir()
    (nm / "dep.js").write_text("dep")

    crawler = CodeCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert len(results) == 1
    assert results[0].metadata["extension"] == ".py"

def test_detects_language(tmp_path):
    (tmp_path / "main.py").write_text("python")
    (tmp_path / "main.go").write_text("golang")
    (tmp_path / "main.ts").write_text("typescript")

    crawler = CodeCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    languages = {r.language for r in results}
    assert languages == {"python", "go", "typescript"}
```

## Acceptance Criteria

- [ ] Implements Crawler protocol
- [ ] Crawls git repos using ls-files (respects .gitignore)
- [ ] Falls back to directory crawling for non-git directories
- [ ] Skips __pycache__, node_modules, etc.
- [ ] Detects language from file extension
- [ ] Handles read errors gracefully

## Estimated Time

30 minutes
