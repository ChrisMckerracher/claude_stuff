"""Configuration constants for the RAG pipeline.

These values are used across the pipeline for consistent behavior.
"""

# Embedding model configuration
# Using jina-embeddings-v2-base-en via fastembed (ONNX, no PyTorch)
# Note: v3 available but CC BY-NC 4.0 licensed
EMBEDDING_MODEL: str = "jinaai/jina-embeddings-v2-base-en"
EMBEDDING_DIM: int = 768

# Chunking configuration
MAX_CHUNK_TOKENS: int = 512  # Maximum tokens per chunk
CHUNK_OVERLAP_TOKENS: int = 50  # Overlap between consecutive chunks
