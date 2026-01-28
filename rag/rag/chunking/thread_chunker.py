"""Thread chunker for Slack messages and meeting transcripts.

Groups messages by thread and preserves speaker attribution.
Never splits mid-message.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from rag.chunking.token_counter import count_tokens


# Maximum tokens per chunk (uses model tokenizer for accurate counting)
MAX_TOKENS = 2048
# Target tokens for chunking
TARGET_TOKENS = 1600


@dataclass
class ThreadChunkData:
    """Intermediate output of the thread chunker.

    The ConversationCrawler wraps this into a RawChunk.
    """

    text: str
    byte_start: int
    byte_end: int
    context_prefix: str
    author: str | None
    channel: str | None
    thread_id: str | None
    timestamp: str | None
    participants: list[str] = field(default_factory=list)


@dataclass
class SlackMessage:
    """A single Slack message."""

    ts: str
    thread_ts: str | None
    user: str
    text: str


def _ts_to_iso(ts: str) -> str:
    """Convert Slack timestamp to ISO 8601 format.

    Slack timestamps are Unix timestamps with microseconds: "1705312200.000100"

    Args:
        ts: Slack timestamp string

    Returns:
        ISO 8601 formatted datetime string
    """
    try:
        # Slack ts format: "1705312200.000100" (seconds.microseconds)
        seconds = float(ts)
        dt = datetime.utcfromtimestamp(seconds)
        return dt.isoformat() + "Z"
    except (ValueError, OSError):
        return ts


def chunk_slack_messages(
    messages: list[dict[str, Any]],
    channel_name: str,
) -> list[ThreadChunkData]:
    """Group Slack messages into thread-based chunks.

    Messages are grouped by thread_ts. Messages without thread_ts are
    standalone (their own ts is the thread). Each thread becomes one
    chunk unless it exceeds MAX_TOKENS.

    Args:
        messages: List of Slack message dictionaries
        channel_name: Name of the channel

    Returns:
        List of ThreadChunkData with grouped messages
    """
    # Group messages by thread
    threads: dict[str, list[SlackMessage]] = {}

    for msg in messages:
        if not isinstance(msg, dict):
            continue

        ts = msg.get("ts", "")
        if not ts:
            continue

        # Get thread parent (or use own ts if standalone)
        thread_ts_raw = msg.get("thread_ts", ts)
        thread_ts: str = str(thread_ts_raw) if thread_ts_raw else ts

        user_raw = msg.get("user", "unknown")
        user: str = str(user_raw) if user_raw else "unknown"
        text_raw = msg.get("text", "")
        text: str = str(text_raw) if text_raw else ""

        # Skip empty messages and bot messages
        if not text.strip():
            continue

        slack_msg = SlackMessage(
            ts=ts,
            thread_ts=thread_ts if thread_ts != ts else None,
            user=user,
            text=text,
        )

        if thread_ts not in threads:
            threads[thread_ts] = []
        threads[thread_ts].append(slack_msg)

    # Sort messages within each thread by timestamp
    for thread_ts in threads:
        threads[thread_ts].sort(key=lambda m: m.ts)

    # Convert threads to chunks
    chunks: list[ThreadChunkData] = []
    byte_offset = 0

    for thread_ts, thread_messages in sorted(threads.items()):
        thread_chunks = _chunk_thread(
            thread_messages,
            channel_name,
            thread_ts,
            byte_offset,
        )
        chunks.extend(thread_chunks)

        # Update byte offset
        for tc in thread_chunks:
            byte_offset = tc.byte_end

    return chunks


def _chunk_thread(
    messages: list[SlackMessage],
    channel_name: str,
    thread_ts: str,
    byte_offset: int,
) -> list[ThreadChunkData]:
    """Convert a single thread into one or more chunks.

    If the thread exceeds MAX_TOKENS, splits at message boundaries.

    Args:
        messages: List of messages in the thread
        channel_name: Name of the channel
        thread_ts: Thread parent timestamp
        byte_offset: Current byte offset

    Returns:
        List of ThreadChunkData (usually just one)
    """
    if not messages:
        return []

    # Format messages
    formatted: list[str] = []
    participants: set[str] = set()

    for msg in messages:
        timestamp = _ts_to_iso(msg.ts)
        formatted.append(f"[{timestamp}] @{msg.user}: {msg.text}")
        participants.add(msg.user)

    # Check total size
    full_text = "\n".join(formatted)
    total_tokens = count_tokens(full_text)

    if total_tokens <= MAX_TOKENS:
        # Single chunk for whole thread
        first_author = messages[0].user
        first_ts = _ts_to_iso(messages[0].ts)
        context_prefix = f"#{channel_name} > @{first_author} > {first_ts}"

        return [
            ThreadChunkData(
                text=full_text,
                byte_start=byte_offset,
                byte_end=byte_offset + len(full_text.encode("utf-8")),
                context_prefix=context_prefix,
                author=first_author,
                channel=channel_name,
                thread_id=thread_ts,
                timestamp=first_ts,
                participants=list(participants),
            )
        ]

    # Split at message boundaries
    chunks: list[ThreadChunkData] = []
    current_messages: list[str] = []
    current_tokens = 0
    current_participants: set[str] = set()
    first_msg_idx = 0

    for i, (msg, formatted_msg) in enumerate(zip(messages, formatted)):
        msg_tokens = count_tokens(formatted_msg)

        if current_tokens + msg_tokens > MAX_TOKENS and current_messages:
            # Create chunk from current messages
            chunk_text = "\n".join(current_messages)
            first_author = messages[first_msg_idx].user
            first_ts = _ts_to_iso(messages[first_msg_idx].ts)
            context_prefix = f"#{channel_name} > @{first_author} > {first_ts}"

            chunks.append(
                ThreadChunkData(
                    text=chunk_text,
                    byte_start=byte_offset,
                    byte_end=byte_offset + len(chunk_text.encode("utf-8")),
                    context_prefix=context_prefix,
                    author=first_author,
                    channel=channel_name,
                    thread_id=thread_ts,
                    timestamp=first_ts,
                    participants=list(current_participants),
                )
            )

            byte_offset = chunks[-1].byte_end + 1  # +1 for newline
            current_messages = []
            current_tokens = 0
            current_participants = set()
            first_msg_idx = i

        current_messages.append(formatted_msg)
        current_tokens += msg_tokens
        current_participants.add(msg.user)

    # Don't forget the last chunk
    if current_messages:
        chunk_text = "\n".join(current_messages)
        first_author = messages[first_msg_idx].user
        first_ts = _ts_to_iso(messages[first_msg_idx].ts)
        context_prefix = f"#{channel_name} > @{first_author} > {first_ts}"

        chunks.append(
            ThreadChunkData(
                text=chunk_text,
                byte_start=byte_offset,
                byte_end=byte_offset + len(chunk_text.encode("utf-8")),
                context_prefix=context_prefix,
                author=first_author,
                channel=channel_name,
                thread_id=thread_ts,
                timestamp=first_ts,
                participants=list(current_participants),
            )
        )

    return chunks


# Transcript parsing patterns
TRANSCRIPT_LINE_PATTERN = re.compile(
    r"^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+([^:]+):\s*(.*)$"
)


@dataclass
class TranscriptTurn:
    """A single speaker turn in a transcript."""

    timestamp: str
    speaker: str
    text: str


def chunk_transcript(
    content: bytes,
    file_path: str,
) -> list[ThreadChunkData]:
    """Parse and chunk a meeting transcript.

    Expected format:
    [10:30] Alice: Let's discuss the auth-service migration.
    [10:31] Bob: The user-service dependency is blocking us.

    Groups consecutive speaker turns into chunks of ~TARGET_TOKENS tokens.
    Never splits mid-turn.

    Args:
        content: Raw transcript content bytes
        file_path: Path to file for context prefix

    Returns:
        List of ThreadChunkData with grouped speaker turns
    """
    text = content.decode("utf-8")
    lines = text.split("\n")

    # Parse transcript into turns
    turns: list[TranscriptTurn] = []
    current_turn: TranscriptTurn | None = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        match = TRANSCRIPT_LINE_PATTERN.match(line)
        if match:
            # New speaker turn
            if current_turn:
                turns.append(current_turn)

            timestamp, speaker, text_content = match.groups()
            current_turn = TranscriptTurn(
                timestamp=timestamp,
                speaker=speaker.strip(),
                text=text_content.strip(),
            )
        elif current_turn:
            # Continuation of current turn
            current_turn.text += " " + line

    if current_turn:
        turns.append(current_turn)

    if not turns:
        # No parseable content - return whole file as one chunk
        return [
            ThreadChunkData(
                text=text,
                byte_start=0,
                byte_end=len(content),
                context_prefix=file_path,
                author=None,
                channel=None,
                thread_id=None,
                timestamp=None,
            )
        ]

    # Group turns into chunks
    chunks: list[ThreadChunkData] = []
    current_turns: list[TranscriptTurn] = []
    current_tokens = 0
    current_participants: set[str] = set()
    byte_offset = 0

    for turn in turns:
        formatted = f"[{turn.timestamp}] {turn.speaker}: {turn.text}"
        turn_tokens = count_tokens(formatted)

        if current_tokens + turn_tokens > TARGET_TOKENS and current_turns:
            # Create chunk from current turns
            chunk_text = "\n".join(
                f"[{t.timestamp}] {t.speaker}: {t.text}" for t in current_turns
            )
            first_speaker = current_turns[0].speaker
            first_ts = current_turns[0].timestamp
            context_prefix = f"{file_path} > {first_speaker} > {first_ts}"

            chunks.append(
                ThreadChunkData(
                    text=chunk_text,
                    byte_start=byte_offset,
                    byte_end=byte_offset + len(chunk_text.encode("utf-8")),
                    context_prefix=context_prefix,
                    author=first_speaker,
                    channel=None,
                    thread_id=None,
                    timestamp=first_ts,
                    participants=list(current_participants),
                )
            )

            byte_offset = chunks[-1].byte_end + 1
            current_turns = []
            current_tokens = 0
            current_participants = set()

        current_turns.append(turn)
        current_tokens += turn_tokens
        current_participants.add(turn.speaker)

    # Don't forget the last chunk
    if current_turns:
        chunk_text = "\n".join(
            f"[{t.timestamp}] {t.speaker}: {t.text}" for t in current_turns
        )
        first_speaker = current_turns[0].speaker
        first_ts = current_turns[0].timestamp
        context_prefix = f"{file_path} > {first_speaker} > {first_ts}"

        chunks.append(
            ThreadChunkData(
                text=chunk_text,
                byte_start=byte_offset,
                byte_end=byte_offset + len(chunk_text.encode("utf-8")),
                context_prefix=context_prefix,
                author=first_speaker,
                channel=None,
                thread_id=None,
                timestamp=first_ts,
                participants=list(current_participants),
            )
        )

    return chunks
