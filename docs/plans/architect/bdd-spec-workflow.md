# BDD Feature Spec Workflow Design

**Product brief:** No product brief (tooling/workflow task)

## Goal

Enable Product Agent to write Cucumber/Gherkin-style feature specs before design, creating a parallel to how Architect writes design docs - with QA Agent reviewing specs like Code Review reviews designs.

## Problem

Currently:
- Architect designs from human prompts alone
- No structured behavior specification before design
- QA writes tests after implementation (too late for meaningful feedback)
- No review cycle for behavioral specifications

## Solution

Introduce BDD feature specs as a first-class artifact:
1. **Product Agent** writes feature specs (behavior is Product's domain)
2. **QA Agent** reviews specs (testing expertise validates spec quality)
3. **Architect Agent** checks for specs before design, uses them as input

## Authority Parallel

| Design Flow | Spec Flow |
|-------------|-----------|
| Architect writes design doc | Product writes feature spec |
| Code Review reviews design | QA reviews feature spec |
| Product validates design | Architect consumes spec as input |

## File Structure

```
docs/specs/
└── features/
    ├── user-authentication.feature
    ├── search-functionality.feature
    └── ...
```

## Gherkin Format

Feature specs follow Cucumber/Gherkin syntax:

```gherkin
Feature: User Authentication
  As a user
  I want to log in securely
  So that I can access my account

  Background:
    Given the authentication service is running
    And I am on the login page

  Scenario: Successful login with valid credentials
    Given I have a registered account
    When I enter my email "user@example.com"
    And I enter my password "correct-password"
    And I click the login button
    Then I should be redirected to the dashboard
    And I should see a welcome message

  Scenario: Failed login with invalid password
    Given I have a registered account
    When I enter my email "user@example.com"
    And I enter my password "wrong-password"
    And I click the login button
    Then I should see an error message "Invalid credentials"
    And I should remain on the login page

  Scenario Outline: Login validation
    When I enter my email "<email>"
    And I enter my password "<password>"
    And I click the login button
    Then I should see "<result>"

    Examples:
      | email              | password | result                    |
      |                    | pass123  | Email is required         |
      | invalid-email      | pass123  | Invalid email format      |
      | user@example.com   |          | Password is required      |
```

## Workflow Changes

### Architect Agent Changes

Add spec awareness at the start of execute mode:

```
Step 0 (NEW): Check for feature spec
  - Glob("docs/specs/features/<feature-name>.feature")
  - If EXISTS:
    → Read spec, use as primary requirements input
    → Note in design doc: "Feature spec: docs/specs/features/<feature>.feature"
  - If MISSING:
    → Ask user: "No feature spec found. Would you like to work with
       Product Agent to create one first? (recommended for user-facing features)"
    → If yes: Switch to Product Agent with Skill tool
    → If no: Continue with human requirements only
```

Design doc template addition:
```markdown
# [Feature Name] Design

**Feature spec:** `docs/specs/features/<feature-name>.feature` | No feature spec (technical task)
**Product brief:** `docs/plans/product/briefs/<feature-name>.md` | No product brief (technical task)
```

### Product Agent Changes

Add new mode for spec writing:

```markdown
### Spec Mode (NEW)
Write Gherkin feature specs for upcoming features.

**Process:**
1. Gather requirements from user conversation
2. Identify user personas and their goals
3. Draft scenarios covering:
   - Happy paths (primary success scenarios)
   - Alternative paths (valid variations)
   - Error paths (invalid inputs, failures)
   - Edge cases (boundaries, limits)
4. Write spec to `docs/specs/features/<feature-name>.feature`
5. **GATE: Spec Review** - Spawn QA Agent for review:
   ```
   Task(subagent_type: "agent-ecosystem:qa",
        prompt: "Review feature spec: docs/specs/features/<feature-name>.feature")
   ```
6. If QA requests changes → iterate
7. If QA approves → inform user spec is ready for architecture

**Output:** Feature spec at `docs/specs/features/<feature-name>.feature`
```

### QA Agent Changes

Add spec review and test generation capabilities:

```markdown
### Spec Review Mode (NEW)
Review Gherkin feature specs for completeness and testability.

**Review Checklist:**
- [ ] Feature description clear (As a... I want... So that...)
- [ ] Scenarios cover happy path
- [ ] Scenarios cover error conditions
- [ ] Scenarios cover edge cases
- [ ] Given/When/Then steps are atomic and testable
- [ ] No implementation details in specs (behavior only)
- [ ] Scenario outlines used for data-driven cases
- [ ] Background used appropriately for shared setup

**Process:**
1. Read spec from `docs/specs/features/<feature-name>.feature`
2. Apply review checklist
3. Return in conversation: APPROVED | NEEDS_REVISION (with specific feedback)
4. No separate review file needed - approval is conversational

**Output:** Approval status in conversation (no persistent review file)

### Test Generation Mode (NEW)
Generate Playwright e2e tests from approved Gherkin specs.

**Invocation:** `/qa generate-tests <spec-path>`

**Process:**
1. Verify spec exists and was approved (check conversation or ask)
2. Read feature spec
3. Map each Scenario to a Playwright test:
   - Background → beforeEach hook
   - Given → test setup / arrange
   - When → user actions / act
   - Then → assertions / assert
   - Scenario Outline → parameterized test loop
4. Generate test file at `tests/e2e/<feature-name>.spec.ts`
5. Configure video recording (on-first-retry default)
6. Present generated test for human review

**Selector Strategy:**
- Prefer `data-testid` attributes
- Fall back to accessible roles/labels
- Flag selectors that need Coding Agent to add test IDs

**Video Configuration:**
- Enable video recording for visual debugging
- Retain traces on failure for step-by-step replay
- Output to `test-results/` directory

**Output:** Playwright test file at `tests/e2e/<feature-name>.spec.ts`
```

## Invocation Patterns

### Independent Product Agent Invocation

User can invoke Product Agent directly to write specs:

```
User: /product
Product Agent: What feature would you like to specify?
User: User authentication with social login
Product Agent: [writes spec, spawns QA for review]
```

### Architect Suggests Spec First

When Architect detects missing spec for user-facing feature:

```
User: /architect user authentication feature
Architect: No feature spec found at docs/specs/features/user-authentication.feature.

This appears to be a user-facing feature. I recommend running `/product spec`
first to define the expected behavior, then return here for design.

Alternatively, I can design from our conversation if you prefer to skip
the formal spec (appropriate for technical/internal features).

How would you like to proceed?
```

Human orchestrates - Architect doesn't auto-switch agents.

### Full Workflow Example

```
User: /product spec
Product: What feature? → User: "User auth with social login"
Product: [writes spec] → spawns QA for review
QA: APPROVED (or requests changes)

User: /architect user authentication
Architect: Found spec at docs/specs/features/user-authentication.feature
           [designs based on spec scenarios]

User: /qa generate-tests docs/specs/features/user-authentication.feature
QA: [generates Playwright tests with video config]
    Output: tests/e2e/user-authentication.spec.ts
```

## Spec-to-Test Relationship

Feature specs are **design documents for human review** that serve as the source of truth for QA Agent test generation.

**Why Gherkin format:**
- Industry-standard syntax developers and QA recognize
- Structured Given/When/Then maps directly to test arrange/act/assert
- Human-readable while being precise enough for test scaffolding
- Scenario Outlines naturally become parameterized tests

**How specs become tests:**

```
Product writes spec → QA reviews spec → QA generates Playwright tests
     ↓                      ↓                      ↓
 .feature file        review approval        .spec.ts files
```

### QA Agent Test Generation Mode

After spec approval, QA Agent can generate Playwright tests:

```
User: /qa generate-tests docs/specs/features/user-authentication.feature
QA Agent:
  1. Read approved feature spec
  2. Map scenarios to Playwright test structure
  3. Generate test file at tests/e2e/<feature-name>.spec.ts
  4. Configure video recording for visual verification
  5. Output test file for human review before commit
```

**Generated test structure:**

```typescript
// tests/e2e/user-authentication.spec.ts
import { test, expect } from '@playwright/test';

test.describe('User Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // From Background:
    await page.goto('/login');
  });

  test('Successful login with valid credentials', async ({ page }) => {
    // Given I have a registered account (test data setup)
    // When I enter my email "user@example.com"
    await page.fill('[data-testid="email"]', 'user@example.com');
    // And I enter my password "correct-password"
    await page.fill('[data-testid="password"]', 'correct-password');
    // And I click the login button
    await page.click('[data-testid="login-button"]');
    // Then I should be redirected to the dashboard
    await expect(page).toHaveURL('/dashboard');
    // And I should see a welcome message
    await expect(page.locator('[data-testid="welcome"]')).toBeVisible();
  });

  // Scenario Outline becomes parameterized test
  const validationCases = [
    { email: '', password: 'pass123', result: 'Email is required' },
    { email: 'invalid-email', password: 'pass123', result: 'Invalid email format' },
    { email: 'user@example.com', password: '', result: 'Password is required' },
  ];

  for (const { email, password, result } of validationCases) {
    test(`Login validation: ${result}`, async ({ page }) => {
      await page.fill('[data-testid="email"]', email);
      await page.fill('[data-testid="password"]', password);
      await page.click('[data-testid="login-button"]');
      await expect(page.locator('.error-message')).toContainText(result);
    });
  }
});
```

### Video Recording Configuration

Playwright config for test video capture:

```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    video: 'on-first-retry', // or 'on' for all tests
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results/',
});
```

**Video playback workflow:**
1. Tests run with video recording enabled
2. Failed tests retain video in `test-results/`
3. QA Agent can reference videos when reporting failures
4. Human reviews video to understand failure context

### Test Generation Boundaries

**QA Agent generates:**
- Test file structure matching feature scenarios
- Playwright selectors (using data-testid pattern)
- Assertions matching Then steps
- Video/trace configuration

**QA Agent does NOT generate:**
- Application code or fixtures
- Complex test utilities (delegate to Coding Agent)
- CI/CD pipeline changes

**Handoff to Coding Agent:**
If generated tests need custom fixtures, page objects, or utilities:
```
QA Agent: "Tests generated but need page object for login flow.
           Handing off to Coding Agent for: tests/e2e/pages/login.page.ts"
```

## Success Criteria

1. **Spec adoption:** Architects reference feature specs in >80% of user-facing feature designs
2. **Spec quality:** QA approval rate >70% on first submission (specs are well-formed)
3. **Test coverage:** Generated Playwright tests cover all scenarios in approved specs
4. **Video utility:** Failed test videos are referenced in >50% of bug reports

## Task Breakdown

1. **Update Architecture Agent prompt** (blocks: none)
   - Add Step 0: spec check before design
   - Add spec reference to design doc template
   - Suggest (not auto-handoff) Product Agent for missing specs

2. **Update Product Agent prompt** (blocks: none)
   - Add Spec Mode section
   - Add Gherkin format guidelines
   - Add QA review spawning

3. **Update QA Agent prompt** (blocks: none)
   - Add Spec Review Mode section
   - Add review checklist (conversational approval, no file)
   - Add Test Generation Mode section
   - Add Playwright generation guidelines
   - Add video configuration guidance

4. **Create directory structure** (blocks: 1, 2, 3)
   - Add `docs/specs/features/.gitkeep`
   - Add `tests/e2e/.gitkeep` (if not exists)

5. **Add Playwright config for video** (blocks: 4)
   - Configure video recording defaults
   - Configure trace retention on failure
   - Set output directory

6. **Update CLAUDE.md** (blocks: 5)
   - Document new workflow
   - Add file locations table entries
   - Document spec → test generation flow

## Design Decisions

1. **Gherkin over plain English:**
   - Industry-standard syntax recognized by developers and QA
   - Structured format maps directly to test structure (Given→arrange, When→act, Then→assert)
   - Scenario Outlines naturally become parameterized tests
   - Human-readable while precise enough for LLM test generation

2. **Spec granularity:** Flexible based on scope.
   - Focused feature → one `.feature` file
   - Large epic → multiple files, one per major capability
   - Use judgment; scenarios within a file cover related user stories

3. **Spec versioning:** Treat like design docs.
   - Changes after QA approval require re-review
   - Changes after tests generated require test regeneration
   - Specs are living documents but changes cascade to tests

4. **Conversational approval over review files:**
   - QA approves/rejects specs in conversation, no persistent review file
   - Reduces document proliferation (already have: brief, design, validation)
   - Approval is implicit when QA generates tests from spec

5. **Architect suggests, doesn't auto-handoff:**
   - Architect says "consider running /product spec" rather than auto-switching
   - Human orchestrates between agents (established pattern)
   - Avoids implicit agent-to-agent delegation complexity

6. **Specs inform tests via LLM generation:**
   - QA Agent generates Playwright tests from approved specs
   - NOT wired to Cucumber step definitions or test runners
   - LLM interprets Gherkin and produces idiomatic Playwright code
   - Video recording for visual test verification

---

**Architecture doc:** N/A (this is the architecture doc)
