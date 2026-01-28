"""PHI Scrubbing module.

Provides the PresidioScrubber implementation that satisfies the Scrubber protocol.
Detects and removes PHI/PII using Microsoft Presidio, detect-secrets, and
consistent pseudonymization via Faker.
"""

from __future__ import annotations

from rag.scrubbing.allowlist import Allowlist, RecognizerResultProtocol
from rag.scrubbing.pseudonymizer import ConsistentPseudonymizer
from rag.scrubbing.recognizers import InternalEmailRecognizer, SlackMentionRecognizer
from rag.scrubbing.scrubber import PresidioScrubber
from rag.scrubbing.secrets import SecretFinding, detect_secrets_in_text

__all__ = [
    "Allowlist",
    "ConsistentPseudonymizer",
    "InternalEmailRecognizer",
    "PresidioScrubber",
    "RecognizerResultProtocol",
    "SecretFinding",
    "SlackMentionRecognizer",
    "detect_secrets_in_text",
]
