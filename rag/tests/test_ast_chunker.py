"""Tests for the AST-based code chunker."""

from pathlib import Path

import pytest

from rag.chunking.ast_chunker import (
    ChunkData,
    ast_chunk,
    MAX_TOKENS,
    _count_tokens,
)


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestGoChunking:
    """Test Go language chunking."""

    def test_go_function_chunking(self) -> None:
        """Test that Go functions are chunked correctly."""
        source = (FIXTURES_DIR / "go" / "simple_handler.go").read_bytes()
        chunks = ast_chunk(source, "go", "handlers/simple_handler.go")

        # Should have 2 chunks - one per function
        assert len(chunks) == 2
        assert all(isinstance(c, ChunkData) for c in chunks)

    def test_go_chunk_context_prefix(self) -> None:
        """Test context prefix format for Go functions."""
        source = (FIXTURES_DIR / "go" / "simple_handler.go").read_bytes()
        chunks = ast_chunk(source, "go", "handlers/simple_handler.go")

        # Find GetUser chunk
        get_user = next(c for c in chunks if c.symbol_name == "GetUser")
        assert get_user.context_prefix == "handlers/simple_handler.go > GetUser"

    def test_go_chunk_symbol_metadata(self) -> None:
        """Test symbol metadata extraction."""
        source = (FIXTURES_DIR / "go" / "simple_handler.go").read_bytes()
        chunks = ast_chunk(source, "go", "handlers/simple_handler.go")

        get_user = next(c for c in chunks if c.symbol_name == "GetUser")
        assert get_user.symbol_name == "GetUser"
        assert get_user.symbol_kind == "function"
        assert get_user.signature is not None
        assert "func GetUser" in get_user.signature

    def test_go_chunk_byte_ranges(self) -> None:
        """Test byte ranges correspond to actual function text."""
        source = (FIXTURES_DIR / "go" / "simple_handler.go").read_bytes()
        chunks = ast_chunk(source, "go", "handlers/simple_handler.go")

        for chunk in chunks:
            extracted = source[chunk.byte_start : chunk.byte_end].decode("utf-8")
            assert extracted == chunk.text

    def test_go_interface_chunking(self) -> None:
        """Test interface and type declarations are chunked."""
        source = (FIXTURES_DIR / "go" / "interfaces.go").read_bytes()
        chunks = ast_chunk(source, "go", "models/interfaces.go")

        # Should have 2 chunks - interface and struct
        assert len(chunks) == 2
        symbol_names = {c.symbol_name for c in chunks}
        assert "UserRepository" in symbol_names
        assert "User" in symbol_names

    def test_go_large_function_splits(self) -> None:
        """Test that large functions are split into multiple chunks."""
        source = (FIXTURES_DIR / "go" / "large_function.go").read_bytes()
        chunks = ast_chunk(source, "go", "processor/large_function.go")

        # The large function should either be one chunk if under MAX_TOKENS
        # or split into multiple. Either way, each chunk should be <= MAX_TOKENS
        for chunk in chunks:
            tokens = _count_tokens(chunk.text)
            assert tokens <= MAX_TOKENS, f"Chunk has {tokens} tokens, exceeds {MAX_TOKENS}"


class TestCSharpChunking:
    """Test C# language chunking."""

    def test_csharp_class_chunking(self) -> None:
        """Test C# class with methods chunking."""
        source = (FIXTURES_DIR / "csharp" / "UserController.cs").read_bytes()
        chunks = ast_chunk(source, "c_sharp", "Controllers/UserController.cs")

        # Should have chunks for class and methods
        assert len(chunks) >= 3  # At least class + some methods

    def test_csharp_method_context_prefix(self) -> None:
        """Test context prefix for C# methods includes class."""
        source = (FIXTURES_DIR / "csharp" / "LargeClass.cs").read_bytes()
        chunks = ast_chunk(source, "c_sharp", "Models/LargeClass.cs")

        # Find a method chunk
        method_chunks = [c for c in chunks if c.symbol_kind == "method"]
        if method_chunks:
            method = method_chunks[0]
            # Context prefix should include enclosing class
            assert ">" in method.context_prefix

    def test_csharp_constructor(self) -> None:
        """Test constructor is recognized."""
        source = (FIXTURES_DIR / "csharp" / "LargeClass.cs").read_bytes()
        chunks = ast_chunk(source, "c_sharp", "Models/LargeClass.cs")

        constructors = [c for c in chunks if c.symbol_kind == "constructor"]
        assert len(constructors) >= 1


class TestPythonChunking:
    """Test Python language chunking."""

    def test_python_function_chunking(self) -> None:
        """Test Python functions are chunked."""
        source = (FIXTURES_DIR / "python" / "api_routes.py").read_bytes()
        chunks = ast_chunk(source, "python", "api/routes.py")

        # Should have chunks for functions and classes
        assert len(chunks) >= 3

    def test_python_class_with_methods(self) -> None:
        """Test Python class chunking."""
        source = (FIXTURES_DIR / "python" / "api_routes.py").read_bytes()
        chunks = ast_chunk(source, "python", "api/routes.py")

        # Find class chunks
        class_chunks = [c for c in chunks if c.symbol_kind == "class"]
        assert len(class_chunks) >= 1

    def test_python_script_fallback(self) -> None:
        """Test sliding window fallback for scripts without functions."""
        source = (FIXTURES_DIR / "python" / "script.py").read_bytes()
        chunks = ast_chunk(source, "python", "scripts/script.py")

        # Should produce at least one chunk
        assert len(chunks) >= 1
        # The chunks should be sliding windows since no boundary nodes
        for chunk in chunks:
            assert chunk.symbol_kind == "window"

    def test_python_function_metadata(self) -> None:
        """Test function metadata extraction."""
        source = (FIXTURES_DIR / "python" / "http_calls.py").read_bytes()
        chunks = ast_chunk(source, "python", "http/calls.py")

        # Find fetch_user_sync
        func = next((c for c in chunks if c.symbol_name == "fetch_user_sync"), None)
        assert func is not None
        assert func.symbol_kind == "function"
        assert "def fetch_user_sync" in func.signature


class TestTypeScriptChunking:
    """Test TypeScript language chunking."""

    def test_ts_function_chunking(self) -> None:
        """Test TypeScript function chunking."""
        source = (FIXTURES_DIR / "typescript" / "fetch_client.ts").read_bytes()
        chunks = ast_chunk(source, "typescript", "client/fetch.ts")

        # Should have multiple function chunks
        assert len(chunks) >= 3

    def test_ts_arrow_function(self) -> None:
        """Test arrow function assigned to const is chunked."""
        source = (FIXTURES_DIR / "typescript" / "arrow_functions.ts").read_bytes()
        chunks = ast_chunk(source, "typescript", "utils/arrow.ts")

        # Should capture arrow functions
        assert len(chunks) >= 1

    def test_ts_interface(self) -> None:
        """Test interface declarations are chunked."""
        source = (FIXTURES_DIR / "typescript" / "api.controller.ts").read_bytes()
        chunks = ast_chunk(source, "typescript", "controllers/api.ts")

        # Find interface chunks
        interface_chunks = [c for c in chunks if c.symbol_kind == "interface"]
        assert len(interface_chunks) >= 1

    def test_ts_class_declaration(self) -> None:
        """Test class declarations are chunked."""
        source = (FIXTURES_DIR / "typescript" / "api.controller.ts").read_bytes()
        chunks = ast_chunk(source, "typescript", "controllers/api.ts")

        class_chunks = [c for c in chunks if c.symbol_kind == "class"]
        assert len(class_chunks) >= 1


class TestChunkTextIntegrity:
    """Test that chunk text matches source bytes."""

    @pytest.mark.parametrize(
        "fixture_path,language",
        [
            ("go/simple_handler.go", "go"),
            ("go/http_client.go", "go"),
            ("csharp/UserController.cs", "c_sharp"),
            ("python/api_routes.py", "python"),
            ("typescript/fetch_client.ts", "typescript"),
        ],
    )
    def test_chunk_text_matches_source(self, fixture_path: str, language: str) -> None:
        """Verify chunk text matches source[byte_start:byte_end]."""
        source = (FIXTURES_DIR / fixture_path).read_bytes()
        chunks = ast_chunk(source, language, fixture_path)

        for chunk in chunks:
            extracted = source[chunk.byte_start : chunk.byte_end].decode("utf-8")
            assert extracted == chunk.text, (
                f"Chunk text mismatch for {chunk.symbol_name}: "
                f"expected {len(extracted)} chars, got {len(chunk.text)}"
            )


class TestTokenCounting:
    """Test token counting utility."""

    def test_count_tokens_simple(self) -> None:
        """Test basic token counting."""
        assert _count_tokens("hello world") == 2
        assert _count_tokens("one two three four five") == 5

    def test_count_tokens_empty(self) -> None:
        """Test empty string."""
        assert _count_tokens("") == 0
        assert _count_tokens("   ") == 0

    def test_count_tokens_code(self) -> None:
        """Test token counting on code-like text."""
        code = "func main() { fmt.Println(\"hello\") }"
        tokens = _count_tokens(code)
        assert tokens > 0
