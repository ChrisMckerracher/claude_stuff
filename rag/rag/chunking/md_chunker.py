"""Markdown chunker for documentation files.

Splits markdown files on heading boundaries (H1, H2, H3) while
preserving section hierarchy in section_path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import mistune


# Maximum tokens per chunk (approximate: whitespace-split count)
MAX_TOKENS = 2048


@dataclass
class MarkdownChunkData:
    """Intermediate output of the markdown chunker.

    The DocsCrawler wraps this into a RawChunk.
    """

    text: str
    byte_start: int
    byte_end: int
    context_prefix: str
    section_path: str


def _count_tokens(text: str) -> int:
    """Approximate token count using whitespace splitting."""
    return len(text.split())


def _extract_headings_and_content(tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract heading structure and content from mistune tokens.

    Args:
        tokens: List of mistune AST tokens

    Returns:
        List of dicts with heading level, text, and content
    """
    sections: list[dict[str, Any]] = []
    current_section: dict[str, Any] | None = None

    def get_text_from_children(children: list[dict[str, Any]] | None) -> str:
        """Recursively extract text from token children."""
        if not children:
            return ""
        parts: list[str] = []
        for child in children:
            if child.get("type") == "text":
                parts.append(child.get("raw", ""))
            elif child.get("type") == "codespan":
                parts.append(child.get("raw", ""))
            elif "children" in child:
                parts.append(get_text_from_children(child["children"]))
        return "".join(parts)

    def token_to_text(token: dict[str, Any]) -> str:
        """Convert a token back to markdown-ish text."""
        t = token.get("type", "")

        if t == "heading":
            attrs = token.get("attrs", {})
            level = int(attrs.get("level", 1)) if isinstance(attrs, dict) else 1
            heading_text = get_text_from_children(token.get("children"))
            return "#" * level + " " + heading_text

        if t == "paragraph":
            return get_text_from_children(token.get("children"))

        if t == "code_block":
            info = token.get("attrs", {}).get("info", "")
            raw = token.get("raw", "")
            return f"```{info}\n{raw}```"

        if t == "block_code":
            raw = token.get("raw", "")
            return f"```\n{raw}```"

        if t == "list":
            items = token.get("children", [])
            lines: list[str] = []
            for item in items:
                item_text = get_text_from_children(item.get("children"))
                lines.append(f"- {item_text}")
            return "\n".join(lines)

        if t == "thematic_break":
            return "---"

        if t == "block_quote":
            content = get_text_from_children(token.get("children"))
            return "> " + content.replace("\n", "\n> ")

        if t == "blank_line":
            return ""

        # Fallback: try to get raw or children text
        if "raw" in token:
            raw = token["raw"]
            return str(raw) if raw else ""
        if "children" in token:
            return get_text_from_children(token["children"])

        return ""

    for token in tokens:
        token_type = token.get("type", "")

        if token_type == "heading":
            # Save current section if exists
            if current_section is not None:
                sections.append(current_section)

            level = token.get("attrs", {}).get("level", 1)
            heading_text = get_text_from_children(token.get("children"))

            current_section = {
                "level": level,
                "heading": heading_text,
                "content_parts": [token_to_text(token)],
            }
        else:
            # Content token
            content = token_to_text(token)
            if current_section is None:
                # Content before any heading - create a level 0 section
                current_section = {
                    "level": 0,
                    "heading": "",
                    "content_parts": [],
                }
            if content.strip():
                current_section["content_parts"].append(content)

    # Don't forget the last section
    if current_section is not None:
        sections.append(current_section)

    return sections


def _build_section_path(heading_stack: list[tuple[int, str]], level: int, heading: str) -> str:
    """Build section path like '## Deploy > ### Rollback'.

    Args:
        heading_stack: Stack of (level, heading) tuples
        level: Current heading level
        heading: Current heading text

    Returns:
        Section path string
    """
    # Pop headings from stack until we find one with lower level
    while heading_stack and heading_stack[-1][0] >= level:
        heading_stack.pop()

    # Add current heading
    if level > 0 and heading:
        heading_stack.append((level, heading))

    # Build path
    parts: list[str] = []
    for lvl, text in heading_stack:
        prefix = "#" * lvl
        parts.append(f"{prefix} {text}")

    return " > ".join(parts) if parts else ""


def _split_on_paragraphs(text: str, max_tokens: int) -> list[str]:
    """Split text on paragraph boundaries if it exceeds max_tokens.

    Args:
        text: Text to split
        max_tokens: Maximum tokens per chunk

    Returns:
        List of text chunks
    """
    if _count_tokens(text) <= max_tokens:
        return [text]

    # Split on double newlines (paragraphs)
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    current_chunk: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = _count_tokens(para)

        if para_tokens > max_tokens:
            # Single paragraph too large - split on single newlines
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_tokens = 0

            lines = para.split("\n")
            line_chunk: list[str] = []
            line_tokens = 0

            for line in lines:
                line_token_count = _count_tokens(line)
                if line_tokens + line_token_count > max_tokens and line_chunk:
                    chunks.append("\n".join(line_chunk))
                    line_chunk = []
                    line_tokens = 0
                line_chunk.append(line)
                line_tokens += line_token_count

            if line_chunk:
                chunks.append("\n".join(line_chunk))
        elif current_tokens + para_tokens > max_tokens:
            # Would exceed - flush current chunk
            if current_chunk:
                chunks.append("\n\n".join(current_chunk))
            current_chunk = [para]
            current_tokens = para_tokens
        else:
            current_chunk.append(para)
            current_tokens += para_tokens

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks


def markdown_chunk(content: bytes, file_path: str) -> list[MarkdownChunkData]:
    """Parse markdown content and return heading-based chunks.

    Splits on heading boundaries (H1, H2, H3). Each section becomes a chunk
    with section_path capturing the heading hierarchy.

    Args:
        content: Raw markdown content bytes
        file_path: Path to file for context prefix

    Returns:
        List of MarkdownChunkData with text, byte ranges, and metadata
    """
    text = content.decode("utf-8")

    # Parse with mistune
    md = mistune.create_markdown(renderer=None)
    tokens = md(text)

    if not isinstance(tokens, list):
        # Fallback if mistune doesn't return tokens
        return [
            MarkdownChunkData(
                text=text,
                byte_start=0,
                byte_end=len(content),
                context_prefix=file_path,
                section_path="",
            )
        ]

    sections = _extract_headings_and_content(tokens)

    chunks: list[MarkdownChunkData] = []
    heading_stack: list[tuple[int, str]] = []
    byte_offset = 0

    for section in sections:
        level = section["level"]
        heading = section["heading"]
        content_parts = section["content_parts"]

        # Build section path
        section_path = _build_section_path(heading_stack, level, heading)

        # Join content
        section_text = "\n\n".join(content_parts)

        # Check if section is empty (only has heading, no actual content)
        # A section is empty if it only contains the heading line itself
        stripped = section_text.strip()
        if not stripped:
            # Skip truly empty sections
            continue

        # If section has level > 0 and content_parts has only 1 element (the heading),
        # it's an empty section with just a heading
        if level > 0 and len(content_parts) == 1:
            # Check if the only content is just the heading line
            only_content = content_parts[0].strip()
            if only_content.startswith("#") and "\n" not in only_content:
                # This is just a heading with no body - skip it
                continue

        # Check if section needs splitting
        if _count_tokens(section_text) > MAX_TOKENS:
            # Split on paragraph boundaries
            sub_chunks = _split_on_paragraphs(section_text, MAX_TOKENS)
            for i, sub_text in enumerate(sub_chunks):
                if not sub_text.strip():
                    continue

                # Calculate byte positions (approximate based on text)
                text_before = text[:byte_offset]
                try:
                    # Find this text in the original
                    pos = text.find(sub_text.split("\n")[0], byte_offset)
                    if pos >= 0:
                        byte_start = len(text[:pos].encode("utf-8"))
                    else:
                        byte_start = len(text_before.encode("utf-8"))
                except (ValueError, IndexError):
                    byte_start = len(text_before.encode("utf-8"))

                byte_end = byte_start + len(sub_text.encode("utf-8"))

                context_prefix = f"{file_path} > {section_path}" if section_path else file_path
                if len(sub_chunks) > 1:
                    context_prefix = f"{context_prefix} (part {i + 1}/{len(sub_chunks)})"

                chunks.append(
                    MarkdownChunkData(
                        text=sub_text,
                        byte_start=byte_start,
                        byte_end=byte_end,
                        context_prefix=context_prefix,
                        section_path=section_path,
                    )
                )
                byte_offset = byte_end
        else:
            # Calculate byte positions
            text_before = text[:byte_offset]
            try:
                # Find this text in the original
                first_line = section_text.split("\n")[0]
                pos = text.find(first_line, byte_offset)
                if pos >= 0:
                    byte_start = len(text[:pos].encode("utf-8"))
                else:
                    byte_start = len(text_before.encode("utf-8"))
            except (ValueError, IndexError):
                byte_start = len(text_before.encode("utf-8"))

            byte_end = byte_start + len(section_text.encode("utf-8"))

            context_prefix = f"{file_path} > {section_path}" if section_path else file_path

            chunks.append(
                MarkdownChunkData(
                    text=section_text,
                    byte_start=byte_start,
                    byte_end=byte_end,
                    context_prefix=context_prefix,
                    section_path=section_path,
                )
            )
            byte_offset = byte_end

    return chunks
