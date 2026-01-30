"""Configuration constants for the RAG pipeline.

These values are used across the pipeline for consistent behavior.
"""

# Embedding model configuration
# Using jina-embeddings-v3 for code-optimized embeddings
EMBEDDING_MODEL: str = "jinaai/jina-embeddings-v3"
EMBEDDING_DIM: int = 768

# Chunking configuration
MAX_CHUNK_TOKENS: int = 512  # Maximum tokens per chunk
CHUNK_OVERLAP_TOKENS: int = 50  # Overlap between consecutive chunks
