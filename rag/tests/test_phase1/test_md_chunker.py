"""Tests for MarkdownChunker."""

import pytest

from rag.chunking.md_chunker import MarkdownChunker
from rag.chunking.token_counter import TokenCounter
from rag.core.types import CorpusType


@pytest.fixture
def counter() -> TokenCounter:
    """Create a TokenCounter instance."""
    return TokenCounter()


@pytest.fixture
def chunker(counter: TokenCounter) -> MarkdownChunker:
    """Create a MarkdownChunker instance."""
    return MarkdownChunker(counter)


class TestMarkdownChunker:
    """Markdown chunking tests."""

    def test_chunk_at_heading_boundaries(self, chunker: MarkdownChunker) -> None:
        """Chunk at heading boundaries."""
        md = b"""# Introduction
Welcome to the docs.

# Installation
Run pip install.

# Usage
Import and use.
"""
        chunks = list(chunker.chunk(md, source_uri="docs/guide.md"))
        assert len(chunks) == 3
        assert chunks[0].metadata["heading"] == "Introduction"
        assert chunks[1].metadata["heading"] == "Installation"
        assert chunks[2].metadata["heading"] == "Usage"

    def test_handle_nested_headings(self, chunker: MarkdownChunker) -> None:
        """Handle nested headings."""
        md = b"""# Main Section
Overview.

## Subsection A
Details A.

## Subsection B
Details B.
"""
        chunks = list(chunker.chunk(md, source_uri="docs/guide.md"))
        assert len(chunks) == 3
        assert chunks[0].metadata["heading_level"] == 1
        assert chunks[1].metadata["heading_level"] == 2
        assert chunks[2].metadata["heading_level"] == 2

    def test_preserve_code_blocks(self, chunker: MarkdownChunker) -> None:
        """Preserve code blocks in single chunk when possible."""
        md = b"""# Example

Here's code:

```python
def foo():
    return 42
```

That's it.
"""
        chunks = list(chunker.chunk(md, source_uri="docs/example.md"))
        # Code block should be in one chunk
        code_block_found = False
        for chunk in chunks:
            if "```python" in chunk.text and "```" in chunk.text[chunk.text.index("```python") + 10:]:
                code_block_found = True
        assert code_block_found

    def test_handle_document_without_headings(self, chunker: MarkdownChunker) -> None:
        """Handle documents without headings."""
        md = b"""This is just plain text.
No headings here.
"""
        chunks = list(chunker.chunk(md, source_uri="docs/plain.md"))
        assert len(chunks) == 1
        assert "plain text" in chunks[0].text

    def test_identify_readme_files(self, chunker: MarkdownChunker) -> None:
        """README files get DOC_README corpus type."""
        md = b"# README\nWelcome."
        chunks = list(chunker.chunk(md, source_uri="README.md"))
        assert chunks[0].corpus_type == CorpusType.DOC_README

    def test_identify_design_docs(self, chunker: MarkdownChunker) -> None:
        """Other docs get DOC_DESIGN corpus type."""
        md = b"# Design\nArchitecture."
        chunks = list(chunker.chunk(md, source_uri="docs/design.md"))
        assert chunks[0].corpus_type == CorpusType.DOC_DESIGN

    def test_split_large_section(self, counter: TokenCounter) -> None:
        """Split large sections at paragraph boundaries."""
        chunker = MarkdownChunker(counter, max_tokens=50)

        # Create a section with many paragraphs
        paragraphs = ["# Large Section"]
        for i in range(20):
            paragraphs.append(f"This is paragraph {i} with some content that takes up tokens.")

        md = "\n\n".join(paragraphs).encode()
        chunks = list(chunker.chunk(md, source_uri="docs/large.md"))
        assert len(chunks) > 1

        # Each chunk should respect max tokens (with some tolerance)
        for chunk in chunks:
            token_count = counter.count(chunk.text)
            assert token_count <= 50 + 20  # Allow buffer

    def test_preamble_content(self, chunker: MarkdownChunker) -> None:
        """Content before first heading is captured."""
        md = b"""This is a preamble.

# First Section
Content here.
"""
        chunks = list(chunker.chunk(md, source_uri="docs/with-preamble.md"))
        assert len(chunks) == 2
        assert chunks[0].metadata["heading"] == "(preamble)"
        assert "preamble" in chunks[0].text
