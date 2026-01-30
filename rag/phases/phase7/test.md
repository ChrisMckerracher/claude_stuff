# Phase 7: Test Scenarios

## Feature: Ingestion Orchestrator

```gherkin
Feature: Ingestion Pipeline Orchestration
  As a pipeline operator
  I want to run end-to-end ingestion
  So that code is indexed and searchable

  Scenario: Ingest single file
    Given a directory with main.py
    When I run ingestion
    Then files_crawled should be 1
    And chunks_created should be > 0
    And chunks_stored should be > 0
    And success should be True

  Scenario: Continue after file error
    Given a directory with good.py and bad.py (invalid)
    When I run ingestion
    Then good.py should be processed
    And errors should contain bad.py
    And pipeline should not crash

  Scenario: Collect all errors
    Given multiple failing files
    When I run ingestion
    Then all errors should be collected in stats
    And each error should identify the file

  Scenario: Process code and documentation
    Given main.py and README.md
    When I run ingestion
    Then both should be chunked
    And code should go to vector store
    And docs should go to graph store

  Scenario: Track statistics accurately
    Given 10 files with varying chunk counts
    When I run ingestion
    Then files_crawled should be 10
    And chunks_created should match actual count
    And chunks_stored should match vector store count
```

## Feature: Dagster Assets

```gherkin
Feature: Dagster Asset Pipeline
  As a data engineer
  I want observable asset dependencies
  So that I can monitor and debug ingestion

  Scenario: Asset dependency order
    Given the full asset graph
    Then raw_code_files should have no dependencies
    And route_registry should depend on raw_code_files
    And service_relations should depend on route_registry
    And code_chunks should depend on raw_code_files
    And vector_index should depend on code_chunks

  Scenario: Raw code files asset
    Given config with repos list
    When raw_code_files runs
    Then it should return files grouped by service
    And total_files should match actual count

  Scenario: Route registry asset
    Given raw_code_files output with FastAPI services
    When route_registry runs
    Then routes should be stored in SQLite
    And route_count should reflect extracted routes

  Scenario: Service relations asset
    Given populated route_registry
    When service_relations runs
    Then calls should be linked to handlers
    And linked_count should be > 0 for valid calls
    And unlinked_count should track failures

  Scenario: Vector index asset
    Given code_chunks output
    When vector_index runs
    Then chunks should be in LanceDB
    And chunks_indexed should match input count

  Scenario: Dagster dev starts
    When I run dagster dev
    Then the webserver should start
    And all 5 assets should be visible
    And asset graph should show dependencies
```

## Feature: End-to-End Integration

```gherkin
Feature: Full Pipeline Integration
  As an end-to-end tester
  I want to verify the complete pipeline
  So that I trust it works in production

  Scenario: Ingest fixture services
    Given auth-service and user-service fixtures
    When I run full ingestion
    Then routes should be extracted from both
    And calls should be linked across services
    And chunks should be searchable in vector store

  Scenario: MVP acceptance test
    Given indexed fixture services
    When I search "user authentication"
    Then I should find auth-service code
    And graph expansion should find user-service
    And results should be relevant

  Scenario: Idempotent re-ingestion
    Given a previously ingested service
    When I run ingestion again
    Then no duplicate chunks should be created
    And stats should reflect no new work
```

## Running Tests

```bash
# Run all Phase 7 tests
pytest tests/test_phase7/ -v

# Run orchestrator tests
pytest tests/test_phase7/test_orchestrator.py -v

# Run asset tests
pytest tests/test_phase7/test_assets.py -v

# Start Dagster dev server
cd rag && dagster dev

# Quick check
python -c "
from rag.pipeline.orchestrator import IngestionOrchestrator, IngestionStats
stats = IngestionStats()
stats.files_crawled = 5
assert stats.success
stats.errors.append('test error')
assert not stats.success
print('Phase 7 Quick Check PASSED')
"
```
