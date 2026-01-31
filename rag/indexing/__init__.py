"""Indexing module for vector storage and embedding.

Provides:
- CodeRankEmbedder: Production embedder using fastembed
- MockEmbedder: Test embedder with deterministic vectors
- LanceStore: LanceDB vector store implementation
"""

from rag.indexing.embedder import CodeRankEmbedder, MockEmbedder
from rag.indexing.lance_store import LanceStore

__all__ = ["CodeRankEmbedder", "MockEmbedder", "LanceStore"]
