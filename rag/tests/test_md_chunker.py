"""Tests for Markdown chunker."""

from pathlib import Path

import pytest

from rag.chunking.md_chunker import markdown_chunk, MarkdownChunkData


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestHeadingSplit:
    """Test heading-based splitting."""

    def test_heading_split(self) -> None:
        """Markdown is split at heading boundaries."""
        md_path = FIXTURES_DIR / "docs" / "runbooks" / "deploy-rollback.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "deploy-rollback.md")

        # Should have multiple chunks for different sections
        assert len(chunks) >= 3  # At least H1, Deploy, Rollback sections

    def test_all_chunks_are_dataclass(self) -> None:
        """All chunks are MarkdownChunkData instances."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "README.md")

        for chunk in chunks:
            assert isinstance(chunk, MarkdownChunkData)


class TestSectionPath:
    """Test section path generation."""

    def test_section_path_format(self) -> None:
        """Section path captures heading hierarchy."""
        md_path = FIXTURES_DIR / "docs" / "runbooks" / "deploy-rollback.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "deploy-rollback.md")

        # Find a chunk with nested heading
        section_paths = [c.section_path for c in chunks if c.section_path]

        # Should have some section paths with hierarchy
        assert any(">" in path for path in section_paths)

    def test_nested_headings(self) -> None:
        """H1 > H2 > H3 hierarchy is preserved."""
        content = b"""# Top Level

Some intro text.

## Second Level

More text here.

### Third Level

Deep content.
"""
        chunks = markdown_chunk(content, "test.md")

        # Find the third level chunk
        third_level = [c for c in chunks if "Third Level" in c.text]
        assert len(third_level) >= 1

        # Its section path should include the hierarchy
        section_path = third_level[0].section_path
        assert "# Top Level" in section_path or "Top Level" in section_path


class TestOversizedSections:
    """Test splitting of oversized sections."""

    def test_oversized_section(self) -> None:
        """Section exceeding 2048 tokens is split on paragraphs."""
        # Create content with a very long section
        long_para = "This is a word. " * 500  # ~2000 words
        content = f"""# Title

{long_para}

Another paragraph here.

{long_para}
""".encode("utf-8")

        chunks = markdown_chunk(content, "long.md")

        # Should be split into multiple chunks
        assert len(chunks) >= 2


class TestCodeBlocks:
    """Test code block handling."""

    def test_code_blocks_preserved(self) -> None:
        """Code blocks inside markdown are kept intact."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "README.md")

        # Find chunks with code blocks
        code_chunks = [c for c in chunks if "```" in c.text]

        # Code blocks should be present
        assert len(code_chunks) >= 1


class TestEmptySections:
    """Test handling of empty sections."""

    def test_empty_sections_skipped(self) -> None:
        """Heading with no content produces no chunk."""
        content = b"""# Title

## Empty Section

## Section with Content

This has content.
"""
        chunks = markdown_chunk(content, "test.md")

        # Empty section should be skipped or minimal
        texts = [c.text.strip() for c in chunks]
        # Should not have a chunk that's just the empty section heading
        assert not any(t == "## Empty Section" for t in texts)


class TestContextPrefix:
    """Test context prefix generation."""

    def test_context_prefix_includes_file(self) -> None:
        """Context prefix includes the file path."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "docs/README.md")

        for chunk in chunks:
            assert "docs/README.md" in chunk.context_prefix


class TestByteRanges:
    """Test byte range calculation."""

    def test_byte_ranges_valid(self) -> None:
        """Byte ranges are valid and non-negative."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "README.md")

        for chunk in chunks:
            assert chunk.byte_start >= 0
            assert chunk.byte_end > chunk.byte_start

    def test_chunks_not_empty(self) -> None:
        """No chunk has empty text."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "README.md")

        for chunk in chunks:
            assert chunk.text.strip()


class TestSpecialContent:
    """Test handling of special markdown content."""

    def test_handles_lists(self) -> None:
        """Lists are properly included in chunks."""
        md_path = FIXTURES_DIR / "docs" / "README.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "README.md")

        # Find chunks with lists (containing -)
        list_chunks = [c for c in chunks if "- " in c.text]
        assert len(list_chunks) >= 1

    def test_handles_adr(self) -> None:
        """ADR document is properly chunked."""
        md_path = FIXTURES_DIR / "docs" / "adr" / "001-auth-service.md"
        content = md_path.read_bytes()

        chunks = markdown_chunk(content, "001-auth-service.md")

        # Should have multiple sections
        assert len(chunks) >= 3

        # Should have key ADR sections
        texts = " ".join(c.text for c in chunks)
        assert "Status" in texts
        assert "Context" in texts
        assert "Decision" in texts
