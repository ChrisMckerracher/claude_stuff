# Task 6.3: Conversation Crawler

**Status:** [ ] Not Started  |  [ ] In Progress  |  [ ] Complete

## Objective

Implement a crawler for Slack exports and transcript files.

## File

`rag/crawlers/conversation.py`

## Implementation

```python
import json
from pathlib import Path
from typing import Iterator
from rag.core.types import CrawlSource, CrawlResult
from rag.core.protocols import Crawler

class ConversationCrawler:
    """Crawl Slack exports and transcript files.

    Supports:
    - Slack export directories (JSON files per channel)
    - Plain text transcript files
    """

    def crawl(self, source: CrawlSource) -> Iterator[CrawlResult]:
        """Yield conversation content from source.

        Args:
            source: CrawlSource with type "slack_export" or "transcript"

        Yields:
            CrawlResult for each conversation file/channel
        """
        if source.type == "slack_export":
            yield from self._crawl_slack(source.path, source.metadata)
        elif source.type == "transcript":
            yield from self._crawl_transcript(source.path, source.metadata)
        elif source.type == "directory":
            # Auto-detect based on content
            yield from self._crawl_auto(source.path, source.metadata)

    def _crawl_slack(
        self,
        export_path: str,
        metadata: dict,
    ) -> Iterator[CrawlResult]:
        """Crawl Slack export directory.

        Expected structure:
        export/
        ├── channels.json
        ├── users.json
        └── channel-name/
            ├── 2024-01-01.json
            └── 2024-01-02.json
        """
        root = Path(export_path)

        # Find channel directories
        for channel_dir in root.iterdir():
            if not channel_dir.is_dir():
                continue
            if channel_dir.name.startswith("."):
                continue

            # Aggregate all messages in channel
            messages = []
            for json_file in sorted(channel_dir.glob("*.json")):
                try:
                    data = json.loads(json_file.read_text())
                    if isinstance(data, list):
                        messages.extend(data)
                except Exception:
                    continue

            if not messages:
                continue

            # Serialize channel messages
            content = json.dumps(messages).encode("utf-8")

            yield CrawlResult(
                content=content,
                source_uri=f"slack://{channel_dir.name}",
                language=None,
                metadata={
                    **metadata,
                    "channel": channel_dir.name,
                    "message_count": len(messages),
                    "format": "slack_json",
                },
            )

    def _crawl_transcript(
        self,
        transcript_path: str,
        metadata: dict,
    ) -> Iterator[CrawlResult]:
        """Crawl transcript files.

        Supports plain text transcripts with format:
        Speaker: Message text
        """
        path = Path(transcript_path)

        if path.is_file():
            yield self._read_transcript(path, metadata)
        elif path.is_dir():
            for file in path.glob("**/*.txt"):
                yield self._read_transcript(file, metadata)

    def _read_transcript(self, path: Path, metadata: dict) -> CrawlResult:
        """Read a single transcript file."""
        content = path.read_bytes()

        return CrawlResult(
            content=content,
            source_uri=str(path),
            language=None,
            metadata={
                **metadata,
                "format": "transcript",
                "filename": path.name,
            },
        )

    def _crawl_auto(
        self,
        dir_path: str,
        metadata: dict,
    ) -> Iterator[CrawlResult]:
        """Auto-detect format and crawl."""
        root = Path(dir_path)

        # Check for Slack export markers
        if (root / "channels.json").exists() or (root / "users.json").exists():
            yield from self._crawl_slack(dir_path, metadata)
            return

        # Look for JSON files that look like Slack exports
        for json_file in root.rglob("*.json"):
            try:
                data = json.loads(json_file.read_text())
                if isinstance(data, list) and data and "type" in data[0]:
                    # Looks like Slack messages
                    yield CrawlResult(
                        content=json_file.read_bytes(),
                        source_uri=str(json_file),
                        language=None,
                        metadata={**metadata, "format": "slack_json"},
                    )
            except Exception:
                continue

        # Fall back to text files as transcripts
        for txt_file in root.rglob("*.txt"):
            yield self._read_transcript(txt_file, metadata)
```

## Tests

```python
def test_crawl_slack_export(tmp_path):
    # Create Slack export structure
    channel = tmp_path / "general"
    channel.mkdir()
    (channel / "2024-01-01.json").write_text(json.dumps([
        {"type": "message", "user": "U123", "text": "Hello"},
        {"type": "message", "user": "U456", "text": "Hi there"},
    ]))

    crawler = ConversationCrawler()
    results = list(crawler.crawl(CrawlSource("slack_export", str(tmp_path), {})))

    assert len(results) == 1
    assert results[0].metadata["channel"] == "general"
    assert results[0].metadata["message_count"] == 2

def test_crawl_transcript(tmp_path):
    (tmp_path / "meeting.txt").write_text("""
Alice: Let's discuss the auth service
Bob: I think we should add caching
Alice: Good idea
""")

    crawler = ConversationCrawler()
    results = list(crawler.crawl(CrawlSource("transcript", str(tmp_path), {})))

    assert len(results) == 1
    assert results[0].metadata["format"] == "transcript"

def test_auto_detects_slack(tmp_path):
    (tmp_path / "channels.json").write_text("[]")
    channel = tmp_path / "random"
    channel.mkdir()
    (channel / "2024-01-01.json").write_text('[{"type": "message", "text": "hi"}]')

    crawler = ConversationCrawler()
    results = list(crawler.crawl(CrawlSource("directory", str(tmp_path), {})))

    assert any(r.metadata.get("format") == "slack_json" for r in results)

def test_aggregates_channel_messages(tmp_path):
    channel = tmp_path / "dev"
    channel.mkdir()
    (channel / "2024-01-01.json").write_text('[{"text": "day1"}]')
    (channel / "2024-01-02.json").write_text('[{"text": "day2"}]')

    crawler = ConversationCrawler()
    results = list(crawler.crawl(CrawlSource("slack_export", str(tmp_path), {})))

    assert len(results) == 1
    assert results[0].metadata["message_count"] == 2
```

## Acceptance Criteria

- [ ] Implements Crawler protocol
- [ ] Crawls Slack export directory structure
- [ ] Aggregates messages per channel
- [ ] Reads plain text transcripts
- [ ] Auto-detects format when type="directory"
- [ ] Metadata includes message_count and format

## Estimated Time

30 minutes
