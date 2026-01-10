/**
 * Agent Dashboard - Frontend Application
 * Vanilla JS, no frameworks
 */

// Global state
let refreshInterval = null;
let currentFilter = 'all';
let currentView = 'tree';

// Status color mapping
function getStatusColor(status) {
  const colors = {
    'in_progress': '#3b82f6', // blue
    'ready': '#22c55e',       // green
    'blocked': '#ef4444',     // red
    'done': '#6b7280',        // gray
    'open': '#f59e0b',        // amber
    'closed': '#6b7280'       // gray
  };
  return colors[status] || '#9ca3af';
}

// Render tasks to the container
function renderTasks(tasks) {
  const container = document.getElementById('task-container');
  const summary = document.getElementById('task-summary');

  if (!tasks || tasks.length === 0) {
    container.innerHTML = '<div class="empty-state">No tasks found</div>';
    summary.textContent = '';
    return;
  }

  // Apply filter
  let filteredTasks = tasks;
  if (currentFilter !== 'all') {
    filteredTasks = tasks.filter(t => t.status === currentFilter);
  }

  // Render tasks based on current view
  if (currentView === 'list') {
    // List view - compact table-like format
    container.innerHTML = filteredTasks.map(task => {
      const statusColor = getStatusColor(task.status);
      return `
        <div class="task-item task-list-item status-${task.status}" data-id="${task.id}">
          <div class="task-status" style="background-color: ${statusColor}"></div>
          <div class="task-id">${task.id}</div>
          <div class="task-title">${task.title}</div>
          <div class="task-priority">${task.priority || ''}</div>
          <div class="task-status-label">${task.status}</div>
        </div>
      `;
    }).join('');
  } else {
    // Tree view - card-like format with more details
    container.innerHTML = filteredTasks.map(task => {
      const statusColor = getStatusColor(task.status);
      return `
        <div class="task-item task-tree-item status-${task.status}" data-id="${task.id}">
          <div class="task-status" style="background-color: ${statusColor}"></div>
          <div class="task-content">
            <div class="task-id">${task.id}</div>
            <div class="task-title">${task.title}</div>
          </div>
          <div class="task-priority">${task.priority || ''}</div>
        </div>
      `;
    }).join('');
  }

  // Update summary
  const counts = {
    total: tasks.length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    ready: tasks.filter(t => t.status === 'ready').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    done: tasks.filter(t => t.status === 'done' || t.status === 'closed').length
  };

  summary.innerHTML = `
    <span class="count total">${counts.total} total</span>
    <span class="count in-progress">${counts.in_progress} in progress</span>
    <span class="count ready">${counts.ready} ready</span>
    <span class="count blocked">${counts.blocked} blocked</span>
    <span class="count done">${counts.done} done</span>
  `;
}

// Render diff using diff2html
function renderDiff(data) {
  const container = document.getElementById('diff-container');
  const info = document.getElementById('diff-info');
  const tabs = document.getElementById('file-tabs');

  // Update info header
  if (data.currentBranch && data.baseBranch) {
    info.textContent = `${data.baseBranch}...${data.currentBranch}`;
  }

  // Create file tabs
  if (data.files && data.files.length > 0) {
    tabs.innerHTML = data.files.map(file => {
      const filename = file.split('/').pop();
      return `<button class="file-tab" data-file="${file}">${filename}</button>`;
    }).join('');
  } else {
    tabs.innerHTML = '';
  }

  // Handle empty diff
  if (!data.diff || data.diff.trim() === '') {
    container.innerHTML = '<div class="empty-state">No changes detected</div>';
    return;
  }

  // Render diff using diff2html
  if (typeof Diff2Html !== 'undefined') {
    const diffHtml = Diff2Html.html(data.diff, {
      drawFileList: false,
      matching: 'lines',
      outputFormat: 'side-by-side'
    });
    container.innerHTML = diffHtml;
  } else {
    // Fallback for tests or when diff2html not loaded
    container.innerHTML = `<pre class="diff-fallback">${escapeHtml(data.diff)}</pre>`;
  }
}

// Escape HTML for safe display
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch and render tasks
async function loadTasks() {
  try {
    const response = await fetch('/api/tasks');
    const data = await response.json();
    renderTasks(data.tasks || []);
  } catch (err) {
    console.error('Failed to load tasks:', err);
    renderTasks([]);
  }
}

// Fetch and render diff
async function loadDiff() {
  try {
    const response = await fetch('/api/diff');
    const data = await response.json();
    renderDiff(data);
  } catch (err) {
    console.error('Failed to load diff:', err);
    renderDiff({ diff: '', files: [] });
  }
}

// Fetch and display status
async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();

    document.getElementById('repo-name').textContent = data.repoName || 'Unknown';

    let branchInfo = data.branch || 'unknown';
    if (data.ahead > 0) branchInfo += ` (+${data.ahead})`;
    if (data.behind > 0) branchInfo += ` (-${data.behind})`;
    if (data.uncommitted > 0) branchInfo += ` [${data.uncommitted} uncommitted]`;

    document.getElementById('branch-info').textContent = branchInfo;
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

// Refresh all data
async function refresh() {
  await Promise.all([
    loadTasks(),
    loadDiff(),
    loadStatus()
  ]);
}

// Toggle auto-refresh
function toggleAutoRefresh(enabled) {
  if (enabled) {
    refreshInterval = setInterval(refresh, 5000);
    if (typeof window !== 'undefined') {
      window.refreshInterval = refreshInterval;
    }
  } else {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
    refreshInterval = null;
    if (typeof window !== 'undefined') {
      window.refreshInterval = null;
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // Initial load
  refresh();

  // Auto-refresh checkbox handler
  const autoRefreshCheckbox = document.getElementById('auto-refresh');
  if (autoRefreshCheckbox) {
    autoRefreshCheckbox.addEventListener('change', (e) => {
      toggleAutoRefresh(e.target.checked);
    });
  }

  // Status filter handler
  const statusFilter = document.getElementById('status-filter');
  if (statusFilter) {
    statusFilter.addEventListener('change', (e) => {
      currentFilter = e.target.value;
      loadTasks();
    });
  }

  // View toggle handler
  const viewButtons = document.querySelectorAll('.view-toggle button');
  viewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      viewButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      loadTasks();
    });
  });
});

// Expose functions for testing
if (typeof window !== 'undefined') {
  window.renderTasks = renderTasks;
  window.renderDiff = renderDiff;
  window.getStatusColor = getStatusColor;
  window.refresh = refresh;
  window.toggleAutoRefresh = toggleAutoRefresh;
  window.loadTasks = loadTasks;
  window.loadDiff = loadDiff;
  window.loadStatus = loadStatus;
}
