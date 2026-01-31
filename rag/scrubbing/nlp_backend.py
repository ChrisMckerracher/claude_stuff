"""Pluggable NLP backend for Presidio analyzer.

This module provides a factory function to create Presidio AnalyzerEngine
instances with different NLP backends. The default is regex-only (no model
downloads required). spaCy or transformers can be enabled when available.

See docs/NLP_BACKENDS.md for full documentation.
"""

from __future__ import annotations

import os
from enum import Enum

from presidio_analyzer import AnalyzerEngine


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
    """Create analyzer with regex-only recognizers (no NLP model).

    Uses a minimal NLP engine that doesn't require model downloads.
    """
    from presidio_analyzer.nlp_engine import NlpArtifacts, NlpEngine

    # Create a minimal NLP engine that doesn't load any models
    # This prevents Presidio from trying to download spaCy models
    class MinimalNlpEngine(NlpEngine):
        """Minimal NLP engine that does no processing."""

        def __init__(self) -> None:
            self._supported_languages = ["en"]

        def load(self) -> None:
            """No-op load since we don't use any models."""
            pass

        def is_loaded(self) -> bool:
            """Always loaded since we don't need any models."""
            return True

        def process_text(self, text: str, language: str) -> NlpArtifacts:  # type: ignore[override]
            """Return empty result - we only use regex recognizers."""
            return NlpArtifacts(
                entities=[],
                tokens=[],
                lemmas=[],
                tokens_indices=[],
                nlp_engine=self,
                language=language,
            )

        def process_batch(
            self,
            texts: list[str],
            language: str,
        ) -> list[NlpArtifacts]:
            """Process batch - return empty results."""
            return [self.process_text(text, language) for text in texts]

        def get_supported_languages(self) -> list[str]:
            """Return supported languages."""
            return self._supported_languages

        def get_supported_entities(self) -> list[str]:
            """Return empty list - no NER entities without a model."""
            return []

        def is_stopword(self, word: str, language: str) -> bool:
            """No stopword detection without a model."""
            return False

        def is_punct(self, word: str, language: str) -> bool:
            """Basic punctuation detection."""
            return word in ".,;:!?()[]{}\"'-"

    return AnalyzerEngine(nlp_engine=MinimalNlpEngine(), supported_languages=["en"])


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
