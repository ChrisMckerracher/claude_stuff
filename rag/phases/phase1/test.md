# Phase 1: Test Scenarios

## Feature: Token Counter

```gherkin
Feature: Token Counter
  As a chunking system
  I want accurate token counts
  So that chunks fit within model limits

  Scenario: Count tokens in simple text
    Given text "hello world"
    When I count tokens
    Then the count should be greater than 0
    And the count should be less than 10

  Scenario: Count tokens in code
    Given code "def foo(x): return x + 1"
    When I count tokens
    Then the count should reflect code tokenization
    And operators should be separate tokens

  Scenario: Count empty string
    Given an empty string
    When I count tokens
    Then the count should be 0

  Scenario: Truncate long text
    Given text with 1000 tokens
    And max_tokens of 100
    When I truncate the text
    Then the result should have at most 100 tokens
    And the result should end at a word boundary

  Scenario: Short text unchanged by truncate
    Given text with 10 tokens
    And max_tokens of 100
    When I truncate the text
    Then the result should equal the original text
```

## Feature: AST Chunker

```gherkin
Feature: AST Code Chunking
  As a code search system
  I want semantic code chunks
  So that search results are meaningful

  Scenario: Chunk Python at function boundaries
    Given Python code with two functions:
      """
      def foo():
          pass

      def bar():
          pass
      """
    When I chunk the code
    Then I should get 2 chunks
    And chunk 1 should contain "foo"
    And chunk 2 should contain "bar"

  Scenario: Chunk Python class with methods
    Given Python code with a class:
      """
      class MyClass:
          def method1(self):
              pass

          def method2(self):
              pass
      """
    When I chunk the code
    Then I should get 1 chunk for the entire class
    And the chunk should contain "MyClass"

  Scenario: Split large function
    Given a Python function with 200 lines
    And max_tokens of 50
    When I chunk the code
    Then I should get multiple chunks
    And each chunk should have at most 50 tokens
    And chunks should have overlap for context

  Scenario: Extract symbol names
    Given Python code:
      """
      def authenticate_user(username, password):
          pass
      """
    When I chunk the code
    Then the chunk metadata should contain symbol_name "authenticate_user"
    And the chunk metadata should contain symbol_kind "function_definition"

  Scenario: Handle unsupported language
    Given code in an unsupported language
    When I chunk the code
    Then it should fall back to line-based chunking
    And no error should be raised

  Scenario: Mark test files correctly
    Given Python code in "tests/test_auth.py"
    When I chunk the code
    Then the corpus_type should be CODE_TEST

  Scenario: Mark source files correctly
    Given Python code in "src/auth/login.py"
    When I chunk the code
    Then the corpus_type should be CODE_LOGIC
```

## Feature: Markdown Chunker

```gherkin
Feature: Markdown Chunking
  As a documentation search system
  I want heading-aware chunks
  So that documentation context is preserved

  Scenario: Chunk at heading boundaries
    Given markdown with headings:
      """
      # Introduction
      Welcome to the docs.

      # Installation
      Run pip install.

      # Usage
      Import and use.
      """
    When I chunk the markdown
    Then I should get 3 chunks
    And chunk 1 heading should be "Introduction"
    And chunk 2 heading should be "Installation"
    And chunk 3 heading should be "Usage"

  Scenario: Handle nested headings
    Given markdown with nested headings:
      """
      # Main Section
      Overview.

      ## Subsection A
      Details A.

      ## Subsection B
      Details B.
      """
    When I chunk the markdown
    Then I should get 3 chunks
    And chunk 1 level should be 1
    And chunk 2 level should be 2
    And chunk 3 level should be 2

  Scenario: Preserve code blocks
    Given markdown with a code block:
      """
      # Example

      Here's code:

      ```python
      def foo():
          return 42
      ```

      That's it.
      """
    When I chunk the markdown
    Then the code block should be in one chunk
    And the code block should not be split

  Scenario: Handle document without headings
    Given markdown without headings:
      """
      This is just plain text.
      No headings here.
      """
    When I chunk the markdown
    Then I should get 1 chunk
    And the chunk should contain all the text

  Scenario: Identify README files
    Given markdown in "README.md"
    When I chunk the markdown
    Then the corpus_type should be DOC_README

  Scenario: Split large section
    Given a markdown section with 500 tokens
    And max_tokens of 100
    When I chunk the markdown
    Then the section should be split into multiple chunks
    And splits should occur at paragraph boundaries
```

## Feature: Thread Chunker

```gherkin
Feature: Conversation Thread Chunking
  As a conversation search system
  I want thread-aware chunks
  So that conversation context is preserved

  Scenario: Parse Slack JSON format
    Given Slack export JSON:
      """
      [
        {"type": "message", "user": "alice", "text": "Hello", "ts": "1234567890.000001"},
        {"type": "message", "user": "bob", "text": "Hi there", "ts": "1234567890.000002"}
      ]
      """
    When I chunk the conversation
    Then I should get 1 chunk
    And the chunk should contain "alice: Hello"
    And the chunk should contain "bob: Hi there"

  Scenario: Parse simple text format
    Given conversation text:
      """
      Alice: Hello everyone
      Bob: Hi Alice
      Charlie: Hey!
      """
    When I chunk the conversation
    Then I should get 1 chunk
    And speakers should include "Alice", "Bob", "Charlie"

  Scenario: Group by thread
    Given Slack messages with thread replies:
      """
      [
        {"type": "message", "user": "alice", "text": "Main topic", "ts": "1"},
        {"type": "message", "user": "bob", "text": "Reply 1", "thread_ts": "1", "ts": "2"},
        {"type": "message", "user": "alice", "text": "New topic", "ts": "3"}
      ]
      """
    When I chunk the conversation
    Then messages should be grouped by thread
    And thread "1" should have 2 messages
    And thread "main" should have 1 message

  Scenario: Preserve speaker attribution in splits
    Given a long conversation with 50 messages
    And max_tokens of 100
    When I chunk the conversation
    Then each chunk should maintain speaker attribution
    And no chunk should have anonymous messages

  Scenario: Handle unknown speaker
    Given conversation without speaker labels
    When I chunk the conversation
    Then the chunk should have speaker "unknown"

  Scenario: Identify Slack vs transcript
    Given a conversation from "exports/slack/channel.json"
    When I chunk the conversation
    Then the corpus_type should be CONVO_SLACK

    Given a conversation from "transcripts/meeting.txt"
    When I chunk the conversation
    Then the corpus_type should be CONVO_TRANSCRIPT
```

## Running Tests

```bash
# Run all Phase 1 tests
pytest tests/test_phase1/ -v

# Run specific chunker tests
pytest tests/test_phase1/test_ast_chunker.py -v

# Run with coverage
pytest tests/test_phase1/ --cov=rag.chunking

# Quick check
python -c "
from rag.chunking import TokenCounter, ASTChunker
tc = TokenCounter()
chunker = ASTChunker(tc)
code = b'def foo(): pass'
chunks = list(chunker.chunk(code, source_uri='test.py', language='python'))
assert len(chunks) == 1
print('Phase 1 Quick Check PASSED')
"
```
