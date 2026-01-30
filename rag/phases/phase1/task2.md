# Task 1.2: AST Chunker

**Status:** [ ] Not Started  |  [ ] In Progress  |  [x] Complete

## Objective

Create an AST-aware chunker that splits code at function/class boundaries using tree-sitter.

## File

`rag/chunking/ast_chunker.py`

## Implementation

```python
import tree_sitter
from typing import Iterator
from rag.core.types import RawChunk, ChunkID, CorpusType
from rag.core.protocols import Chunker
from rag.chunking.token_counter import TokenCounter
from rag.config import MAX_CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS

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
            yield from self._chunk_by_lines(content, source_uri)
            return

        tree = self._parse(content, language)
        for node in self._walk_top_level(tree.root_node, language):
            chunk_text = content[node.start_byte:node.end_byte].decode('utf-8', errors='replace')

            if self._counter.count(chunk_text) <= self._max:
                yield self._make_chunk(node, chunk_text, source_uri, language)
            else:
                # Split large functions into smaller chunks
                yield from self._split_large_node(node, content, source_uri, language)

    def _parse(self, content: bytes, language: str) -> tree_sitter.Tree:
        """Parse content with tree-sitter."""
        if language not in self._parsers:
            self._parsers[language] = self._create_parser(language)
        return self._parsers[language].parse(content)

    def _create_parser(self, language: str) -> tree_sitter.Parser:
        """Create parser for language."""
        parser = tree_sitter.Parser()
        if language == "python":
            import tree_sitter_python
            parser.language = tree_sitter_python.language()
        elif language == "go":
            import tree_sitter_go
            parser.language = tree_sitter_go.language()
        elif language == "typescript":
            import tree_sitter_typescript
            parser.language = tree_sitter_typescript.language_typescript()
        elif language == "csharp":
            import tree_sitter_c_sharp
            parser.language = tree_sitter_c_sharp.language()
        return parser

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
        corpus_type = CorpusType.CODE_TEST if "test" in uri.lower() else CorpusType.CODE_LOGIC

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
            if child.type == "identifier" or child.type == "name":
                return child.text.decode('utf-8', errors='replace')
        return "<anonymous>"

    def _split_large_node(
        self,
        node: tree_sitter.Node,
        content: bytes,
        uri: str,
        lang: str,
    ) -> Iterator[RawChunk]:
        """Split large function into smaller chunks with overlap."""
        text = content[node.start_byte:node.end_byte].decode('utf-8', errors='replace')
        lines = text.split('\n')

        current_chunk_lines = []
        current_tokens = 0

        for i, line in enumerate(lines):
            line_tokens = self._counter.count(line)

            if current_tokens + line_tokens > self._max and current_chunk_lines:
                # Yield current chunk
                chunk_text = '\n'.join(current_chunk_lines)
                yield RawChunk(
                    id=ChunkID.from_content(uri, node.start_byte, node.start_byte + len(chunk_text.encode())),
                    text=chunk_text,
                    source_uri=uri,
                    corpus_type=CorpusType.CODE_LOGIC,
                    byte_range=(node.start_byte, node.start_byte + len(chunk_text.encode())),
                    metadata={
                        "language": lang,
                        "symbol_name": f"{self._extract_symbol_name(node)}_part",
                        "symbol_kind": "partial",
                    },
                )

                # Keep overlap lines
                overlap_lines = []
                overlap_tokens = 0
                for j in range(len(current_chunk_lines) - 1, -1, -1):
                    line_tok = self._counter.count(current_chunk_lines[j])
                    if overlap_tokens + line_tok <= self._overlap:
                        overlap_lines.insert(0, current_chunk_lines[j])
                        overlap_tokens += line_tok
                    else:
                        break

                current_chunk_lines = overlap_lines
                current_tokens = overlap_tokens

            current_chunk_lines.append(line)
            current_tokens += line_tokens

        # Yield final chunk
        if current_chunk_lines:
            chunk_text = '\n'.join(current_chunk_lines)
            yield RawChunk(
                id=ChunkID.from_content(uri, node.end_byte - len(chunk_text.encode()), node.end_byte),
                text=chunk_text,
                source_uri=uri,
                corpus_type=CorpusType.CODE_LOGIC,
                byte_range=(node.end_byte - len(chunk_text.encode()), node.end_byte),
                metadata={
                    "language": lang,
                    "symbol_name": f"{self._extract_symbol_name(node)}_part",
                    "symbol_kind": "partial",
                },
            )

    def _chunk_by_lines(self, content: bytes, uri: str) -> Iterator[RawChunk]:
        """Fallback line-based chunking for unsupported languages."""
        text = content.decode('utf-8', errors='replace')
        lines = text.split('\n')
        # Similar logic to _split_large_node but for entire file
        # ... implementation ...
```

## Acceptance Criteria

- [ ] Implements Chunker protocol
- [ ] Chunks at function/class boundaries for supported languages
- [ ] Splits large functions into smaller chunks with overlap
- [ ] Falls back to line-based chunking for unsupported languages
- [ ] Extracts symbol names correctly
- [ ] No chunk exceeds max_tokens
- [ ] Byte ranges are accurate

## Dependencies

- Task 1.1 (Token Counter)
- tree-sitter and language bindings

## Estimated Time

45 minutes
