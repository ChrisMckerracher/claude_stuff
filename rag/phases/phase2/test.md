# Phase 2: Test Scenarios

## NLP Backend Modes

Phase 2 supports pluggable NLP backends. See [NLP_BACKENDS.md](../../docs/NLP_BACKENDS.md).

| Mode | PERSON Detection | Model Required |
|------|-----------------|----------------|
| `regex` (default) | No | None |
| `spacy` (optional) | Yes | en_core_web_lg |

## Feature: PHI Scrubbing (Regex Mode - Default)

```gherkin
Feature: PHI Scrubbing (Regex Mode)
  As a compliance officer
  I want PII removed from code and documentation
  So that sensitive data is not exposed in search results

  Background:
    Given I am using the default regex-only backend
    And no NLP model is required

  Scenario: Scrub email addresses
    Given text containing "Contact john@example.com for help"
    When I scrub the text
    Then "john@example.com" should not appear in the result
    And the scrub_log should contain an EMAIL_ADDRESS entry
    And a fake email should replace the original

  Scenario: Scrub phone numbers
    Given text containing "Call me at 555-123-4567"
    When I scrub the text
    Then "555-123-4567" should not appear in the result
    And the scrub_log should contain a PHONE_NUMBER entry

  Scenario: Scrub SSN with redaction
    Given text containing "SSN: 123-45-6789"
    When I scrub the text
    Then "123-45-6789" should not appear in the result
    And the replacement should be "XXX-XX-XXXX"
    And the actual SSN should never be stored

  Scenario: Scrub credit card numbers
    Given text containing "Card: 4111-1111-1111-1111"
    When I scrub the text
    Then "4111-1111-1111-1111" should not appear in the result

  Scenario: Scrub IP addresses
    Given text containing "Server IP: 192.168.1.100"
    When I scrub the text
    Then "192.168.1.100" should not appear in the result

  Scenario: Preserve code identifiers (regex mode)
    Given Python code:
      """
      def authenticate_user(username):
          return get_user(username)
      """
    When I scrub the text
    Then "authenticate_user" should be preserved
    And "get_user" should be preserved
    And "username" should be preserved

  Scenario: Person names NOT detected in regex mode
    Given text containing "John Smith reviewed this PR"
    When I scrub the text with regex backend
    Then "John Smith" WILL still appear (no NER)
    And scrub_log should be empty for PERSON

  Scenario: Multiple PII types in same text
    Given text containing "Email john@example.com or call 555-123-4567"
    When I scrub the text
    Then "john@example.com" should not appear
    And "555-123-4567" should not appear
    And scrub_log should have 2 entries

  Scenario: Text with no PII
    Given text containing "def foo(): return 42"
    When I scrub the text
    Then the text should be unchanged
    And scrub_log should be empty
```

## Feature: PHI Scrubbing (spaCy Mode - Optional)

```gherkin
Feature: PHI Scrubbing (spaCy Mode)
  As a compliance officer
  I want person names detected and scrubbed
  So that author attribution is removed

  Background:
    Given I have installed spacy and en_core_web_lg model
    And I create an analyzer with backend="spacy"

  @requires-spacy
  Scenario: Scrub person names
    Given text containing "John Smith reviewed this PR"
    When I scrub the text with spaCy backend
    Then "John Smith" should not appear in the result
    And the replacement should look like a real name

  @requires-spacy
  Scenario: Scrub locations
    Given text containing "The server is in New York"
    When I scrub the text with spaCy backend
    Then "New York" should not appear in the result
```

## Feature: Pseudonymization Consistency

```gherkin
Feature: Consistent Pseudonymization
  As a data analyst
  I want the same PII to always map to the same replacement
  So that references remain traceable

  Scenario: Same email maps to same replacement
    Given the email "john@example.com" appears twice
    When I scrub the text
    Then both occurrences should have the same replacement
    And the replacement should look like an email

  Scenario: Same name maps to same replacement
    Given the name "John Smith" appears in two chunks
    When I scrub both chunks with the same scrubber
    Then both should have the same replacement name

  Scenario: Different emails map to different replacements
    Given emails "john@example.com" and "jane@example.com"
    When I scrub the text
    Then they should have different replacements

  Scenario: Deterministic across sessions
    Given I scrub "john@example.com" in session 1 with seed 42
    And I scrub "john@example.com" in session 2 with seed 42
    Then both sessions should produce the same replacement

  Scenario: Different seeds produce different results
    Given I scrub "john@example.com" with seed 42
    And I scrub "john@example.com" with seed 100
    Then the replacements should be different
```

## Feature: Batch Scrubbing

```gherkin
Feature: Batch Scrubbing
  As a pipeline developer
  I want to scrub multiple chunks efficiently
  So that ingestion is fast

  Scenario: Batch scrub multiple chunks
    Given 10 chunks with various PII
    When I call scrub_batch
    Then I should receive 10 ScrubResults
    And results should be in the same order as input

  Scenario: Batch handles individual failures
    Given 5 chunks where 1 has encoding issues
    When I call scrub_batch
    Then 4 results should have success=True
    And 1 result should have success=False
    And the failed result should have an error message
    And successful chunks should not be affected

  Scenario: Batch preserves pseudonym consistency
    Given 3 chunks all mentioning "john@example.com"
    When I call scrub_batch
    Then all 3 chunks should use the same replacement email
```

## Feature: Audit Trail

```gherkin
Feature: Scrubbing Audit Trail
  As an auditor
  I want a complete log of what was scrubbed
  So that I can verify compliance

  Scenario: Audit log contains all scrub actions
    Given text with 3 PII entities
    When I scrub the text
    Then scrub_log should have 3 entries
    And each entry should have entity_type
    And each entry should have start position
    And each entry should have end position
    And each entry should have replacement value

  Scenario: Audit log positions are correct
    Given text "Email: john@example.com"
    When I scrub the text
    Then the start position should be 7
    And the end position should be 23
    And extracting text[7:23] from original should give "john@example.com"

  Scenario: Audit log survives serialization
    Given a scrubbed chunk with audit log
    When I serialize and deserialize the CleanChunk
    Then the scrub_log should be preserved
    And all ScrubAction fields should be intact
```

## Running Tests

```bash
# Run all Phase 2 tests
pytest tests/test_phase2/ -v

# Run scrubber tests
pytest tests/test_phase2/test_scrubber.py -v

# Run pseudonymizer tests
pytest tests/test_phase2/test_pseudonymizer.py -v

# Quick check
python -c "
from rag.scrubbing import PresidioScrubber, Pseudonymizer
p = Pseudonymizer(seed=42)
r1 = p.get_replacement('test@test.com', 'EMAIL_ADDRESS')
r2 = p.get_replacement('test@test.com', 'EMAIL_ADDRESS')
assert r1 == r2, 'Pseudonymizer not consistent'
print('Phase 2 Quick Check PASSED')
"
```
