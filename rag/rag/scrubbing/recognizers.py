"""Custom Presidio recognizers for domain-specific patterns.

These recognizers extend Presidio's built-in detection with patterns
specific to our use cases (Slack mentions, internal emails, etc.).
"""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from presidio_analyzer import Pattern, PatternRecognizer

if TYPE_CHECKING:
    from presidio_analyzer import RecognizerResult


class SlackMentionRecognizer(PatternRecognizer):
    """Recognize Slack @mentions that contain user identifiers.

    Slack mentions like @john.doe, @jane_smith, or <@U12345678>
    often contain real names or user IDs that should be scrubbed.
    """

    PATTERNS = [
        Pattern(
            "SLACK_DISPLAY_NAME",
            r"@[a-zA-Z][a-zA-Z0-9._-]{1,30}",
            0.6,
        ),
        Pattern(
            "SLACK_USER_ID",
            r"<@U[A-Z0-9]{8,11}>",
            0.85,
        ),
        Pattern(
            "SLACK_USER_ID_WITH_NAME",
            r"<@U[A-Z0-9]{8,11}\|[^>]+>",
            0.9,
        ),
    ]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="PERSON",
            patterns=self.PATTERNS,
            name="SlackMentionRecognizer",
            supported_language="en",
        )


class InternalEmailRecognizer(PatternRecognizer):
    """Recognize internal email addresses with company domains.

    Extends Presidio's email detection with higher confidence for
    emails that match internal domain patterns.
    """

    # Common internal/corporate email patterns
    PATTERNS = [
        Pattern(
            "INTERNAL_EMAIL_FULL",
            r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(internal|corp|local|company|example)\.[a-zA-Z]{2,}",
            0.85,
        ),
        Pattern(
            "INTERNAL_EMAIL_SIMPLE",
            r"[a-zA-Z0-9._%+-]+@(internal|corp|localhost|company-name|acme)",
            0.8,
        ),
    ]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="EMAIL_ADDRESS",
            patterns=self.PATTERNS,
            name="InternalEmailRecognizer",
            supported_language="en",
        )


class MedicalRecordNumberRecognizer(PatternRecognizer):
    """Recognize medical record numbers (MRN).

    MRNs vary by institution but often follow patterns like:
    - 6-10 digit numbers
    - Alphanumeric codes with specific prefixes
    """

    PATTERNS = [
        Pattern(
            "MRN_NUMERIC",
            r"\b(?:MRN|Medical Record|Patient ID)[:\s#]*([0-9]{6,10})\b",
            0.7,
        ),
        Pattern(
            "MRN_ALPHANUMERIC",
            r"\b(?:MRN|Medical Record)[:\s#]*([A-Z]{2,3}[0-9]{6,8})\b",
            0.75,
        ),
    ]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="MEDICAL_LICENSE",  # Reuse existing entity type
            patterns=self.PATTERNS,
            name="MedicalRecordNumberRecognizer",
            supported_language="en",
        )


class IPAddressRecognizer(PatternRecognizer):
    """Enhanced IP address recognizer with IPv4 and IPv6 support.

    More precise than default to reduce false positives on version numbers.
    """

    PATTERNS = [
        # IPv4 - exclude common version patterns like 1.2.3 or 2.0.0
        Pattern(
            "IPV4_STRICT",
            r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b",
            0.6,
        ),
        # IPv6 (simplified)
        Pattern(
            "IPV6",
            r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b",
            0.7,
        ),
    ]

    def __init__(self) -> None:
        super().__init__(
            supported_entity="IP_ADDRESS",
            patterns=self.PATTERNS,
            name="IPAddressRecognizer",
            supported_language="en",
        )


def get_all_custom_recognizers() -> list[PatternRecognizer]:
    """Return all custom recognizers for registration with Presidio.

    Returns:
        List of custom PatternRecognizer instances
    """
    return [
        SlackMentionRecognizer(),
        InternalEmailRecognizer(),
        MedicalRecordNumberRecognizer(),
        IPAddressRecognizer(),
    ]
