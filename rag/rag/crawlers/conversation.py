"""Conversation crawlers: Slack exports and meeting transcripts.

Handles thread-based chunking for conversation content.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator

from rag.boundary.service_refs import extract_service_refs
from rag.chunking.thread_chunker import chunk_slack_messages, chunk_transcript
from rag.config import SOURCE_TYPES
from rag.models.chunk import RawChunk, make_chunk_id
from rag.models.types import CrawlSource, SourceKind


class SlackCrawler:
    """Crawls Slack JSON exports and yields thread-based chunks.

    Expects Slack export format with channels as directories or a
    single JSON file with channel data.

    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    def __init__(self, known_services: set[str] | None = None) -> None:
        """Initialize the Slack crawler.

        Args:
            known_services: Set of known service names for reference extraction.
                           If None, service refs won't be extracted.
        """
        self._known_services = known_services or set()

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"CONVO_SLACK"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from Slack export.

        Args:
            source: CrawlSource with path to Slack export

        Yields:
            RawChunk for each thread found
        """
        if source.source_kind != SourceKind.SLACK_EXPORT:
            return

        path = source.path

        if path.is_file():
            # Single JSON file
            yield from self._process_json_file(path, source)
        elif path.is_dir():
            # Directory of channel exports
            yield from self._process_export_dir(path, source)

    def _process_export_dir(
        self, root: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a Slack export directory.

        Standard Slack export structure:
        export/
        ├── channel-name/
        │   ├── 2024-01-15.json
        │   ├── 2024-01-16.json
        │   └── ...
        └── another-channel/
            └── ...
        """
        for entry in root.iterdir():
            if entry.is_dir() and not entry.name.startswith("."):
                # Channel directory
                channel_name = entry.name
                messages: list[dict[str, Any]] = []

                # Read all JSON files in channel
                for json_file in sorted(entry.glob("*.json")):
                    try:
                        content = json_file.read_text(encoding="utf-8")
                        day_messages = json.loads(content)
                        if isinstance(day_messages, list):
                            messages.extend(day_messages)
                    except (OSError, json.JSONDecodeError):
                        continue

                # Process channel messages
                yield from self._process_channel(
                    messages, channel_name, source, f"{channel_name}/"
                )
            elif entry.is_file() and entry.suffix == ".json":
                # Single JSON file at root
                yield from self._process_json_file(entry, source)

    def _process_json_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a single Slack JSON file.

        Supports two formats:
        1. Array of messages (single channel export)
        2. Object with "channels" key containing channel data
        """
        try:
            content = file_path.read_text(encoding="utf-8")
            data = json.loads(content)
        except (OSError, json.JSONDecodeError):
            return

        if isinstance(data, list):
            # Array of messages - use filename as channel name
            channel_name = file_path.stem
            yield from self._process_channel(
                data, channel_name, source, file_path.name
            )
        elif isinstance(data, dict):
            # Object format - check for channels key
            channels = data.get("channels", {})
            if isinstance(channels, dict):
                for channel_name, messages in channels.items():
                    if isinstance(messages, list):
                        yield from self._process_channel(
                            messages, channel_name, source, file_path.name
                        )

    def _process_channel(
        self,
        messages: list[dict[str, Any]],
        channel_name: str,
        source: CrawlSource,
        source_file: str,
    ) -> Iterator[RawChunk]:
        """Process messages from a single channel.

        Args:
            messages: List of Slack message dictionaries
            channel_name: Name of the channel
            source: CrawlSource for context
            source_file: Source file/directory name for URI

        Yields:
            RawChunk for each thread
        """
        # Chunk by thread
        thread_chunks = chunk_slack_messages(messages, channel_name)
        source_type = SOURCE_TYPES["CONVO_SLACK"]

        for chunk_data in thread_chunks:
            # Extract service references if we have known services
            calls_out: list[str] = []
            if self._known_services:
                calls_out = extract_service_refs(chunk_data.text, self._known_services)

            source_uri = f"{source_file}#{channel_name}"
            if chunk_data.thread_id:
                source_uri = f"{source_uri}:{chunk_data.thread_id}"

            yield RawChunk(
                id=make_chunk_id(
                    source_uri, chunk_data.byte_start, chunk_data.byte_end
                ),
                source_uri=source_uri,
                byte_range=(chunk_data.byte_start, chunk_data.byte_end),
                source_type=source_type,
                text=chunk_data.text,
                context_prefix=chunk_data.context_prefix,
                repo_name=source.repo_name,
                author=chunk_data.author,
                channel=chunk_data.channel,
                thread_id=chunk_data.thread_id,
                timestamp=chunk_data.timestamp,
                calls_out=calls_out,
            )


class TranscriptCrawler:
    """Crawls meeting transcript files and yields speaker-turn chunks.

    Expects plain text transcripts with format:
    [10:30] Alice: Some text here.
    [10:31] Bob: Response text.

    Implements the Crawler protocol from rag.pipeline.protocols.
    """

    def __init__(self, known_services: set[str] | None = None) -> None:
        """Initialize the transcript crawler.

        Args:
            known_services: Set of known service names for reference extraction.
        """
        self._known_services = known_services or set()

    @property
    def corpus_types(self) -> frozenset[str]:
        """Which corpus_types this crawler produces."""
        return frozenset({"CONVO_TRANSCRIPT"})

    def crawl(self, source: CrawlSource) -> Iterator[RawChunk]:
        """Yield RawChunks from transcript files.

        Args:
            source: CrawlSource with path to transcript directory or file

        Yields:
            RawChunk for each speaker-turn group
        """
        if source.source_kind != SourceKind.TRANSCRIPT_DIR:
            return

        for file_path in self._walk_transcript_files(source.path):
            yield from self._process_file(file_path, source)

    def _walk_transcript_files(self, root: Path) -> Iterator[Path]:
        """Walk directory and yield transcript files.

        Looks for .txt, .transcript, and .md files.
        """
        if not root.is_dir():
            if root.suffix.lower() in (".txt", ".transcript", ".md"):
                yield root
            return

        for entry in root.iterdir():
            if entry.is_dir():
                if not entry.name.startswith("."):
                    yield from self._walk_transcript_files(entry)
            elif entry.is_file():
                if entry.suffix.lower() in (".txt", ".transcript", ".md"):
                    yield entry

    def _process_file(
        self, file_path: Path, source: CrawlSource
    ) -> Iterator[RawChunk]:
        """Process a transcript file and yield chunks.

        Args:
            file_path: Path to transcript file
            source: CrawlSource for context

        Yields:
            RawChunk for each speaker-turn group
        """
        try:
            content = file_path.read_bytes()
        except (OSError, IOError):
            return

        # Get relative path
        if source.path.is_file():
            relative_path = file_path.name
        else:
            try:
                relative_path = str(file_path.relative_to(source.path))
            except ValueError:
                relative_path = str(file_path)

        # Chunk the transcript
        chunks = chunk_transcript(content, relative_path)
        source_type = SOURCE_TYPES["CONVO_TRANSCRIPT"]

        for chunk_data in chunks:
            # Extract service references
            calls_out: list[str] = []
            if self._known_services:
                calls_out = extract_service_refs(chunk_data.text, self._known_services)

            yield RawChunk(
                id=make_chunk_id(
                    relative_path, chunk_data.byte_start, chunk_data.byte_end
                ),
                source_uri=relative_path,
                byte_range=(chunk_data.byte_start, chunk_data.byte_end),
                source_type=source_type,
                text=chunk_data.text,
                context_prefix=chunk_data.context_prefix,
                repo_name=source.repo_name,
                file_path=relative_path,
                author=chunk_data.author,
                timestamp=chunk_data.timestamp,
                calls_out=calls_out,
            )
