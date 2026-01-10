/**
 * Dashboard Frontend Tests
 *
 * Run with: npm test
 * Requires: npm install (to get jsdom)
 */

const assert = require('assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

// Test results
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL: ${name}`);
    console.log(`    ${err.message}`);
  }
}

// Create a mock DOM environment
function createDOM() {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: 'usable',
    url: 'http://localhost:3847'
  });
  return dom;
}

console.log('\n--- Dashboard Frontend Tests ---\n');

// =====================================================
// Task Display Tests
// =====================================================
console.log('Task Display:');

test('renderTasks creates task elements with correct status classes', () => {
  const dom = createDOM();
  const { window } = dom;

  // Mock Diff2Html
  window.Diff2Html = { html: () => '' };

  // Load app.js
  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  const tasks = [
    { id: 'task-1', title: 'First task', status: 'in_progress', priority: 'P1' },
    { id: 'task-2', title: 'Second task', status: 'ready', priority: 'P2' },
    { id: 'task-3', title: 'Third task', status: 'blocked', priority: 'P3' },
    { id: 'task-4', title: 'Fourth task', status: 'done', priority: 'P1' }
  ];

  window.renderTasks(tasks);

  const container = window.document.getElementById('task-container');
  assert(container.children.length === 4, 'Should render 4 tasks');

  assert(container.querySelector('.status-in_progress'), 'Should have in_progress status');
  assert(container.querySelector('.status-ready'), 'Should have ready status');
  assert(container.querySelector('.status-blocked'), 'Should have blocked status');
  assert(container.querySelector('.status-done'), 'Should have done status');
});

test('renderTasks handles empty task list', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  window.renderTasks([]);

  const container = window.document.getElementById('task-container');
  assert(container.textContent.includes('No tasks') || container.children.length === 0,
    'Should handle empty tasks gracefully');
});

test('task elements display id and title', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  const tasks = [
    { id: 'test-123', title: 'Test Task Title', status: 'ready', priority: 'P1' }
  ];

  window.renderTasks(tasks);

  const container = window.document.getElementById('task-container');
  assert(container.textContent.includes('test-123'), 'Should display task id');
  assert(container.textContent.includes('Test Task Title'), 'Should display task title');
});

// =====================================================
// Diff Display Tests
// =====================================================
console.log('\nDiff Display:');

test('renderDiff displays diff using diff2html', () => {
  const dom = createDOM();
  const { window } = dom;

  // Mock diff2html
  window.Diff2Html = {
    html: (diffString, config) => {
      return '<div class="d2h-wrapper">' + diffString + '</div>';
    }
  };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  const diffData = {
    diff: 'diff --git a/test.js b/test.js\n+added line',
    currentBranch: 'feature-branch',
    baseBranch: 'main',
    files: ['test.js']
  };

  window.renderDiff(diffData);

  const container = window.document.getElementById('diff-container');
  assert(container.innerHTML.includes('d2h-wrapper'), 'Should use diff2html to render');
});

test('renderDiff handles empty diff', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  window.renderDiff({ diff: '', files: [], currentBranch: 'main', baseBranch: 'main' });

  const container = window.document.getElementById('diff-container');
  assert(container.textContent.includes('No changes') || container.innerHTML === '',
    'Should handle empty diff');
});

test('file tabs are created for changed files', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '<div></div>' };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  const diffData = {
    diff: 'some diff content',
    currentBranch: 'feature',
    baseBranch: 'main',
    files: ['src/app.js', 'src/utils.js', 'README.md']
  };

  window.renderDiff(diffData);

  const tabs = window.document.getElementById('file-tabs');
  assert(tabs.textContent.includes('app.js') || tabs.children.length === 3,
    'Should create tabs for each file');
});

// =====================================================
// Auto-refresh Tests
// =====================================================
console.log('\nAuto-refresh:');

test('toggleAutoRefresh starts interval when enabled', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ tasks: [] }) });

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  // Call toggleAutoRefresh directly
  window.toggleAutoRefresh(true);

  assert(window.refreshInterval !== null && window.refreshInterval !== undefined,
    'Should set refresh interval');

  // Cleanup
  if (window.refreshInterval) clearInterval(window.refreshInterval);
});

test('toggleAutoRefresh clears interval when disabled', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  // Enable first
  window.toggleAutoRefresh(true);
  assert(window.refreshInterval !== null, 'Should have interval after enabling');

  // Then disable
  window.toggleAutoRefresh(false);

  assert(window.refreshInterval === null || window.refreshInterval === undefined,
    'Should clear refresh interval');
});

// =====================================================
// Status Color Coding Tests
// =====================================================
console.log('\nStatus Color Coding:');

test('getStatusColor returns correct colors for each status', () => {
  const dom = createDOM();
  const { window } = dom;

  window.Diff2Html = { html: () => '' };

  const appCode = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  window.eval(appCode);

  const inProgress = window.getStatusColor('in_progress');
  const ready = window.getStatusColor('ready');
  const blocked = window.getStatusColor('blocked');
  const done = window.getStatusColor('done');

  assert(inProgress && inProgress.length > 0, 'in_progress should return a color');
  assert(ready && ready.length > 0, 'ready should return a color');
  assert(blocked && blocked.length > 0, 'blocked should return a color');
  assert(done && done.length > 0, 'done should return a color');

  // Verify they are different colors
  assert(inProgress !== ready, 'in_progress and ready should have different colors');
  assert(ready !== blocked, 'ready and blocked should have different colors');
});

// =====================================================
// Summary
// =====================================================
console.log('\n--- Results ---');
console.log('Passed: ' + passed);
console.log('Failed: ' + failed);
console.log('');

if (failed > 0) {
  process.exit(1);
}
