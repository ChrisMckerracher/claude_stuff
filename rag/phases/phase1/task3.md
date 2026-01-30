# Task 1.3: Markdown Chunker

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create a chunker that splits markdown at heading boundaries, preserving document structure.

## File

`rag/chunking/md_chunker.py`

## Implementation

```python
import re
from typing import Iterator
from dataclasses import dataclass
from rag.core.types import RawChunk, ChunkID, CorpusType
from rag.core.protocols import Chunker
from rag.chunking.token_counter import TokenCounter
from rag.config import MAX_CHUNK_TOKENS

@dataclass
class Section:
    """A markdown section with heading and content."""
    heading: str
    level: int
    content: str
    start_byte: int
    end_byte: int


class MarkdownChunker:
    """Chunk markdown at heading boundaries.

    Preserves document structure by splitting at headings.
    Keeps code blocks intact when possible.
    """

    HEADING_PATTERN = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = MAX_CHUNK_TOKENS,
    ):
        self._counter = token_counter
        self._max = max_tokens

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks at heading boundaries.

        Args:
            content: Markdown content as bytes
            source_uri: File path or identifier
            language: Ignored for markdown

        Yields:
            RawChunk objects, one per section or split segment
        """
        text = content.decode("utf-8", errors="replace")
        sections = self._split_by_headings(text)

        for section in sections:
            if self._counter.count(section.content) <= self._max:
                yield self._make_chunk(section, source_uri)
            else:
                yield from self._split_large_section(section, source_uri)

    def _split_by_headings(self, text: str) -> list[Section]:
        """Split markdown into sections by headings."""
        sections = []
        current_pos = 0

        matches = list(self.HEADING_PATTERN.finditer(text))

        if not matches:
            # No headings - treat entire doc as one section
            return [Section(
                heading="",
                level=0,
                content=text,
                start_byte=0,
                end_byte=len(text.encode()),
            )]

        # Content before first heading
        if matches[0].start() > 0:
            preamble = text[:matches[0].start()].strip()
            if preamble:
                sections.append(Section(
                    heading="(preamble)",
                    level=0,
                    content=preamble,
                    start_byte=0,
                    end_byte=len(preamble.encode()),
                ))

        # Process each heading section
        for i, match in enumerate(matches):
            heading = match.group(2)
            level = len(match.group(1))

            # Content ends at next heading or end of document
            if i + 1 < len(matches):
                end = matches[i + 1].start()
            else:
                end = len(text)

            content = text[match.start():end].strip()
            sections.append(Section(
                heading=heading,
                level=level,
                content=content,
                start_byte=len(text[:match.start()].encode()),
                end_byte=len(text[:end].encode()),
            ))

        return sections

    def _make_chunk(self, section: Section, uri: str) -> RawChunk:
        """Create RawChunk from markdown section."""
        # Determine corpus type
        if "README" in uri.upper():
            corpus_type = CorpusType.DOC_README
        else:
            corpus_type = CorpusType.DOC_DESIGN

        return RawChunk(
            id=ChunkID.from_content(uri, section.start_byte, section.end_byte),
            text=section.content,
            source_uri=uri,
            corpus_type=corpus_type,
            byte_range=(section.start_byte, section.end_byte),
            metadata={
                "heading": section.heading,
                "heading_level": section.level,
            },
        )

    def _split_large_section(
        self,
        section: Section,
        uri: str,
    ) -> Iterator[RawChunk]:
        """Split large section, preserving code blocks."""
        # Try to split at paragraph boundaries first
        paragraphs = re.split(r'\n\n+', section.content)

        current_chunk = []
        current_tokens = 0
        chunk_start = section.start_byte

        for para in paragraphs:
            para_tokens = self._counter.count(para)

            # Check if this paragraph is a code block
            is_code_block = para.strip().startswith('```')

            if current_tokens + para_tokens > self._max and current_chunk:
                # Yield current chunk
                chunk_text = '\n\n'.join(current_chunk)
                yield RawChunk(
                    id=ChunkID.from_content(uri, chunk_start, chunk_start + len(chunk_text.encode())),
                    text=chunk_text,
                    source_uri=uri,
                    corpus_type=CorpusType.DOC_DESIGN,
                    byte_range=(chunk_start, chunk_start + len(chunk_text.encode())),
                    metadata={
                        "heading": section.heading,
                        "heading_level": section.level,
                        "is_partial": True,
                    },
                )
                chunk_start += len(chunk_text.encode()) + 2  # +2 for \n\n
                current_chunk = []
                current_tokens = 0

            # If code block is too large, split it
            if is_code_block and para_tokens > self._max:
                yield from self._split_code_block(para, uri, chunk_start, section)
            else:
                current_chunk.append(para)
                current_tokens += para_tokens

        # Yield final chunk
        if current_chunk:
            chunk_text = '\n\n'.join(current_chunk)
            yield RawChunk(
                id=ChunkID.from_content(uri, chunk_start, section.end_byte),
                text=chunk_text,
                source_uri=uri,
                corpus_type=CorpusType.DOC_DESIGN,
                byte_range=(chunk_start, section.end_byte),
                metadata={
                    "heading": section.heading,
                    "heading_level": section.level,
                },
            )

    def _split_code_block(
        self,
        code_block: str,
        uri: str,
        start_byte: int,
        section: Section,
    ) -> Iterator[RawChunk]:
        """Split a large code block by lines."""
        lines = code_block.split('\n')
        # ... similar line-based splitting logic ...
```

## Acceptance Criteria

- [ ] Implements Chunker protocol
- [ ] Splits at heading boundaries
- [ ] Preserves code blocks when possible
- [ ] Handles documents without headings
- [ ] Splits large sections at paragraph boundaries
- [ ] No chunk exceeds max_tokens
- [ ] Correctly identifies DOC_README vs DOC_DESIGN

## Dependencies

- Task 1.1 (Token Counter)

## Estimated Time

30 minutes
