# RAG Project - Claude Instructions

## Package Management

**Always use `uv` instead of `pip` for package management.**

```bash
# Install dependencies
uv sync

# Add a dependency
uv add <package>

# Run commands in the project environment
uv run pytest
uv run mypy rag/

# Install dev dependencies
uv sync --group dev
```

## Running Tests

```bash
uv run pytest tests/ -v
```

## Type Checking

```bash
uv run mypy rag/
```

## SpaCy Model Requirement

The PHI scrubbing module requires the spaCy English model. Install it with:

```bash
uv run python -m spacy download en_core_web_lg
```

Without this model, the `PresidioScrubber` tests will fail at runtime.

## Project Structure

- `rag/` - Main package source code
- `tests/` - Test files
- `phases/` - Phase implementation documentation
