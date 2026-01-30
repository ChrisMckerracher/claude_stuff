# Phase 6: Test Scenarios

## Feature: Code Crawling

```gherkin
Feature: Code Repository Crawling
  As an ingestion system
  I want to crawl code repositories
  So that I can index source code

  Scenario: Crawl Python files
    Given a directory with:
      | file         | content           |
      | main.py      | print('hello')    |
      | test.js      | console.log('hi') |
      | readme.txt   | ignored           |
    When I crawl the directory
    Then I should get 2 results
    And results should include .py and .js files
    And results should not include .txt files

  Scenario: Respect .gitignore
    Given a git repository with:
      | file        | tracked |
      | tracked.py  | yes     |
      | ignored.py  | no (.gitignore) |
    When I crawl the git repo
    Then I should only get tracked.py
    And ignored.py should not appear

  Scenario: Skip node_modules
    Given a directory with node_modules containing JS files
    When I crawl the directory
    Then no files from node_modules should appear

  Scenario: Detect programming language
    Given files with extensions .py, .go, .ts
    When I crawl the directory
    Then each result should have correct language
    And .py should be "python"
    And .go should be "go"
    And .ts should be "typescript"
```

## Feature: Documentation Crawling

```gherkin
Feature: Documentation Crawling
  As an ingestion system
  I want to crawl documentation
  So that I can index markdown files

  Scenario: Find markdown files
    Given a directory with:
      | file           | type |
      | README.md      | md   |
      | docs/guide.md  | md   |
      | main.py        | py   |
    When I crawl for docs
    Then I should get 2 results
    And all results should be .md files

  Scenario: Mark README files
    Given README.md and guide.md
    When I crawl for docs
    Then README.md should have is_readme=True
    And guide.md should have is_readme=False

  Scenario: Find nested documentation
    Given docs/api/v1/reference.md
    When I crawl for docs
    Then I should find reference.md
    And relative_path should be "docs/api/v1/reference.md"
```

## Feature: Conversation Crawling

```gherkin
Feature: Conversation Crawling
  As an ingestion system
  I want to crawl Slack exports and transcripts
  So that I can index conversations

  Scenario: Crawl Slack export
    Given a Slack export with:
      | channel  | messages |
      | general  | 10       |
      | random   | 5        |
    When I crawl the Slack export
    Then I should get 2 results
    And general should have message_count=10
    And random should have message_count=5

  Scenario: Aggregate channel messages
    Given channel "dev" with messages across 3 days
    When I crawl the Slack export
    Then I should get 1 result for dev
    And all messages should be aggregated

  Scenario: Crawl transcript files
    Given transcript files:
      | file         |
      | meeting1.txt |
      | meeting2.txt |
    When I crawl transcripts
    Then I should get 2 results
    And format should be "transcript"

  Scenario: Auto-detect Slack format
    Given a directory with channels.json
    When I crawl with type="directory"
    Then it should be detected as Slack export
```

## Running Tests

```bash
# Run all Phase 6 tests
pytest tests/test_phase6/ -v

# Run specific crawler tests
pytest tests/test_phase6/test_code_crawler.py -v
pytest tests/test_phase6/test_docs_crawler.py -v
pytest tests/test_phase6/test_conversation_crawler.py -v

# Quick check
python -c "
from rag.crawlers import CodeCrawler, DocsCrawler, ConversationCrawler
from rag.core.types import CrawlSource

# Verify all crawlers can be instantiated
c1 = CodeCrawler()
c2 = DocsCrawler()
c3 = ConversationCrawler()
print('Phase 6 Quick Check PASSED: All crawlers instantiate')
"
```
