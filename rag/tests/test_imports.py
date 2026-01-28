"""Tests for import extraction."""

from pathlib import Path

import pytest

from rag.boundary.imports import extract_imports


FIXTURES_DIR = Path(__file__).parent / "fixtures"


class TestGoImports:
    """Test Go import extraction."""

    def test_go_imports(self) -> None:
        """Test extracting Go imports."""
        source = (FIXTURES_DIR / "go" / "simple_handler.go").read_bytes()
        imports = extract_imports(source, "go")

        assert "encoding/json" in imports
        assert "net/http" in imports

    def test_go_grouped_imports(self) -> None:
        """Test extracting imports from grouped import block."""
        source = b'''package main

import (
    "fmt"
    "net/http"
    "encoding/json"
)

func main() {}
'''
        imports = extract_imports(source, "go")

        assert "fmt" in imports
        assert "net/http" in imports
        assert "encoding/json" in imports

    def test_go_single_import(self) -> None:
        """Test single line import."""
        source = b'''package client

import "net/http"

func main() {}
'''
        imports = extract_imports(source, "go")
        assert "net/http" in imports


class TestCSharpImports:
    """Test C# using directive extraction."""

    def test_csharp_using(self) -> None:
        """Test extracting C# using directives."""
        source = (FIXTURES_DIR / "csharp" / "UserController.cs").read_bytes()
        imports = extract_imports(source, "c_sharp")

        assert "System" in imports
        assert "Microsoft.AspNetCore.Mvc" in imports

    def test_csharp_multiple_usings(self) -> None:
        """Test extracting multiple using directives."""
        source = (FIXTURES_DIR / "csharp" / "HttpClientService.cs").read_bytes()
        imports = extract_imports(source, "c_sharp")

        assert "System" in imports
        assert "System.Net.Http" in imports
        assert "System.Net.Http.Json" in imports


class TestPythonImports:
    """Test Python import extraction."""

    def test_python_import(self) -> None:
        """Test basic import statement."""
        source = b'''import requests
import json

def main(): pass
'''
        imports = extract_imports(source, "python")
        assert "requests" in imports
        assert "json" in imports

    def test_python_from_import(self) -> None:
        """Test from ... import statement."""
        source = (FIXTURES_DIR / "python" / "http_calls.py").read_bytes()
        imports = extract_imports(source, "python")

        assert "requests" in imports
        assert "httpx" in imports

    def test_python_dotted_import(self) -> None:
        """Test dotted module names."""
        source = b'''from foo.bar.baz import qux
import one.two.three

def main(): pass
'''
        imports = extract_imports(source, "python")
        # Should get root module
        assert "foo" in imports
        assert "one" in imports

    def test_python_deduplication(self) -> None:
        """Test that duplicate imports are deduplicated."""
        source = b'''import requests
from requests import get
from requests.api import post

def main(): pass
'''
        imports = extract_imports(source, "python")
        # Should only have one "requests"
        assert imports.count("requests") == 1


class TestTypeScriptImports:
    """Test TypeScript import extraction."""

    def test_ts_import(self) -> None:
        """Test ES module imports."""
        source = (FIXTURES_DIR / "typescript" / "fetch_client.ts").read_bytes()
        imports = extract_imports(source, "typescript")

        assert "axios" in imports

    def test_ts_import_variations(self) -> None:
        """Test different import syntaxes."""
        source = b'''import axios from 'axios';
import { Router } from 'express';
import * as fs from 'fs';

export function main() {}
'''
        imports = extract_imports(source, "typescript")

        assert "axios" in imports
        assert "express" in imports
        assert "fs" in imports

    def test_ts_require(self) -> None:
        """Test CommonJS require."""
        source = b'''const fs = require('fs');
const path = require('path');

module.exports = {};
'''
        imports = extract_imports(source, "typescript")

        assert "fs" in imports
        assert "path" in imports

    def test_ts_named_imports(self) -> None:
        """Test named imports from NestJS-style code."""
        source = (FIXTURES_DIR / "typescript" / "api.controller.ts").read_bytes()
        imports = extract_imports(source, "typescript")

        assert "@nestjs/common" in imports


class TestUnsupportedLanguage:
    """Test handling of unsupported languages."""

    def test_unknown_language(self) -> None:
        """Unknown languages should return empty list."""
        source = b"public class Main { public static void main(String[] args) {} }"
        imports = extract_imports(source, "java")
        assert imports == []

    def test_empty_source(self) -> None:
        """Empty source should return empty list."""
        imports = extract_imports(b"", "go")
        assert imports == []


class TestImportEdgeCases:
    """Test edge cases in import extraction."""

    def test_go_no_imports(self) -> None:
        """Go file with no imports."""
        source = b'''package main

func main() {
    println("hello")
}
'''
        imports = extract_imports(source, "go")
        assert imports == []

    def test_python_no_imports(self) -> None:
        """Python file with no imports."""
        source = b'''def hello():
    print("hello")

hello()
'''
        imports = extract_imports(source, "python")
        assert imports == []
