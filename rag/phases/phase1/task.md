# Phase 1: Chunking Pipeline

## Overview

**Deliverable:** Working chunkers for code, markdown, and conversations. Tested locally.

**Custom Code:** ~100 lines

**Dependencies:** tree-sitter (local install), no network required

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/chunking/token_counter.py` | Model-aligned token counting | ~30 |
| `rag/chunking/ast_chunker.py` | Tree-sitter AST-based code chunking | ~40 |
| `rag/chunking/md_chunker.py` | Markdown heading-based chunking | ~20 |
| `rag/chunking/thread_chunker.py` | Conversation thread chunking | ~20 |

## Tasks

- [x] [Task 1: Token Counter](task1.md)
- [x] [Task 2: AST Chunker](task2.md)
- [x] [Task 3: Markdown Chunker](task3.md)
- [x] [Task 4: Thread Chunker](task4.md)

## Verification Checklist

- [x] All chunkers implement Chunker protocol
- [x] Token counts verified against model tokenizer
- [x] No chunk exceeds max_tokens (512 by default)
- [x] Chunks have valid byte ranges
- [x] Context prefix (file > class > function) computed correctly
- [x] Unit tests pass with real tree-sitter

## Quick Check

```bash
python -c "
from rag.chunking import TokenCounter, ASTChunker, MarkdownChunker
tc = TokenCounter()
assert tc.count('hello world') > 0
chunker = ASTChunker(tc)
code = b'def foo(): pass\ndef bar(): pass'
chunks = list(chunker.chunk(code, source_uri='test.py', language='python'))
assert len(chunks) == 2
print('QUICK CHECK PASSED: Chunking pipeline works')
"
```

## Prerequisites

- Phase 0 complete (types and protocols defined)
- tree-sitter-python installed: `pip install tree-sitter-python`

## Next Phase

Upon completion, proceed to [Phase 2: PHI Scrubbing](../phase2/task.md)
