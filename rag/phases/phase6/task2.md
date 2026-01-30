# Task 6.2: Docs Crawler

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement a crawler for markdown documentation files.

## File

`rag/crawlers/docs.py`

## Implementation

```python
from pathlib import Path
from typing import Iterator
from rag.core.types import CrawlSource, CrawlResult
from rag.core.protocols import Crawler

class DocsCrawler:
    """Crawl directories for markdown documentation.

    Finds all .md and .mdx files, excluding common non-doc directories.
    """

    SUPPORTED_EXTENSIONS = {".md", ".mdx", ".rst", ".txt"}

    # Directories to skip
    SKIP_DIRS = {
        "node_modules",
        ".git",
        "vendor",
        "dist",
        "build",
        "__pycache__",
    }

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield documentation files from source.

        Args:
            source: CrawlSource specifying directory to crawl

        Yields:
            CrawlResult for each documentation file found
        """
        root = Path(source.path)

        for path in root.rglob("*"):
            # Skip directories
            if path.is_dir():
                continue

            # Check if in skip directory
            if any(skip in path.parts for skip in self.SKIP_DIRS):
                continue

            # Check extension
            if path.suffix.lower() not in self.SUPPORTED_EXTENSIONS:
                continue

            try:
                content = path.read_bytes()
                rel_path = path.relative_to(root)

                yield CrawlResult(
                    content=content,
                    source_uri=str(path),
                    language=None,  # Docs don't have a programming language
                    metadata={
                        **source.metadata,
                        "directory": source.path,
                        "relative_path": str(rel_path),
                        "is_readme": path.stem.lower() == "readme",
                        "extension": path.suffix.lower(),
                    },
                )
            except Exception:
                # Skip files that can't be read
                continue


class WebDocsCrawler:
    """Crawl web documentation (future implementation).

    Placeholder for crawling online documentation.
    """

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Crawl web documentation.

        Args:
            source: CrawlSource with type="web_docs" and path=URL

        Yields:
            CrawlResult for each page crawled
        """
        # Future: Implement web crawling with rate limiting
        raise NotImplementedError("Web docs crawling not yet implemented")
```

## Tests

```python
def test_finds_markdown_files(tmp_path):
    (tmp_path / "README.md").write_text("# Hello")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "guide.md").write_text("# Guide")
    (tmp_path / "main.py").write_text("code")  # Should be ignored

    crawler = DocsCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert len(results) == 2
    extensions = {r.metadata["extension"] for r in results}
    assert extensions == {".md"}

def test_marks_readme_files(tmp_path):
    (tmp_path / "README.md").write_text("# Main readme")
    (tmp_path / "guide.md").write_text("# Guide")

    crawler = DocsCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    readme = next(r for r in results if "readme" in r.source_uri.lower())
    guide = next(r for r in results if "guide" in r.source_uri.lower())

    assert readme.metadata["is_readme"] == True
    assert guide.metadata["is_readme"] == False

def test_skips_node_modules(tmp_path):
    (tmp_path / "README.md").write_text("main")
    nm = tmp_path / "node_modules"
    nm.mkdir()
    (nm / "dep.md").write_text("dep readme")

    crawler = DocsCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert len(results) == 1

def test_finds_nested_docs(tmp_path):
    (tmp_path / "docs" / "api" / "v1").mkdir(parents=True)
    (tmp_path / "docs" / "api" / "v1" / "reference.md").write_text("# API")

    crawler = DocsCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert len(results) == 1
    assert "v1" in results[0].source_uri
```

## Acceptance Criteria

- [ ] Implements Crawler protocol
- [ ] Finds .md, .mdx, .rst, .txt files
- [ ] Skips node_modules, .git, etc.
- [ ] Marks README files in metadata
- [ ] Traverses nested directories
- [ ] language field is None for docs

## Estimated Time

20 minutes
