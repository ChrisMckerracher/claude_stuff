# Phase 6: Crawlers

## Overview

**Deliverable:** Crawlers for code, docs, and conversations. Testable with local files.

**Custom Code:** ~100 lines

**Dependencies:** GitPython for repo crawling

## Files to Create

| File | Purpose | Lines |
|------|---------|-------|
| `rag/crawlers/code.py` | Git repository code crawler | ~50 |
| `rag/crawlers/docs.py` | Markdown documentation crawler | ~25 |
| `rag/crawlers/conversation.py` | Slack/transcript crawler | ~25 |

## Tasks

- [ ] [Task 1: Code Crawler](task1.md)
- [ ] [Task 2: Docs Crawler](task2.md)
- [ ] [Task 3: Conversation Crawler](task3.md)

## Verification Checklist

- [ ] Code crawler respects .gitignore
- [ ] Language detection works for supported languages
- [ ] Docs crawler finds nested markdown files
- [ ] Conversation crawler preserves thread structure
- [ ] All crawlers implement Crawler protocol

## Quick Check

```bash
python -c "
from rag.crawlers import CodeCrawler, DocsCrawler
from rag.core.types import CrawlSource

# Test code crawler on current directory
crawler = CodeCrawler()
source = CrawlSource(type='directory', path='.', metadata={})
results = list(crawler.crawl(source))
print(f'Found {len(results)} code files')
print('QUICK CHECK PASSED: Crawlers work')
"
```

## Prerequisites

- Phase 0 complete (CrawlSource, CrawlResult types)
- Install: `pip install gitpython`

## Next Phase

Upon completion, proceed to [Phase 7: Orchestrator](../phase7/task.md)
