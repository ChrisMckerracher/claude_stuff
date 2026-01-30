"""AST-based code chunking using tree-sitter.

Chunks code at function/class/method boundaries to preserve
semantic units. Falls back to line-based chunking for
unsupported languages or very large functions.
"""

from typing import Iterator

import tree_sitter

from rag.config import CHUNK_OVERLAP_TOKENS, MAX_CHUNK_TOKENS
from rag.core.types import ChunkID, CorpusType, RawChunk

from .token_counter import TokenCounter


class ASTChunker:
    """Chunk code using tree-sitter AST.

    Splits at function/class/method boundaries to preserve semantic units.
    Falls back to line-based splitting for very large functions.
    """

    SUPPORTED_LANGUAGES = {"python", "go", "typescript", "csharp"}

    # Node types that represent top-level chunks
    CHUNK_NODE_TYPES = {
        "python": {"function_definition", "class_definition", "decorated_definition"},
        "go": {"function_declaration", "method_declaration", "type_declaration"},
        "typescript": {"function_declaration", "class_declaration", "method_definition"},
        "csharp": {"method_declaration", "class_declaration", "struct_declaration"},
    }

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = MAX_CHUNK_TOKENS,
        overlap_tokens: int = CHUNK_OVERLAP_TOKENS,
    ):
        self._counter = token_counter
        self._max = max_tokens
        self._overlap = overlap_tokens
        self._parsers: dict[str, tree_sitter.Parser] = {}

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str,
    ) -> Iterator[RawChunk]:
        """Yield chunks at function/class boundaries.

        Args:
            content: Source code as bytes
            source_uri: File path or identifier
            language: Programming language (python, go, typescript, csharp)

        Yields:
            RawChunk objects, one per function/class or split segment
        """
        if language not in self.SUPPORTED_LANGUAGES:
            # Fall back to simple line-based chunking
            yield from self._chunk_by_lines(content, source_uri, language)
            return

        tree = self._parse(content, language)
        chunks_found = False

        for node in self._walk_top_level(tree.root_node, language):
            chunks_found = True
            chunk_text = content[node.start_byte : node.end_byte].decode(
                "utf-8", errors="replace"
            )

            if self._counter.count(chunk_text) <= self._max:
                yield self._make_chunk(node, chunk_text, source_uri, language)
            else:
                # Split large functions into smaller chunks
                yield from self._split_large_node(node, content, source_uri, language)

        # If no chunks found (e.g., file with only imports), chunk entire file
        if not chunks_found:
            yield from self._chunk_by_lines(content, source_uri, language)

    def _parse(self, content: bytes, language: str) -> tree_sitter.Tree:
        """Parse content with tree-sitter."""
        if language not in self._parsers:
            self._parsers[language] = self._create_parser(language)
        return self._parsers[language].parse(content)

    def _create_parser(self, language: str) -> tree_sitter.Parser:
        """Create parser for language."""
        lang_capsule = None

        if language == "python":
            import tree_sitter_python

            lang_capsule = tree_sitter_python.language()
        elif language == "go":
            import tree_sitter_go

            lang_capsule = tree_sitter_go.language()
        elif language == "typescript":
            import tree_sitter_typescript

            lang_capsule = tree_sitter_typescript.language_typescript()
        elif language == "csharp":
            import tree_sitter_c_sharp

            lang_capsule = tree_sitter_c_sharp.language()

        if lang_capsule is None:
            raise ValueError(f"Unsupported language: {language}")

        # Wrap the capsule with Language and pass to Parser constructor
        lang = tree_sitter.Language(lang_capsule)
        return tree_sitter.Parser(lang)

    def _walk_top_level(
        self,
        node: tree_sitter.Node,
        language: str,
    ) -> Iterator[tree_sitter.Node]:
        """Yield function/class/method nodes."""
        chunk_types = self.CHUNK_NODE_TYPES.get(language, set())

        if node.type in chunk_types:
            yield node
        else:
            for child in node.children:
                yield from self._walk_top_level(child, language)

    def _make_chunk(
        self,
        node: tree_sitter.Node,
        text: str,
        uri: str,
        lang: str,
    ) -> RawChunk:
        """Create RawChunk from AST node."""
        # Determine corpus type
        corpus_type = (
            CorpusType.CODE_TEST if "test" in uri.lower() else CorpusType.CODE_LOGIC
        )

        # Extract symbol name
        symbol_name = self._extract_symbol_name(node)

        return RawChunk(
            id=ChunkID.from_content(uri, node.start_byte, node.end_byte),
            text=text,
            source_uri=uri,
            corpus_type=corpus_type,
            byte_range=(node.start_byte, node.end_byte),
            metadata={
                "language": lang,
                "symbol_name": symbol_name,
                "symbol_kind": node.type,
                "line_start": node.start_point[0] + 1,
                "line_end": node.end_point[0] + 1,
            },
        )

    def _extract_symbol_name(self, node: tree_sitter.Node) -> str:
        """Extract function/class name from node."""
        for child in node.children:
            if child.type in ("identifier", "name"):
                return child.text.decode("utf-8", errors="replace")
        return "<anonymous>"

    def _split_large_node(
        self,
        node: tree_sitter.Node,
        content: bytes,
        uri: str,
        lang: str,
    ) -> Iterator[RawChunk]:
        """Split large function into smaller chunks with overlap."""
        text = content[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
        lines = text.split("\n")

        # Determine corpus type
        corpus_type = (
            CorpusType.CODE_TEST if "test" in uri.lower() else CorpusType.CODE_LOGIC
        )

        symbol_name = self._extract_symbol_name(node)
        current_chunk_lines: list[str] = []
        current_tokens = 0
        chunk_byte_start = node.start_byte

        for line in lines:
            line_tokens = self._counter.count(line)

            if current_tokens + line_tokens > self._max and current_chunk_lines:
                # Yield current chunk
                chunk_text = "\n".join(current_chunk_lines)
                chunk_byte_end = chunk_byte_start + len(chunk_text.encode())
                yield RawChunk(
                    id=ChunkID.from_content(uri, chunk_byte_start, chunk_byte_end),
                    text=chunk_text,
                    source_uri=uri,
                    corpus_type=corpus_type,
                    byte_range=(chunk_byte_start, chunk_byte_end),
                    metadata={
                        "language": lang,
                        "symbol_name": f"{symbol_name}_part",
                        "symbol_kind": "partial",
                        "line_start": node.start_point[0] + 1,
                        "line_end": node.end_point[0] + 1,
                    },
                )

                # Keep overlap lines
                overlap_lines: list[str] = []
                overlap_tokens = 0
                for j in range(len(current_chunk_lines) - 1, -1, -1):
                    line_tok = self._counter.count(current_chunk_lines[j])
                    if overlap_tokens + line_tok <= self._overlap:
                        overlap_lines.insert(0, current_chunk_lines[j])
                        overlap_tokens += line_tok
                    else:
                        break

                # Update byte start for next chunk
                lines_used = len(current_chunk_lines) - len(overlap_lines)
                for i in range(lines_used):
                    chunk_byte_start += len(current_chunk_lines[i].encode()) + 1  # +1 for \n

                current_chunk_lines = overlap_lines
                current_tokens = overlap_tokens

            current_chunk_lines.append(line)
            current_tokens += line_tokens

        # Yield final chunk
        if current_chunk_lines:
            chunk_text = "\n".join(current_chunk_lines)
            yield RawChunk(
                id=ChunkID.from_content(uri, chunk_byte_start, node.end_byte),
                text=chunk_text,
                source_uri=uri,
                corpus_type=corpus_type,
                byte_range=(chunk_byte_start, node.end_byte),
                metadata={
                    "language": lang,
                    "symbol_name": f"{symbol_name}_part",
                    "symbol_kind": "partial",
                    "line_start": node.start_point[0] + 1,
                    "line_end": node.end_point[0] + 1,
                },
            )

    def _chunk_by_lines(
        self, content: bytes, uri: str, language: str | None = None
    ) -> Iterator[RawChunk]:
        """Fallback line-based chunking for unsupported languages."""
        text = content.decode("utf-8", errors="replace")
        lines = text.split("\n")

        # Determine corpus type
        corpus_type = (
            CorpusType.CODE_TEST if "test" in uri.lower() else CorpusType.CODE_LOGIC
        )

        current_chunk_lines: list[str] = []
        current_tokens = 0
        chunk_byte_start = 0
        current_byte_offset = 0

        for line in lines:
            line_tokens = self._counter.count(line)
            line_bytes = len(line.encode()) + 1  # +1 for newline

            if current_tokens + line_tokens > self._max and current_chunk_lines:
                # Yield current chunk
                chunk_text = "\n".join(current_chunk_lines)
                chunk_byte_end = chunk_byte_start + len(chunk_text.encode())
                yield RawChunk(
                    id=ChunkID.from_content(uri, chunk_byte_start, chunk_byte_end),
                    text=chunk_text,
                    source_uri=uri,
                    corpus_type=corpus_type,
                    byte_range=(chunk_byte_start, chunk_byte_end),
                    metadata={
                        "language": language or "unknown",
                        "symbol_name": "<file_segment>",
                        "symbol_kind": "segment",
                    },
                )

                # Keep overlap lines
                overlap_lines: list[str] = []
                overlap_tokens = 0
                for j in range(len(current_chunk_lines) - 1, -1, -1):
                    line_tok = self._counter.count(current_chunk_lines[j])
                    if overlap_tokens + line_tok <= self._overlap:
                        overlap_lines.insert(0, current_chunk_lines[j])
                        overlap_tokens += line_tok
                    else:
                        break

                # Update chunk start
                lines_used = len(current_chunk_lines) - len(overlap_lines)
                for i in range(lines_used):
                    chunk_byte_start += len(current_chunk_lines[i].encode()) + 1

                current_chunk_lines = overlap_lines
                current_tokens = overlap_tokens

            current_chunk_lines.append(line)
            current_tokens += line_tokens
            current_byte_offset += line_bytes

        # Yield final chunk
        if current_chunk_lines:
            chunk_text = "\n".join(current_chunk_lines)
            chunk_byte_end = len(content)
            yield RawChunk(
                id=ChunkID.from_content(uri, chunk_byte_start, chunk_byte_end),
                text=chunk_text,
                source_uri=uri,
                corpus_type=corpus_type,
                byte_range=(chunk_byte_start, chunk_byte_end),
                metadata={
                    "language": language or "unknown",
                    "symbol_name": "<file_segment>",
                    "symbol_kind": "segment",
                },
            )
