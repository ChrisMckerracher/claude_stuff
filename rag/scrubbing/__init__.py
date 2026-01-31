"""PHI scrubbing module.

Provides PII detection and replacement using Presidio with pluggable NLP backends.
See docs/NLP_BACKENDS.md for backend configuration options.

Default: regex-only mode (no model downloads required).
Optional: spaCy or transformers for PERSON/LOCATION detection.
"""

from rag.scrubbing.nlp_backend import NlpBackend, create_analyzer, get_supported_entities
from rag.scrubbing.pseudonymizer import Pseudonymizer
from rag.scrubbing.scrubber import PresidioScrubber

__all__ = [
    "PresidioScrubber",
    "Pseudonymizer",
    "create_analyzer",
    "get_supported_entities",
    "NlpBackend",
]
