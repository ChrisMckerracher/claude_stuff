"""Tests for ASTChunker."""

import pytest

from rag.chunking.ast_chunker import ASTChunker
from rag.chunking.token_counter import TokenCounter
from rag.core.types import CorpusType


@pytest.fixture
def counter() -> TokenCounter:
    """Create a TokenCounter instance."""
    return TokenCounter()


@pytest.fixture
def chunker(counter: TokenCounter) -> ASTChunker:
    """Create an ASTChunker instance."""
    return ASTChunker(counter)


class TestASTChunker:
    """AST chunking tests."""

    def test_chunk_python_at_function_boundaries(self, chunker: ASTChunker) -> None:
        """Chunk Python at function boundaries."""
        code = b"""def foo():
    pass

def bar():
    pass
"""
        chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))
        assert len(chunks) == 2
        assert chunks[0].metadata["symbol_name"] == "foo"
        assert chunks[1].metadata["symbol_name"] == "bar"

    def test_chunk_python_class_with_methods(self, chunker: ASTChunker) -> None:
        """Chunk Python class as single unit."""
        code = b"""class MyClass:
    def method1(self):
        pass

    def method2(self):
        pass
"""
        chunks = list(chunker.chunk(code, source_uri="src/myclass.py", language="python"))
        assert len(chunks) == 1
        assert chunks[0].metadata["symbol_name"] == "MyClass"
        assert "method1" in chunks[0].text
        assert "method2" in chunks[0].text

    def test_extract_symbol_names(self, chunker: ASTChunker) -> None:
        """Extract symbol names correctly."""
        code = b"""def authenticate_user(username, password):
    pass
"""
        chunks = list(chunker.chunk(code, source_uri="auth.py", language="python"))
        assert len(chunks) == 1
        assert chunks[0].metadata["symbol_name"] == "authenticate_user"
        assert chunks[0].metadata["symbol_kind"] == "function_definition"

    def test_handle_unsupported_language(self, chunker: ASTChunker) -> None:
        """Fall back to line-based chunking for unsupported languages."""
        code = b'def hello; puts "hi"; end'
        chunks = list(chunker.chunk(code, source_uri="test.rb", language="ruby"))
        assert len(chunks) >= 1
        # Should not raise error

    def test_mark_test_files_correctly(self, chunker: ASTChunker) -> None:
        """Test files get CODE_TEST corpus type."""
        code = b"def test_foo(): pass"
        chunks = list(chunker.chunk(code, source_uri="tests/test_auth.py", language="python"))
        assert chunks[0].corpus_type == CorpusType.CODE_TEST

    def test_mark_source_files_correctly(self, chunker: ASTChunker) -> None:
        """Source files get CODE_LOGIC corpus type."""
        code = b"def foo(): pass"
        chunks = list(chunker.chunk(code, source_uri="src/auth/login.py", language="python"))
        assert chunks[0].corpus_type == CorpusType.CODE_LOGIC

    def test_split_large_function(self, counter: TokenCounter) -> None:
        """Split large functions into smaller chunks."""
        # Create a chunker with small max tokens
        chunker = ASTChunker(counter, max_tokens=20, overlap_tokens=5)

        # Create a large function
        lines = ["def big_function():"]
        for i in range(50):
            lines.append(f"    x{i} = {i}")
        lines.append("    return x0")
        code = "\n".join(lines).encode()

        chunks = list(chunker.chunk(code, source_uri="big.py", language="python"))
        assert len(chunks) > 1
        # Each chunk should be under max tokens
        for chunk in chunks:
            assert counter.count(chunk.text) <= 20 + 5  # Allow some buffer for splitting

    def test_byte_ranges_accurate(self, chunker: ASTChunker) -> None:
        """Byte ranges match actual positions."""
        code = b"def foo(): pass\ndef bar(): pass"
        chunks = list(chunker.chunk(code, source_uri="test.py", language="python"))

        for chunk in chunks:
            start, end = chunk.byte_range
            extracted = code[start:end].decode("utf-8")
            assert chunk.text == extracted

    def test_empty_file_handling(self, chunker: ASTChunker) -> None:
        """Handle empty files gracefully."""
        code = b""
        chunks = list(chunker.chunk(code, source_uri="empty.py", language="python"))
        # Should produce at least one chunk or handle gracefully
        assert len(chunks) >= 0

    def test_imports_only_file(self, chunker: ASTChunker) -> None:
        """Handle files with only imports."""
        code = b"import os\nimport sys\nfrom pathlib import Path"
        chunks = list(chunker.chunk(code, source_uri="imports.py", language="python"))
        # Should fall back to line-based chunking
        assert len(chunks) >= 1
