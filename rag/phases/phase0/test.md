# Phase 0: Test Scenarios

## Feature: Core Data Types

```gherkin
Feature: Core Data Types
  As a RAG system developer
  I want immutable and well-typed data structures
  So that data integrity is guaranteed throughout the pipeline

  Scenario: ChunkID is immutable and hashable
    Given I create a ChunkID with value "abc123"
    Then the ChunkID should be frozen
    And the ChunkID should be usable as a dictionary key
    And attempting to modify the ChunkID should raise an error

  Scenario: ChunkID from content is deterministic
    Given a source URI "src/auth/login.py"
    And a byte range of 100 to 500
    When I create a ChunkID from this content twice
    Then both ChunkIDs should have the same value
    And the value should be a SHA256 hash

  Scenario: RawChunk contains all required fields
    Given I create a RawChunk with text "def foo(): pass"
    Then it should have a ChunkID
    And it should have a source_uri
    And it should have a corpus_type
    And it should have a byte_range tuple
    And it should have a metadata dictionary

  Scenario: CorpusType enum covers all content types
    Then CorpusType should have CODE_LOGIC
    And CorpusType should have CODE_TEST
    And CorpusType should have DOC_README
    And CorpusType should have DOC_DESIGN
    And CorpusType should have CONVO_SLACK
    And CorpusType should have CONVO_TRANSCRIPT
```

## Feature: Storage Protocols

```gherkin
Feature: VectorStore Protocol
  As a storage implementation developer
  I want a clear protocol interface
  So that any implementation can be swapped in

  Scenario: VectorStore protocol defines insert method
    Given the VectorStore protocol
    Then it should define an async insert method
    And insert should accept an EmbeddedChunk
    And insert should be idempotent on chunk ID

  Scenario: VectorStore protocol defines search method
    Given the VectorStore protocol
    Then it should define an async search method
    And search should accept a query_vector and limit
    And search should support optional filters
    And search should return a list of SearchResult

  Scenario: BatchResult tracks partial success
    Given a batch insert of 10 chunks
    When 7 chunks succeed and 3 fail
    Then BatchResult.success should be False
    And BatchResult.partial_success should be True
    And BatchResult.inserted_count should be 7
    And BatchResult.failed_chunks should have 3 entries

Feature: GraphStore Protocol
  As a graph storage developer
  I want protocol methods for entity and relationship management
  So that I can implement the knowledge graph

  Scenario: GraphStore supports entity upsert
    Given an entity with type SERVICE and name "auth-service"
    When I add the entity twice with different properties
    Then only one entity should exist
    And it should have the properties from the second add

  Scenario: GraphStore supports graph traversal
    Given entity A connected to entity B with CALLS relationship
    And entity B connected to entity C with CALLS relationship
    When I get neighbors of A with max_hops=2
    Then I should receive both B and C
    And the relationships should be included

  Scenario: GraphStore direction semantics are correct
    Given entity auth-service CALLS user-service
    When I get neighbors of auth-service with direction="out"
    Then I should receive user-service
    When I get neighbors of auth-service with direction="in"
    Then I should receive an empty list
```

## Feature: Processing Protocols

```gherkin
Feature: Chunker Protocol
  As a content processor
  I want a chunker interface
  So that any chunking strategy can be used

  Scenario: Chunker yields RawChunks
    Given content bytes and a source URI
    When I call chunk()
    Then it should yield RawChunk objects
    And each chunk should have a unique ChunkID
    And byte ranges should not overlap

Feature: Scrubber Protocol
  As a compliance officer
  I want PHI removed with an audit trail
  So that I can verify compliance

  Scenario: Scrubber returns CleanChunk with audit log
    Given a RawChunk containing "Contact john@example.com"
    When I call scrub()
    Then I should receive a CleanChunk
    And the text should not contain "john@example.com"
    And the scrub_log should record what was replaced

  Scenario: Batch scrubbing handles individual failures
    Given 5 RawChunks where 1 has encoding issues
    When I call scrub_batch()
    Then I should receive 5 ScrubResults
    And 4 results should have success=True
    And 1 result should have success=False with error message

Feature: Embedder Protocol
  As a vector search developer
  I want consistent embeddings
  So that search works correctly

  Scenario: Embedder produces correct dimension
    Given an Embedder with dimension 768
    When I embed "hello world"
    Then the vector should have exactly 768 elements
    And all elements should be floats

  Scenario: Batch embedding preserves order
    Given texts ["a", "b", "c"]
    When I call embed_batch()
    Then I should receive 3 vectors
    And vector[0] should correspond to "a"
    And vector[1] should correspond to "b"
    And vector[2] should correspond to "c"
```

## Feature: Entity Schema

```gherkin
Feature: Entity and Relationship Types
  As a knowledge graph modeler
  I want comprehensive entity and relationship types
  So that I can represent the domain

  Scenario: EntityType covers all domain concepts
    Then EntityType should include SERVICE
    And EntityType should include PERSON
    And EntityType should include INCIDENT
    And EntityType should include QUEUE
    And EntityType should include FILE
    And EntityType should include FUNCTION

  Scenario: RelationType covers service interactions
    Then RelationType should include CALLS
    And RelationType should include PUBLISHES_TO
    And RelationType should include SUBSCRIBES_TO
    And RelationType should include READS_FROM
    And RelationType should include WRITES_TO

  Scenario: Entity has source references
    Given an Entity extracted from two files
    Then source_refs should contain both file paths
    And properties should be a dictionary
```

## Feature: Error Types

```gherkin
Feature: Error Handling with Retry Semantics
  As a resilient system
  I want errors to indicate retry possibility
  So that transient failures can be recovered

  Scenario: StorageError indicates retryability
    Given a StorageError with retryable=True
    Then I should be able to check error.retryable
    And error.retry_after_seconds should suggest wait time

  Scenario: DimensionMismatchError is never retryable
    Given a DimensionMismatchError
    Then error.retryable should be False
    And the error message should include expected and actual dimensions

  Scenario: LLMError is usually retryable
    Given an LLMError for rate limiting
    Then error.retryable should be True
    And error.retry_after_seconds should be set

  Scenario: All errors inherit from RAGError
    Then ChunkingError should be a RAGError
    And ScrubError should be a RAGError
    And StorageError should be a RAGError
    And EmbeddingError should be a RAGError
```

## Running Tests

```bash
# Run all Phase 0 tests
pytest tests/test_phase0/ -v

# Run specific feature
pytest tests/test_phase0/test_types.py -v

# Check type correctness
mypy rag/core/ --strict
```
