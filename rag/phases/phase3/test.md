# Phase 3: Test Scenarios

## Feature: LanceDB Vector Store

```gherkin
Feature: Vector Storage
  As a search system
  I want to store and retrieve vectors
  So that I can find similar content

  Scenario: Insert and retrieve single chunk
    Given an embedded chunk with text "hello world"
    When I insert the chunk into LanceStore
    And I search with the same vector
    Then I should get 1 result
    And the result should contain "hello world"

  Scenario: Insert is idempotent
    Given an embedded chunk with ID "chunk-123"
    When I insert the chunk twice
    Then no error should be raised
    And searching should return only 1 result

  Scenario: Dimension mismatch rejected
    Given a LanceStore configured for 768 dimensions
    And a vector with 512 dimensions
    When I try to insert
    Then a DimensionMismatchError should be raised
    And the error should indicate expected=768, actual=512

  Scenario: Search returns ranked results
    Given 5 chunks with different content
    When I search for "authentication login"
    Then results should be sorted by similarity
    And the most similar chunk should be first

  Scenario: Search with filters
    Given chunks with corpus_type CODE_LOGIC and DOC_README
    When I search with filter corpus_type="CODE_LOGIC"
    Then all results should have corpus_type CODE_LOGIC
    And no DOC_README chunks should appear

  Scenario: Delete removes chunk
    Given a chunk with ID "chunk-to-delete"
    When I delete by ID "chunk-to-delete"
    Then delete should return True
    And searching should not find the chunk

  Scenario: Delete non-existent returns False
    Given an empty store
    When I delete ID "non-existent"
    Then delete should return False
    And no error should be raised
```

## Feature: Batch Operations

```gherkin
Feature: Batch Insert
  As a pipeline developer
  I want to insert chunks in batches
  So that ingestion is efficient

  Scenario: Batch insert all succeed
    Given 10 valid embedded chunks
    When I call insert_batch
    Then BatchResult.success should be True
    And BatchResult.inserted_count should be 10
    And BatchResult.failed_chunks should be empty

  Scenario: Batch insert partial failure
    Given 10 chunks where 2 have wrong dimensions
    When I call insert_batch
    Then BatchResult.success should be False
    And BatchResult.partial_success should be True
    And BatchResult.inserted_count should be 8
    And BatchResult.failed_chunks should have 2 entries

  Scenario: Batch insert all fail
    Given 5 chunks all with wrong dimensions
    When I call insert_batch
    Then BatchResult.success should be False
    And BatchResult.partial_success should be False
    And BatchResult.inserted_count should be 0
```

## Feature: Embedder

```gherkin
Feature: Text Embedding
  As a vector search system
  I want to convert text to vectors
  So that I can perform similarity search

  Scenario: Embed produces correct dimension
    Given the CodeRankEmbedder
    When I embed "hello world"
    Then the vector should have 768 dimensions
    And all values should be floats

  Scenario: Empty string produces zero vector
    Given the CodeRankEmbedder
    When I embed ""
    Then the vector should have 768 dimensions
    And all values should be 0.0

  Scenario: Batch embedding preserves order
    Given texts ["apple", "banana", "cherry"]
    When I call embed_batch
    Then I should get 3 vectors
    And vector[0] should equal embed("apple")
    And vector[1] should equal embed("banana")
    And vector[2] should equal embed("cherry")

  Scenario: Similar texts have similar vectors
    Given text A "user authentication login"
    And text B "user authentication password"
    And text C "database performance tuning"
    When I embed all three
    Then cosine(A, B) should be greater than cosine(A, C)

  Scenario: Identical texts produce identical vectors
    Given text "test input"
    When I embed it twice
    Then both vectors should be identical
```

## Feature: Search Quality

```gherkin
Feature: Search Quality
  As a user
  I want relevant search results
  So that I can find the code I need

  Scenario: Code search finds relevant function
    Given chunks containing:
      | text                          | source_uri          |
      | def authenticate_user(): ...  | auth/login.py       |
      | def get_user(): ...           | users/service.py    |
      | def calculate_tax(): ...      | billing/tax.py      |
    When I search for "user authentication"
    Then the first result should be from "auth/login.py"
    And "billing/tax.py" should rank lower

  Scenario: Filter by service
    Given chunks from services:
      | service      | count |
      | auth-service | 10    |
      | user-service | 10    |
    When I search for "login" with filter service="auth-service"
    Then all results should be from auth-service

  Scenario: Limit respects requested count
    Given 100 chunks in the store
    When I search with limit=5
    Then I should get exactly 5 results

  Scenario: Empty query returns empty results
    Given a populated store
    When I search with an empty query vector
    Then results should handle gracefully
```

## Running Tests

```bash
# Run all Phase 3 tests
pytest tests/test_phase3/ -v

# Run store tests
pytest tests/test_phase3/test_lance_store.py -v

# Run embedder tests
pytest tests/test_phase3/test_embedder.py -v

# Quick check (uses MockEmbedder to avoid model download)
python -c "
from rag.indexing.embedder import MockEmbedder
e = MockEmbedder()
v1 = e.embed('test')
v2 = e.embed('test')
assert v1 == v2
assert len(v1) == 768
print('Phase 3 Quick Check PASSED')
"
```
