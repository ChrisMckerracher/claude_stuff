"""Import extraction using tree-sitter.

Extracts import paths from source code for each supported language.
"""

from __future__ import annotations

import tree_sitter_c_sharp as ts_csharp
import tree_sitter_go as ts_go
import tree_sitter_python as ts_python
import tree_sitter_typescript as ts_typescript
from tree_sitter import Language, Node, Parser


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


def _extract_go_imports(root: Node, source: bytes) -> list[str]:
    """Extract Go import paths.

    Go imports can be:
    - import "net/http"
    - import ( "net/http" "encoding/json" )
    """
    imports: list[str] = []

    def walk(node: Node) -> None:
        if node.type == "import_spec":
            # Find the path child (interpreted_string_literal)
            for child in node.children:
                if child.type == "interpreted_string_literal":
                    # Remove quotes
                    path = source[child.start_byte : child.end_byte].decode("utf-8")
                    path = path.strip('"')
                    imports.append(path)
        for child in node.children:
            walk(child)

    walk(root)
    return imports


def _extract_csharp_imports(root: Node, source: bytes) -> list[str]:
    """Extract C# using directives.

    C# usings: using System.Net.Http;
    """
    imports: list[str] = []

    def walk(node: Node) -> None:
        if node.type == "using_directive":
            # Find the qualified_name or identifier_name
            for child in node.children:
                if child.type in ("qualified_name", "identifier_name", "identifier"):
                    namespace = source[child.start_byte : child.end_byte].decode("utf-8")
                    imports.append(namespace)
                    break
        for child in node.children:
            walk(child)

    walk(root)
    return imports


def _extract_python_imports(root: Node, source: bytes) -> list[str]:
    """Extract Python imports.

    Python imports:
    - import requests
    - from httpx import AsyncClient
    - from foo.bar import baz
    """
    imports: list[str] = []

    def walk(node: Node) -> None:
        if node.type == "import_statement":
            # import foo, bar
            for child in node.children:
                if child.type == "dotted_name":
                    # Get the root module (first identifier)
                    module = source[child.start_byte : child.end_byte].decode("utf-8")
                    # Get just the root package
                    root_module = module.split(".")[0]
                    imports.append(root_module)
        elif node.type == "import_from_statement":
            # from foo import bar
            module_name = node.child_by_field_name("module_name")
            if module_name:
                module = source[module_name.start_byte : module_name.end_byte].decode("utf-8")
                root_module = module.split(".")[0]
                imports.append(root_module)

        for child in node.children:
            walk(child)

    walk(root)
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[str] = []
    for imp in imports:
        if imp not in seen:
            seen.add(imp)
            unique.append(imp)
    return unique


def _extract_typescript_imports(root: Node, source: bytes) -> list[str]:
    """Extract TypeScript/JavaScript imports.

    TypeScript imports:
    - import axios from 'axios'
    - import { foo } from 'bar'
    - const fs = require('fs')
    """
    imports: list[str] = []

    def walk(node: Node) -> None:
        if node.type == "import_statement":
            # Find the source (string literal)
            source_node = node.child_by_field_name("source")
            if source_node:
                # Remove quotes
                path = source[source_node.start_byte : source_node.end_byte].decode("utf-8")
                path = path.strip("'\"")
                imports.append(path)

        elif node.type == "call_expression":
            # Look for require('module')
            func = node.child_by_field_name("function")
            if func:
                func_text = source[func.start_byte : func.end_byte].decode("utf-8")
                if func_text == "require":
                    args = node.child_by_field_name("arguments")
                    if args and args.child_count > 0:
                        # Get the first argument
                        for child in args.children:
                            if child.type == "string":
                                path = source[child.start_byte : child.end_byte].decode("utf-8")
                                path = path.strip("'\"")
                                imports.append(path)
                                break

        for child in node.children:
            walk(child)

    walk(root)
    return imports


def extract_imports(source: bytes, language: str) -> list[str]:
    """Extract import paths from source code using tree-sitter.

    Args:
        source: Raw source code bytes
        language: Language name ("go", "c_sharp", "python", "typescript")

    Returns:
        List of import paths/module names

    Examples:
        Go:    import "net/http" -> ["net/http"]
        C#:    using System.Net.Http -> ["System.Net.Http"]
        Python: from requests import get -> ["requests"]
        TS:    import axios from 'axios' -> ["axios"]
    """
    try:
        lang = _get_language(language)
    except ValueError:
        return []

    parser = Parser(lang)
    tree = parser.parse(source)

    if language == "go":
        return _extract_go_imports(tree.root_node, source)
    elif language == "c_sharp":
        return _extract_csharp_imports(tree.root_node, source)
    elif language == "python":
        return _extract_python_imports(tree.root_node, source)
    elif language == "typescript":
        return _extract_typescript_imports(tree.root_node, source)
    else:
        return []
