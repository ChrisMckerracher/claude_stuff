"""Language-specific extractors."""

from rag.extractors.languages.python import PythonExtractor
from rag.extractors.languages.go import GoExtractor
from rag.extractors.languages.typescript import TypeScriptExtractor
from rag.extractors.languages.csharp import CSharpExtractor

__all__ = [
    "PythonExtractor",
    "GoExtractor",
    "TypeScriptExtractor",
    "CSharpExtractor",
]
