# Phase 8: Test Scenarios

## Feature: Neo4j Connection

```gherkin
Feature: Neo4j Connection
  As a production system
  I want to connect to Neo4j
  So that I can use real graph storage

  Scenario: Validate connection with environment variables
    Given NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD are set
    When I call validate_neo4j_connection()
    Then it should return True
    And print success message

  Scenario: Fail gracefully without config
    Given no Neo4j environment variables
    When I call validate_neo4j_connection()
    Then it should return False
    And print helpful error message

  Scenario: Connect via Docker
    Given Neo4j running in Docker on localhost:7687
    When I create GraphitiStore.from_env()
    Then connection should succeed

  Scenario: Connect via Aura
    Given Neo4j Aura instance running
    And NEO4J_URI starts with "neo4j+s://"
    When I create GraphitiStore.from_env()
    Then connection should succeed
```

## Feature: Graphiti Client

```gherkin
Feature: Graphiti Graph Store
  As a production system
  I want to use Graphiti for entity extraction
  So that I get LLM-powered knowledge graphs

  Scenario: Add entity to graph
    Given a connected GraphitiStore
    When I add an entity with type SERVICE and name "auth-service"
    Then I should get an EntityID back
    And the entity should be queryable

  Scenario: Extract entities from text
    Given a connected GraphitiStore
    When I call add_episode with "auth-service calls user-service"
    Then I should get entities for both services
    And they should be stored in Neo4j

  Scenario: Graph traversal
    Given entities A and B with CALLS relationship
    When I get_neighbors of A with direction="out"
    Then I should receive B
    And the relationship should be included

  Scenario: Handle rate limits gracefully
    Given LLM API rate limit is reached
    When I call add_episode
    Then I should get LLMError with retryable=True
    And retry_after_seconds should be set

  Scenario: Connection lifecycle
    Given GraphitiStore created
    When I use it in async with block
    Then connection should close automatically
```

## Feature: Factory Pattern

```gherkin
Feature: Graph Store Factory
  As a developer
  I want to easily switch between mock and real graph
  So that I can test locally and deploy to production

  Scenario: Default to mock store
    Given no configuration
    When I call create_graph_store()
    Then I should get MockGraphStore

  Scenario: Use Graphiti when configured
    Given config with use_mock=False and Neo4j credentials
    When I call create_graph_store(config)
    Then I should get GraphitiStore

  Scenario: Raise error without Neo4j config
    Given config with use_mock=False but no credentials
    When I call create_graph_store(config)
    Then I should get ValueError
    And message should explain what's missing

  Scenario: Use environment variables
    Given NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD in environment
    When I call create_graph_store(GraphStoreConfig(use_mock=False))
    Then credentials should be loaded from environment
```

## Feature: Migration

```gherkin
Feature: Mock to Graphiti Migration
  As an operator
  I want to migrate from mock to production
  So that I preserve existing data

  Scenario: Migrate entities
    Given MockGraphStore with 10 entities
    When I run migrate_to_graphiti()
    Then all 10 entities should be in Graphiti
    And stats should show entities_migrated=10

  Scenario: Migrate relationships
    Given MockGraphStore with 5 relationships
    When I run migrate_to_graphiti()
    Then all 5 relationships should be in Graphiti
    And entity references should be updated

  Scenario: Handle migration errors
    Given MockGraphStore with some invalid data
    When I run migrate_to_graphiti()
    Then valid data should still migrate
    And errors should be counted and logged

  Scenario: Validate parity
    Given migrated data in Graphiti
    When I run validate_parity() with test queries
    Then similar results should be returned
    And parity should be > 50% for each query
```

## Running Tests

```bash
# Run Phase 8 unit tests (no Neo4j required)
pytest tests/test_phase8/ -v -m "not integration"

# Run integration tests (requires Neo4j)
pytest tests/test_phase8/ -v -m integration

# Validate Neo4j connection
python -m rag.graphiti.validate

# Run migration
python scripts/migrate_to_graphiti.py

# Full end-to-end with Graphiti
RAG_USE_MOCK_GRAPH=false dagster dev
```

## Pre-Flight Checklist

Before running Phase 8:

- [ ] Neo4j is running and accessible
- [ ] `python -m rag.graphiti.validate` returns True
- [ ] LLM API key is set (ANTHROPIC_API_KEY or OPENAI_API_KEY)
- [ ] Phases 0-7 tests pass
- [ ] MockGraphStore parity tests pass
