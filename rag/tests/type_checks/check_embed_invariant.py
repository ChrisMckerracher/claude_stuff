"""Type invariant check: Embedder cannot accept RawChunk.

This file should FAIL mypy, proving the type system works.
It is NOT run by pytest -- it is checked by mypy only.

Expected mypy error on the embed_batch call:
  Argument 1 to "embed_batch" has incompatible type "list[RawChunk]";
  expected "list[CleanChunk]"
"""

from rag.models.chunk import RawChunk
from rag.pipeline.protocols import Embedder


def bad_embed(embedder: Embedder, raw: RawChunk) -> None:
    embedder.embed_batch([raw])  # mypy error: RawChunk is not CleanChunk
