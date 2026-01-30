# Task 1.4: Thread Chunker

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Create a chunker for conversation threads that preserves context and speaker attribution.

## File

`rag/chunking/thread_chunker.py`

## Implementation

```python
import json
import re
from typing import Iterator
from dataclasses import dataclass
from datetime import datetime
from rag.core.types import RawChunk, ChunkID, CorpusType
from rag.core.protocols import Chunker
from rag.chunking.token_counter import TokenCounter
from rag.config import MAX_CHUNK_TOKENS

@dataclass
class Message:
    """A single message in a conversation."""
    speaker: str
    text: str
    timestamp: datetime | None
    thread_id: str | None

@dataclass
class Thread:
    """A conversation thread."""
    thread_id: str
    messages: list[Message]


class ThreadChunker:
    """Chunk conversations preserving thread context.

    Groups messages by thread and ensures speaker attribution
    is maintained in each chunk.
    """

    def __init__(
        self,
        token_counter: TokenCounter,
        max_tokens: int = MAX_CHUNK_TOKENS,
    ):
        self._counter = token_counter
        self._max = max_tokens

    def chunk(
        self,
        content: bytes,
        *,
        source_uri: str,
        language: str | None = None,
    ) -> Iterator[RawChunk]:
        """Yield chunks per thread or message group.

        Args:
            content: Conversation content (JSON or plain text)
            source_uri: Source identifier
            language: Ignored for conversations

        Yields:
            RawChunk objects with thread context preserved
        """
        messages = self._parse_messages(content)

        for thread in self._group_by_thread(messages):
            thread_text = self._format_thread(thread)

            if self._counter.count(thread_text) <= self._max:
                yield self._make_chunk(thread, thread_text, source_uri)
            else:
                yield from self._split_thread(thread, source_uri)

    def _parse_messages(self, content: bytes) -> list[Message]:
        """Parse messages from content.

        Supports:
        - Slack export JSON format
        - Simple text format: "Speaker: message"
        - Transcript format with timestamps
        """
        text = content.decode('utf-8', errors='replace')

        # Try JSON first (Slack export)
        try:
            data = json.loads(text)
            return self._parse_slack_json(data)
        except json.JSONDecodeError:
            pass

        # Try simple text format
        return self._parse_text_format(text)

    def _parse_slack_json(self, data: list | dict) -> list[Message]:
        """Parse Slack export JSON."""
        messages = []
        items = data if isinstance(data, list) else data.get('messages', [])

        for item in items:
            if item.get('type') != 'message':
                continue

            messages.append(Message(
                speaker=item.get('user', item.get('username', 'unknown')),
                text=item.get('text', ''),
                timestamp=datetime.fromtimestamp(float(item.get('ts', 0))) if item.get('ts') else None,
                thread_id=item.get('thread_ts'),
            ))

        return messages

    def _parse_text_format(self, text: str) -> list[Message]:
        """Parse simple text format: 'Speaker: message'."""
        messages = []
        pattern = re.compile(r'^([^:]+):\s*(.+)$', re.MULTILINE)

        for match in pattern.finditer(text):
            messages.append(Message(
                speaker=match.group(1).strip(),
                text=match.group(2).strip(),
                timestamp=None,
                thread_id=None,
            ))

        # If no pattern matches, treat entire content as one message
        if not messages and text.strip():
            messages.append(Message(
                speaker="unknown",
                text=text.strip(),
                timestamp=None,
                thread_id=None,
            ))

        return messages

    def _group_by_thread(self, messages: list[Message]) -> Iterator[Thread]:
        """Group messages by thread."""
        threads: dict[str, list[Message]] = {}

        for msg in messages:
            thread_id = msg.thread_id or "main"
            if thread_id not in threads:
                threads[thread_id] = []
            threads[thread_id].append(msg)

        for thread_id, msgs in threads.items():
            yield Thread(thread_id=thread_id, messages=msgs)

    def _format_thread(self, thread: Thread) -> str:
        """Format thread as readable text."""
        lines = []
        for msg in thread.messages:
            timestamp = msg.timestamp.isoformat() if msg.timestamp else ""
            prefix = f"[{timestamp}] " if timestamp else ""
            lines.append(f"{prefix}{msg.speaker}: {msg.text}")
        return '\n'.join(lines)

    def _make_chunk(
        self,
        thread: Thread,
        text: str,
        uri: str,
    ) -> RawChunk:
        """Create RawChunk from thread."""
        corpus_type = CorpusType.CONVO_SLACK if "slack" in uri.lower() else CorpusType.CONVO_TRANSCRIPT

        speakers = list(set(m.speaker for m in thread.messages))

        return RawChunk(
            id=ChunkID.from_content(uri, 0, len(text.encode())),
            text=text,
            source_uri=uri,
            corpus_type=corpus_type,
            byte_range=(0, len(text.encode())),
            metadata={
                "thread_id": thread.thread_id,
                "message_count": len(thread.messages),
                "speakers": speakers,
            },
        )

    def _split_thread(
        self,
        thread: Thread,
        uri: str,
    ) -> Iterator[RawChunk]:
        """Split large thread into smaller chunks.

        Ensures each chunk maintains context by including
        speaker information.
        """
        current_messages = []
        current_tokens = 0

        for msg in thread.messages:
            msg_text = f"{msg.speaker}: {msg.text}"
            msg_tokens = self._counter.count(msg_text)

            if current_tokens + msg_tokens > self._max and current_messages:
                # Yield current chunk
                chunk_thread = Thread(thread_id=thread.thread_id, messages=current_messages)
                chunk_text = self._format_thread(chunk_thread)
                yield self._make_chunk(chunk_thread, chunk_text, uri)

                # Keep last message for context overlap
                current_messages = [current_messages[-1]] if current_messages else []
                current_tokens = self._counter.count(self._format_thread(
                    Thread(thread_id=thread.thread_id, messages=current_messages)
                )) if current_messages else 0

            current_messages.append(msg)
            current_tokens += msg_tokens

        # Yield final chunk
        if current_messages:
            chunk_thread = Thread(thread_id=thread.thread_id, messages=current_messages)
            chunk_text = self._format_thread(chunk_thread)
            yield self._make_chunk(chunk_thread, chunk_text, uri)
```

## Acceptance Criteria

- [ ] Implements Chunker protocol
- [ ] Parses Slack JSON export format
- [ ] Parses simple text conversation format
- [ ] Groups messages by thread
- [ ] Preserves speaker attribution in all chunks
- [ ] Splits large threads with context overlap
- [ ] No chunk exceeds max_tokens

## Dependencies

- Task 1.1 (Token Counter)

## Estimated Time

30 minutes
