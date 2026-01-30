# Phase 4: Test Scenarios

## Feature: Python HTTP Extraction

```gherkin
Feature: Python HTTP Call Extraction
  As a code analyst
  I want to detect HTTP calls in Python code
  So that I can map service dependencies

  Scenario: Extract requests.get with literal URL
    Given Python code:
      """
      requests.get("http://user-service/api/users")
      """
    When I extract service calls
    Then I should get 1 call
    And target_service should be "user-service"
    And method should be "GET"
    And url_path should be "/api/users"
    And confidence should be HIGH (0.9)

  Scenario: Extract httpx.post with json body
    Given Python code:
      """
      httpx.post("http://billing-api/charge", json={"amount": 100})
      """
    When I extract service calls
    Then I should get 1 call
    And method should be "POST"
    And target_service should be "billing-api"

  Scenario: Extract f-string URL with MEDIUM confidence
    Given Python code:
      """
      requests.get(f"http://{SERVICE_HOST}/api/users")
      """
    When I extract service calls
    Then I should get 1 call
    And confidence should be MEDIUM (0.7)

  Scenario: Ignore URLs in docstrings
    Given Python code:
      """
      def fetch():
          \"\"\"
          Example: http://user-service/api
          See also: http://billing-api/docs
          \"\"\"
          pass
      """
    When I extract service calls
    Then I should get 0 calls

  Scenario: Ignore URLs in comments
    Given Python code:
      """
      # TODO: call http://user-service/api
      pass
      """
    When I extract service calls
    Then I should get 0 calls

  Scenario: Extract multiple calls in one file
    Given Python code:
      """
      requests.get("http://user-service/users")
      requests.post("http://billing-api/charge")
      httpx.delete("http://order-service/orders/123")
      """
    When I extract service calls
    Then I should get 3 calls
    And services should include "user-service", "billing-api", "order-service"
```

## Feature: Route Registry

```gherkin
Feature: Route Registry
  As a call linker
  I want to store and query route definitions
  So that I can match calls to handlers

  Scenario: Exact path match
    Given route GET /api/users -> list_users
    When I query GET /api/users
    Then I should find list_users handler

  Scenario: Parameterized path match
    Given route GET /api/users/{id} -> get_user
    When I query GET /api/users/123
    Then I should find get_user handler

  Scenario: Trailing slash handled
    Given route GET /api/users/{id} -> get_user
    When I query GET /api/users/123/
    Then I should find get_user handler

  Scenario: Query params stripped
    Given route GET /api/users/{id} -> get_user
    When I query GET /api/users/123?include=orders
    Then I should find get_user handler

  Scenario: Exact beats parameterized
    Given routes:
      | method | path           | handler  |
      | GET    | /api/users/me  | get_me   |
      | GET    | /api/users/{id}| get_user |
    When I query GET /api/users/me
    Then I should find get_me handler (not get_user)

  Scenario: Method mismatch returns None
    Given route GET /api/users -> list_users
    When I query POST /api/users
    Then I should get None

  Scenario: Unknown service returns None
    Given an empty registry
    When I query any path on unknown-service
    Then I should get None
```

## Feature: Call Linker

```gherkin
Feature: Call Linking
  As a dependency mapper
  I want to link calls to their handlers
  So that I can visualize service relationships

  Scenario: Successfully link HTTP call
    Given user-service has route GET /api/users/{id} -> get_user in user_ctrl.py
    And a ServiceCall from auth.py calling GET /api/users/123
    When I link the call
    Then result.linked should be True
    And relation.target_file should be "user-service/user_ctrl.py"
    And relation.target_function should be "get_user"

  Scenario: No routes for unknown service
    Given no routes for "unknown-service"
    And a ServiceCall to unknown-service
    When I link the call
    Then result.linked should be False
    And result.miss_reason should be "no_routes"

  Scenario: Method mismatch
    Given user-service only has GET routes
    And a ServiceCall with DELETE method
    When I link the call
    Then result.linked should be False
    And result.miss_reason should be "method_mismatch"

  Scenario: Path mismatch
    Given user-service has /api/users routes
    And a ServiceCall to /api/orders
    When I link the call
    Then result.linked should be False
    And result.miss_reason should be "path_mismatch"

  Scenario: Batch linking
    Given multiple ServiceCalls
    When I call link_batch
    Then I should get one LinkResult per call
    And results should be in same order as input
```

## Feature: End-to-End Integration

```gherkin
Feature: End-to-End Service Extraction
  As a system integrator
  I want extraction, registry, and linking to work together
  So that I can map service dependencies

  Scenario: Extract and link auth-service to user-service
    Given auth-service code calling user-service:
      """
      # auth-service/src/auth/login.py
      resp = await httpx.get(f"http://user-service/api/users/{user_id}")
      """
    And user-service routes:
      | method | path               | handler        | file               |
      | GET    | /api/users/{id}    | get_user       | user_controller.py |
    When I extract calls from auth-service
    And I populate the registry with user-service routes
    And I link the extracted calls
    Then I should get a relation:
      | source_file            | target_file                         | target_function |
      | auth-service/login.py  | user-service/user_controller.py    | get_user        |
```

## Running Tests

```bash
# Run all Phase 4 tests
pytest tests/test_phase4/ -v

# Run sub-phase tests
pytest tests/test_phase4/test_phase4a_python.py -v
pytest tests/test_phase4/test_phase4c_registry.py -v
pytest tests/test_phase4/test_phase4e_linker.py -v

# Run integration test
pytest tests/test_phase4/test_integration.py -v

# Quick checks
python -m rag.extractors --checkpoint python_http
python -m rag.extractors --checkpoint registry_crud
python -m rag.extractors --checkpoint call_linker
```
