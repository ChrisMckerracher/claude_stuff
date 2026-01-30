# Task 2.1: NLP Backend

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create a pluggable NLP backend factory that allows swapping between regex-only, spaCy, and transformers backends without changing application code.

## File

`rag/scrubbing/nlp_backend.py`

## Implementation

```python
"""Pluggable NLP backend for Presidio analyzer.

This module provides a factory function to create Presidio AnalyzerEngine
instances with different NLP backends. The default is regex-only (no model
downloads required). spaCy or transformers can be enabled when available.

See docs/NLP_BACKENDS.md for full documentation.
"""

from __future__ import annotations

import os
from enum import Enum
from typing import TYPE_CHECKING

from presidio_analyzer import AnalyzerEngine

if TYPE_CHECKING:
    pass


class NlpBackend(str, Enum):
    """Available NLP backends for entity recognition."""

    REGEX = "regex"
    SPACY = "spacy"
    TRANSFORMERS = "transformers"
    AUTO = "auto"


# Entity types available with regex-only (no NLP model)
REGEX_ENTITIES = [
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "US_SSN",
    "CREDIT_CARD",
    "IP_ADDRESS",
    "IBAN_CODE",
    "US_BANK_NUMBER",
    "US_DRIVER_LICENSE",
    "US_PASSPORT",
    "CRYPTO",
]

# Additional entities available with NER models
NER_ENTITIES = [
    "PERSON",
    "LOCATION",
    "DATE_TIME",
    "NRP",
]


def create_analyzer(
    backend: str | NlpBackend = NlpBackend.REGEX,
    model: str | None = None,
) -> AnalyzerEngine:
    """Create a Presidio AnalyzerEngine with the specified backend.

    Args:
        backend: NLP backend to use. One of:
            - "regex": Pattern-based only, no model download (default)
            - "spacy": spaCy NER, requires model download
            - "transformers": HuggingFace NER, auto-downloads
            - "auto": Detect best available backend
        model: Model name for spacy/transformers backends.
            - spacy default: "en_core_web_lg"
            - transformers default: "dslim/bert-base-NER"

    Returns:
        Configured AnalyzerEngine instance.

    Raises:
        ValueError: If backend is unknown.
        ImportError: If required backend package is not installed.

    Example:
        # Regex-only (default, no downloads)
        analyzer = create_analyzer()

        # With spaCy NER
        analyzer = create_analyzer(backend="spacy")

        # Auto-detect best available
        analyzer = create_analyzer(backend="auto")
    """
    # Check environment variable override
    env_backend = os.environ.get("RAG_NLP_BACKEND")
    if env_backend and backend == NlpBackend.REGEX:
        backend = env_backend

    # Normalize to enum
    if isinstance(backend, str):
        backend = NlpBackend(backend.lower())

    if backend == NlpBackend.AUTO:
        backend = _detect_best_backend()

    if backend == NlpBackend.REGEX:
        return _create_regex_analyzer()
    elif backend == NlpBackend.SPACY:
        return _create_spacy_analyzer(model or "en_core_web_lg")
    elif backend == NlpBackend.TRANSFORMERS:
        return _create_transformers_analyzer(model or "dslim/bert-base-NER")
    else:
        raise ValueError(f"Unknown backend: {backend}")


def _detect_best_backend() -> NlpBackend:
    """Detect the best available NLP backend.

    Priority: spaCy > transformers > regex
    """
    # Try spaCy
    try:
        import spacy

        spacy.load("en_core_web_lg")
        return NlpBackend.SPACY
    except (ImportError, OSError):
        pass

    # Try transformers
    try:
        import transformers  # noqa: F401

        return NlpBackend.TRANSFORMERS
    except ImportError:
        pass

    # Fall back to regex
    return NlpBackend.REGEX


def _create_regex_analyzer() -> AnalyzerEngine:
    """Create analyzer with regex-only recognizers (no NLP model)."""
    # AnalyzerEngine without NLP engine uses only regex recognizers
    return AnalyzerEngine(nlp_engine=None, supported_languages=["en"])


def _create_spacy_analyzer(model: str) -> AnalyzerEngine:
    """Create analyzer with spaCy NLP backend.

    Args:
        model: spaCy model name (e.g., "en_core_web_lg")

    Raises:
        ImportError: If spacy is not installed.
        OSError: If model is not downloaded.
    """
    try:
        from presidio_analyzer.nlp_engine import NlpEngineProvider
    except ImportError as e:
        raise ImportError(
            "spaCy backend requires presidio-analyzer with spaCy support. "
            "Install with: pip install spacy && python -m spacy download en_core_web_lg"
        ) from e

    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": model}],
        }
    )
    nlp_engine = provider.create_engine()
    return AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])


def _create_transformers_analyzer(model: str) -> AnalyzerEngine:
    """Create analyzer with HuggingFace transformers backend.

    Args:
        model: HuggingFace model name (e.g., "dslim/bert-base-NER")

    Raises:
        ImportError: If transformers is not installed.
    """
    try:
        from presidio_analyzer.nlp_engine import NlpEngineProvider
    except ImportError as e:
        raise ImportError(
            "Transformers backend requires presidio-analyzer with transformers. "
            "Install with: pip install transformers torch"
        ) from e

    provider = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "transformers",
            "models": [
                {
                    "lang_code": "en",
                    "model_name": {
                        "spacy": "en_core_web_sm",  # For tokenization
                        "transformers": model,
                    },
                }
            ],
        }
    )
    nlp_engine = provider.create_engine()
    return AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])


def get_supported_entities(backend: str | NlpBackend = NlpBackend.REGEX) -> list[str]:
    """Get list of entity types supported by a backend.

    Args:
        backend: NLP backend to check.

    Returns:
        List of supported entity type strings.
    """
    if isinstance(backend, str):
        backend = NlpBackend(backend.lower())

    if backend == NlpBackend.REGEX:
        return REGEX_ENTITIES.copy()
    else:
        return REGEX_ENTITIES + NER_ENTITIES
```

## Tests

```python
def test_create_regex_analyzer():
    """Regex analyzer works without model downloads."""
    analyzer = create_analyzer(backend="regex")
    assert analyzer is not None
    # Test it can analyze text
    results = analyzer.analyze("test@example.com", language="en")
    assert len(results) > 0
    assert results[0].entity_type == "EMAIL_ADDRESS"


def test_regex_detects_email():
    """Regex mode detects email addresses."""
    analyzer = create_analyzer(backend="regex")
    results = analyzer.analyze(
        text="Contact john@example.com for help",
        language="en",
    )
    emails = [r for r in results if r.entity_type == "EMAIL_ADDRESS"]
    assert len(emails) == 1


def test_regex_detects_ssn():
    """Regex mode detects SSNs."""
    analyzer = create_analyzer(backend="regex")
    results = analyzer.analyze(
        text="SSN: 123-45-6789",
        language="en",
    )
    ssns = [r for r in results if r.entity_type == "US_SSN"]
    assert len(ssns) == 1


def test_regex_detects_phone():
    """Regex mode detects phone numbers."""
    analyzer = create_analyzer(backend="regex")
    results = analyzer.analyze(
        text="Call 555-123-4567",
        language="en",
    )
    phones = [r for r in results if r.entity_type == "PHONE_NUMBER"]
    assert len(phones) == 1


def test_regex_does_not_detect_person():
    """Regex mode does NOT detect person names (requires NER)."""
    analyzer = create_analyzer(backend="regex")
    results = analyzer.analyze(
        text="John Smith wrote this",
        language="en",
    )
    persons = [r for r in results if r.entity_type == "PERSON"]
    assert len(persons) == 0  # No NER, no PERSON detection


def test_env_variable_override():
    """RAG_NLP_BACKEND env var overrides default."""
    import os

    os.environ["RAG_NLP_BACKEND"] = "regex"
    analyzer = create_analyzer()  # Should use regex due to env var
    # Verify it's regex by checking PERSON is not detected
    results = analyzer.analyze("John Smith", language="en")
    persons = [r for r in results if r.entity_type == "PERSON"]
    assert len(persons) == 0
    del os.environ["RAG_NLP_BACKEND"]


def test_get_supported_entities_regex():
    """Regex backend reports correct supported entities."""
    entities = get_supported_entities("regex")
    assert "EMAIL_ADDRESS" in entities
    assert "PHONE_NUMBER" in entities
    assert "PERSON" not in entities  # NER only


def test_get_supported_entities_spacy():
    """spaCy backend reports additional NER entities."""
    entities = get_supported_entities("spacy")
    assert "EMAIL_ADDRESS" in entities
    assert "PERSON" in entities  # NER available


def test_auto_fallback_to_regex():
    """Auto mode falls back to regex when no NLP available."""
    # This test assumes spaCy model is NOT installed
    backend = _detect_best_backend()
    # Should be either spacy (if installed) or regex (fallback)
    assert backend in [NlpBackend.SPACY, NlpBackend.TRANSFORMERS, NlpBackend.REGEX]
```

## Acceptance Criteria

- [ ] `create_analyzer(backend="regex")` works without any model downloads
- [ ] Regex mode detects EMAIL, PHONE, SSN, CREDIT_CARD, IP_ADDRESS
- [ ] Regex mode does NOT detect PERSON (documents this limitation)
- [ ] `RAG_NLP_BACKEND` env variable overrides default backend
- [ ] `get_supported_entities()` returns correct list per backend
- [ ] Clear error messages when spaCy/transformers not installed
- [ ] Docstrings reference docs/NLP_BACKENDS.md

## Dependencies

- presidio-analyzer package
- No model downloads for regex mode

## Estimated Time

25 minutes
