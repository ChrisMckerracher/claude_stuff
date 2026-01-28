"""Secret detection using detect-secrets.

Detects API keys, tokens, connection strings, and other secrets
that should be scrubbed from text before indexing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from detect_secrets import main as detect_secrets_main
from detect_secrets.core.scan import scan_line


@dataclass
class SecretFinding:
    """A detected secret in text."""

    secret_type: str
    line_number: int
    start: int
    end: int


def detect_secrets_in_text(text: str) -> list[SecretFinding]:
    """Detect API keys, tokens, connection strings using detect-secrets.

    Args:
        text: The text to scan for secrets

    Returns:
        List of SecretFinding objects with type and location
    """
    findings: list[SecretFinding] = []

    # Split into lines for line-by-line scanning
    lines = text.split("\n")
    current_pos = 0

    for line_num, line in enumerate(lines, start=1):
        # Use detect-secrets' scan_line function
        line_findings = _scan_line_for_secrets(line, line_num)

        # Adjust positions to be relative to full text
        for finding in line_findings:
            findings.append(
                SecretFinding(
                    secret_type=finding.secret_type,
                    line_number=finding.line_number,
                    start=current_pos + finding.start,
                    end=current_pos + finding.end,
                )
            )

        current_pos += len(line) + 1  # +1 for newline

    return findings


def _scan_line_for_secrets(line: str, line_number: int) -> list[SecretFinding]:
    """Scan a single line for secrets using detect-secrets and custom patterns.

    Args:
        line: The line to scan
        line_number: The line number (1-indexed)

    Returns:
        List of SecretFinding objects found in this line
    """
    findings: list[SecretFinding] = []

    # Use detect-secrets built-in scanning
    try:
        for plugin_result in scan_line(line):
            # plugin_result is a PotentialSecret object
            secret_value = plugin_result.secret_value or ""
            start = line.find(secret_value) if secret_value else 0
            end = start + len(secret_value) if secret_value else len(line)
            findings.append(
                SecretFinding(
                    secret_type=plugin_result.type,
                    line_number=line_number,
                    start=start,
                    end=end,
                )
            )
    except Exception:
        # If detect-secrets fails, fall back to custom patterns
        pass

    # Additional custom pattern matching for common secrets
    custom_findings = _match_custom_patterns(line, line_number)
    findings.extend(custom_findings)

    return findings


def _match_custom_patterns(line: str, line_number: int) -> list[SecretFinding]:
    """Match custom secret patterns not covered by detect-secrets.

    Args:
        line: The line to scan
        line_number: The line number (1-indexed)

    Returns:
        List of SecretFinding objects found via custom patterns
    """
    findings: list[SecretFinding] = []

    # AWS Access Key ID pattern
    aws_key_pattern = r"AKIA[0-9A-Z]{16}"
    for match in re.finditer(aws_key_pattern, line):
        findings.append(
            SecretFinding(
                secret_type="AWS Access Key",
                line_number=line_number,
                start=match.start(),
                end=match.end(),
            )
        )

    # Generic API key patterns (key = "...", api_key: "...", etc.)
    api_key_patterns = [
        r'["\']?(?:api[_-]?key|apikey|secret[_-]?key|auth[_-]?token|access[_-]?token)["\']?\s*[:=]\s*["\']([a-zA-Z0-9_\-]{20,})["\']',
        r'sk-[a-zA-Z0-9]{20,}',  # OpenAI style keys
        r'ghp_[a-zA-Z0-9]{36}',  # GitHub personal access tokens
        r'gho_[a-zA-Z0-9]{36}',  # GitHub OAuth tokens
        r'ghs_[a-zA-Z0-9]{36}',  # GitHub server tokens
    ]

    for pattern in api_key_patterns:
        for match in re.finditer(pattern, line, re.IGNORECASE):
            findings.append(
                SecretFinding(
                    secret_type="API Key",
                    line_number=line_number,
                    start=match.start(),
                    end=match.end(),
                )
            )

    # Connection string patterns
    conn_string_patterns = [
        r'(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)://[^\s"\']+',
        r'Server\s*=\s*[^;]+;\s*Database\s*=\s*[^;]+;\s*(?:User\s*Id|Uid)\s*=\s*[^;]+;\s*(?:Password|Pwd)\s*=\s*[^;]+',
    ]

    for pattern in conn_string_patterns:
        for match in re.finditer(pattern, line, re.IGNORECASE):
            findings.append(
                SecretFinding(
                    secret_type="Connection String",
                    line_number=line_number,
                    start=match.start(),
                    end=match.end(),
                )
            )

    return findings


def redact_secrets(text: str, findings: list[SecretFinding]) -> str:
    """Replace detected secrets with redaction markers.

    Args:
        text: The original text
        findings: List of SecretFinding objects to redact

    Returns:
        Text with secrets replaced by [REDACTED_SECRET]
    """
    if not findings:
        return text

    # Sort findings by start position in reverse order
    # This allows us to replace from end to start without position shifts
    sorted_findings = sorted(findings, key=lambda f: f.start, reverse=True)

    result = text
    for finding in sorted_findings:
        result = (
            result[: finding.start]
            + f"[REDACTED_{finding.secret_type.upper().replace(' ', '_')}]"
            + result[finding.end :]
        )

    return result
