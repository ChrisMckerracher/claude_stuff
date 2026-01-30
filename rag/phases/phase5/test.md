# Phase 5: Test Scenarios

## Feature: Hybrid Retrieval

```gherkin
Feature: Hybrid Vector + Graph Retrieval
  As a developer searching code
  I want to find relevant code and related services
  So that I understand the full context

  Scenario: Vector-only search finds direct matches
    Given indexed chunks containing:
      | source_uri    | text                           |
      | auth/login.py | def authenticate_user(): ...   |
      | db/query.py   | def execute_query(): ...       |
    When I search "authentication" with expand_graph=False
    Then results should include auth/login.py
    And results should not include db/query.py

  Scenario: Graph expansion finds related services
    Given auth-service CALLS user-service relationship in graph
    And chunks indexed for both services
    When I search "authentication" with expand_graph=True
    Then results should include chunks from auth-service
    And results should include chunks from user-service

  Scenario: Direct matches rank higher than graph expansion
    Given auth-service chunk about "user authentication"
    And user-service chunk about "user database"
    And auth-service CALLS user-service relationship
    When I search "user authentication"
    Then auth-service chunk should rank higher than user-service

  Scenario: Empty query returns empty results
    Given a populated retriever
    When I search ""
    Then I should get 0 results

  Scenario: Filters are respected
    Given chunks with corpus_type CODE_LOGIC and DOC_README
    When I search "user" with filter corpus_type="CODE_LOGIC"
    Then all results should have corpus_type CODE_LOGIC

  Scenario: top_k limits results
    Given 100 indexed chunks
    When I search "code" with top_k=5
    Then I should get at most 5 results
```

## Feature: Result Reranking

```gherkin
Feature: Search Result Reranking
  As a search system
  I want to order results by relevance
  So that users find what they need quickly

  Scenario: Deduplicate by chunk ID
    Given results containing:
      | chunk_id | score |
      | chunk-1  | 0.8   |
      | chunk-1  | 0.9   |
      | chunk-2  | 0.7   |
    When I rerank the results
    Then I should get 2 results
    And chunk-1 should have score 0.9

  Scenario: Sort by score descending
    Given results with scores [0.5, 0.9, 0.7]
    When I rerank the results
    Then scores should be [0.9, 0.7, 0.5]

  Scenario: Term boosting increases relevance
    Given results:
      | text                    | score |
      | authentication login    | 0.5   |
      | database performance    | 0.6   |
    When I rerank with boost_terms=["authentication"]
    Then "authentication login" should rank first

  Scenario: Empty input returns empty output
    Given no results
    When I rerank
    Then I should get empty list
```

## Feature: Integration Tests

```gherkin
Feature: End-to-End Retrieval
  As an integration tester
  I want to verify the full retrieval pipeline
  So that I can trust search results

  Scenario: Full pipeline with indexed fixture services
    Given fixture auth-service and user-service ingested
    And graph relationships populated
    When I search "user authentication"
    Then I should get results from both services
    And results should be sorted by relevance
    And no duplicate chunks should appear

  Scenario: Retrieval performance is acceptable
    Given 1000 indexed chunks
    When I search "authentication"
    Then response time should be under 5 seconds

  Scenario: Graceful degradation without graph
    Given vector store is available
    And graph store returns errors
    When I search with expand_graph=True
    Then I should still get vector results
    And no error should be raised
```

## Running Tests

```bash
# Run all Phase 5 tests
pytest tests/test_phase5/ -v

# Run retriever tests
pytest tests/test_phase5/test_hybrid.py -v

# Run reranker tests
pytest tests/test_phase5/test_reranker.py -v

# Run integration test
pytest tests/test_phase5/test_integration.py -v

# Quick check
python -c "
from rag.retrieval import HybridRetriever, Reranker
from rag.retrieval.reranker import Reranker
r = Reranker()
results = r.rerank([], 'test')
assert results == []
print('Phase 5 Quick Check PASSED')
"
```
