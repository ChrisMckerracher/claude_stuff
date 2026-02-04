import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for BDD Feature Spec Workflow
 *
 * This config enables video recording for visual test verification.
 * QA Agent generates tests from Gherkin specs that run with this config.
 *
 * @see docs/plans/architect/bdd-spec-workflow.md
 */
export default defineConfig({
  testDir: '.',

  // Run tests in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry failed tests (video captured on retry)
  retries: process.env.CI ? 2 : 1,

  // Limit parallel workers on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],

  // Output directory for test artifacts
  outputDir: 'test-results/',

  // Shared settings for all projects
  use: {
    // Base URL for navigation actions like page.goto('/')
    // baseURL: 'http://localhost:3000',

    // Collect trace on first retry for debugging
    trace: 'retain-on-failure',

    // Video recording configuration
    // 'on' - record all tests
    // 'on-first-retry' - record only on retry (recommended for CI)
    // 'retain-on-failure' - keep video only if test fails
    video: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',
  },

  // Configure projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment for cross-browser testing
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Run local dev server before starting the tests
  // webServer: {
  //   command: 'npm run dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
