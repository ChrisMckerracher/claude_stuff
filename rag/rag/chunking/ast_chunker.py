"""cAST (context-aware AST) chunking algorithm.

Chunks source code by AST structure:
1. Parse file with tree-sitter
2. Find declaration-level nodes (functions, classes, methods)
3. Each declaration becomes a chunk (or splits if > 2048 tokens)
4. Files with no declarations use sliding window fallback
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

import tree_sitter_c_sharp as ts_csharp
import tree_sitter_go as ts_go
import tree_sitter_python as ts_python
import tree_sitter_typescript as ts_typescript
from tree_sitter import Language, Parser, Node

if TYPE_CHECKING:
    pass


# Maximum tokens per chunk (approximate: whitespace-split count)
MAX_TOKENS = 2048
# Target tokens for sliding window fallback
SLIDING_WINDOW_TARGET = 1600
# Overlap fraction for sliding window
SLIDING_WINDOW_OVERLAP = 0.1


@dataclass
class ChunkData:
    """Intermediate output of the AST chunker.

    The CodeCrawler wraps this into a RawChunk.
    """

    text: str
    byte_start: int
    byte_end: int
    context_prefix: str
    symbol_name: str | None
    symbol_kind: str | None
    signature: str | None
    enclosing_class: str | None


# Boundary node types that define chunk boundaries per language
BOUNDARY_NODES: dict[str, list[str]] = {
    "go": [
        "function_declaration",
        "method_declaration",
        "type_declaration",
    ],
    "c_sharp": [
        "method_declaration",
        "class_declaration",
        "interface_declaration",
        "constructor_declaration",
        "property_declaration",
    ],
    "python": [
        "function_definition",
        "class_definition",
    ],
    "typescript": [
        "function_declaration",
        "method_definition",
        "class_declaration",
        "interface_declaration",
        "lexical_declaration",  # for const arrow functions
    ],
}

# Symbol kind mapping from node type
SYMBOL_KIND_MAP: dict[str, str] = {
    "function_declaration": "function",
    "function_definition": "function",
    "method_declaration": "method",
    "method_definition": "method",
    "class_declaration": "class",
    "class_definition": "class",
    "interface_declaration": "interface",
    "type_declaration": "type",
    "constructor_declaration": "constructor",
    "property_declaration": "property",
    "lexical_declaration": "variable",
}


def _get_language(lang_name: str) -> Language:
    """Load tree-sitter language grammar."""
    if lang_name == "go":
        return Language(ts_go.language())
    elif lang_name == "c_sharp":
        return Language(ts_csharp.language())
    elif lang_name == "python":
        return Language(ts_python.language())
    elif lang_name == "typescript":
        return Language(ts_typescript.language_typescript())
    else:
        raise ValueError(f"Unsupported language: {lang_name}")


def _count_tokens(text: str) -> int:
    """Approximate token count using whitespace splitting."""
    return len(text.split())


def _get_symbol_name(node: Node, source: bytes, language: str) -> str | None:
    """Extract the symbol name from a node."""
    # Look for identifier or name child nodes
    name_node = None

    if language == "go":
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
        elif node.type == "method_declaration":
            name_node = node.child_by_field_name("name")
        elif node.type == "type_declaration":
            # type_declaration has a type_spec child with the name
            for child in node.children:
                if child.type == "type_spec":
                    name_node = child.child_by_field_name("name")
                    break

    elif language == "c_sharp":
        name_node = node.child_by_field_name("name")

    elif language == "python":
        name_node = node.child_by_field_name("name")

    elif language == "typescript":
        if node.type == "lexical_declaration":
            # const foo = () => {} - find the variable_declarator
            for child in node.children:
                if child.type == "variable_declarator":
                    name_node = child.child_by_field_name("name")
                    break
        else:
            name_node = node.child_by_field_name("name")

    if name_node:
        return source[name_node.start_byte : name_node.end_byte].decode("utf-8")
    return None


def _get_signature(node: Node, source: bytes) -> str | None:
    """Extract the first line of the declaration as signature."""
    text = source[node.start_byte : node.end_byte].decode("utf-8")
    first_line = text.split("\n")[0].strip()
    # Limit signature length
    if len(first_line) > 200:
        return first_line[:200] + "..."
    return first_line if first_line else None


def _get_enclosing_class(node: Node, source: bytes) -> str | None:
    """Find the enclosing class name for a node."""
    parent = node.parent
    while parent:
        if parent.type in ("class_declaration", "class_definition"):
            name_node = parent.child_by_field_name("name")
            if name_node:
                return source[name_node.start_byte : name_node.end_byte].decode("utf-8")
        parent = parent.parent
    return None


def _build_context_prefix(
    file_path: str,
    enclosing_class: str | None,
    symbol_name: str | None,
) -> str:
    """Build context prefix in format: 'file > class > symbol'."""
    parts = [file_path]
    if enclosing_class:
        parts.append(enclosing_class)
    if symbol_name:
        parts.append(symbol_name)
    return " > ".join(parts)


def _is_arrow_function_const(node: Node) -> bool:
    """Check if a lexical_declaration contains an arrow function."""
    if node.type != "lexical_declaration":
        return False

    for child in node.children:
        if child.type == "variable_declarator":
            value = child.child_by_field_name("value")
            if value and value.type == "arrow_function":
                return True
    return False


def _find_boundary_nodes(
    root: Node, language: str, source: bytes
) -> list[tuple[Node, str | None]]:
    """Find all boundary nodes in the AST.

    Returns list of (node, enclosing_class_name) tuples.
    """
    boundary_types = set(BOUNDARY_NODES.get(language, []))
    results: list[tuple[Node, str | None]] = []

    def walk(node: Node, enclosing_class: str | None) -> None:
        current_class = enclosing_class

        # Track class context
        if node.type in ("class_declaration", "class_definition"):
            name_node = node.child_by_field_name("name")
            if name_node:
                current_class = source[name_node.start_byte : name_node.end_byte].decode("utf-8")

        if node.type in boundary_types:
            # For TypeScript, only include lexical_declaration if it's an arrow function
            if node.type == "lexical_declaration":
                if _is_arrow_function_const(node):
                    results.append((node, enclosing_class))
            else:
                results.append((node, enclosing_class))

        for child in node.children:
            walk(child, current_class)

    walk(root, None)
    return results


def _split_large_node(
    node: Node,
    source: bytes,
    file_path: str,
    enclosing_class: str | None,
    language: str,
) -> list[ChunkData]:
    """Split a node that exceeds MAX_TOKENS into sub-chunks.

    Recursively splits by child nodes, merging siblings until MAX_TOKENS.
    Falls back to sliding window if children are still too large.
    """
    text = source[node.start_byte : node.end_byte].decode("utf-8")
    tokens = _count_tokens(text)

    if tokens <= MAX_TOKENS:
        symbol_name = _get_symbol_name(node, source, language)
        return [
            ChunkData(
                text=text,
                byte_start=node.start_byte,
                byte_end=node.end_byte,
                context_prefix=_build_context_prefix(file_path, enclosing_class, symbol_name),
                symbol_name=symbol_name,
                symbol_kind=SYMBOL_KIND_MAP.get(node.type),
                signature=_get_signature(node, source),
                enclosing_class=enclosing_class,
            )
        ]

    # Try to split by children
    children = [c for c in node.children if c.type not in ("comment", "{", "}", "(", ")", ";")]

    if not children:
        # No meaningful children, use sliding window on this node
        return _sliding_window_chunks(
            source[node.start_byte : node.end_byte],
            node.start_byte,
            file_path,
            enclosing_class,
        )

    # Greedily merge children into sub-chunks
    chunks: list[ChunkData] = []
    current_children: list[Node] = []
    current_tokens = 0
    symbol_name = _get_symbol_name(node, source, language)

    for child in children:
        child_text = source[child.start_byte : child.end_byte].decode("utf-8")
        child_tokens = _count_tokens(child_text)

        if child_tokens > MAX_TOKENS:
            # Flush current batch if any
            if current_children:
                chunks.extend(
                    _create_merged_chunk(
                        current_children, source, file_path, enclosing_class, symbol_name
                    )
                )
                current_children = []
                current_tokens = 0

            # Recursively split the large child
            chunks.extend(
                _split_large_node(child, source, file_path, enclosing_class, language)
            )
        elif current_tokens + child_tokens > MAX_TOKENS:
            # Flush current batch and start new one
            if current_children:
                chunks.extend(
                    _create_merged_chunk(
                        current_children, source, file_path, enclosing_class, symbol_name
                    )
                )
            current_children = [child]
            current_tokens = child_tokens
        else:
            current_children.append(child)
            current_tokens += child_tokens

    # Flush remaining
    if current_children:
        chunks.extend(
            _create_merged_chunk(
                current_children, source, file_path, enclosing_class, symbol_name
            )
        )

    return chunks


def _create_merged_chunk(
    nodes: list[Node],
    source: bytes,
    file_path: str,
    enclosing_class: str | None,
    parent_symbol: str | None,
) -> list[ChunkData]:
    """Create a chunk from merged sibling nodes."""
    if not nodes:
        return []

    byte_start = nodes[0].start_byte
    byte_end = nodes[-1].end_byte
    text = source[byte_start:byte_end].decode("utf-8")

    return [
        ChunkData(
            text=text,
            byte_start=byte_start,
            byte_end=byte_end,
            context_prefix=_build_context_prefix(file_path, enclosing_class, parent_symbol),
            symbol_name=parent_symbol,
            symbol_kind="fragment",
            signature=None,
            enclosing_class=enclosing_class,
        )
    ]


def _sliding_window_chunks(
    source: bytes,
    base_offset: int,
    file_path: str,
    enclosing_class: str | None,
) -> list[ChunkData]:
    """Create overlapping sliding window chunks for text without boundaries."""
    text = source.decode("utf-8")
    words = text.split()

    if not words:
        return []

    if len(words) <= SLIDING_WINDOW_TARGET:
        return [
            ChunkData(
                text=text,
                byte_start=base_offset,
                byte_end=base_offset + len(source),
                context_prefix=_build_context_prefix(file_path, enclosing_class, None),
                symbol_name=None,
                symbol_kind="window",
                signature=None,
                enclosing_class=enclosing_class,
            )
        ]

    chunks: list[ChunkData] = []
    overlap = int(SLIDING_WINDOW_TARGET * SLIDING_WINDOW_OVERLAP)
    stride = SLIDING_WINDOW_TARGET - overlap
    i = 0

    while i < len(words):
        end_idx = min(i + SLIDING_WINDOW_TARGET, len(words))
        chunk_words = words[i:end_idx]
        chunk_text = " ".join(chunk_words)

        # Calculate byte range (approximate)
        prefix_text = " ".join(words[:i]) + (" " if i > 0 else "")
        byte_start = base_offset + len(prefix_text.encode("utf-8"))
        byte_end = byte_start + len(chunk_text.encode("utf-8"))

        chunks.append(
            ChunkData(
                text=chunk_text,
                byte_start=byte_start,
                byte_end=byte_end,
                context_prefix=_build_context_prefix(file_path, enclosing_class, None),
                symbol_name=None,
                symbol_kind="window",
                signature=None,
                enclosing_class=enclosing_class,
            )
        )

        if end_idx >= len(words):
            break
        i += stride

    return chunks


def ast_chunk(source: bytes, language: str, file_path: str) -> list[ChunkData]:
    """Parse source code and return AST-based chunks.

    Args:
        source: Raw source code bytes
        language: Language name ("go", "c_sharp", "python", "typescript")
        file_path: Path to file for context prefix

    Returns:
        List of ChunkData with text, byte ranges, and metadata
    """
    try:
        lang = _get_language(language)
    except ValueError:
        # Unsupported language - return whole file as one chunk
        return _sliding_window_chunks(source, 0, file_path, None)

    parser = Parser(lang)
    tree = parser.parse(source)

    boundary_nodes = _find_boundary_nodes(tree.root_node, language, source)

    if not boundary_nodes:
        # No boundary nodes found - use sliding window fallback
        return _sliding_window_chunks(source, 0, file_path, None)

    chunks: list[ChunkData] = []

    for node, enclosing_class in boundary_nodes:
        text = source[node.start_byte : node.end_byte].decode("utf-8")
        tokens = _count_tokens(text)

        if tokens > MAX_TOKENS:
            # Split large declarations
            chunks.extend(
                _split_large_node(node, source, file_path, enclosing_class, language)
            )
        else:
            symbol_name = _get_symbol_name(node, source, language)
            chunks.append(
                ChunkData(
                    text=text,
                    byte_start=node.start_byte,
                    byte_end=node.end_byte,
                    context_prefix=_build_context_prefix(file_path, enclosing_class, symbol_name),
                    symbol_name=symbol_name,
                    symbol_kind=SYMBOL_KIND_MAP.get(node.type),
                    signature=_get_signature(node, source),
                    enclosing_class=enclosing_class,
                )
            )

    return chunks
