const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const REPO_PATH = process.env.REPO_PATH || process.cwd();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to run shell commands
function run(cmd, cwd = REPO_PATH) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject({ error: err.message, stderr });
      } else {
        resolve(stdout);
      }
    });
  });
}

// GET /api/tasks - beads task list
app.get('/api/tasks', async (req, res) => {
  try {
    // Try to get tasks from bd
    const output = await run('bd list 2>/dev/null || echo "[]"');

    // Parse bd list output into structured data
    const tasks = [];
    const lines = output.trim().split('\n').filter(l => l.trim());

    for (const line of lines) {
      // Parse lines like: "claude_stuff-ssj [P2] [task] open - Dashboard: Title"
      const match = line.match(/^(\S+)\s+\[(\w+)\]\s*\[(\w+)\]\s*(\w+)\s*-\s*(.+)/);
      if (match) {
        tasks.push({
          id: match[1],
          priority: match[2],
          type: match[3],
          status: match[4],
          title: match[5]
        });
      }
    }

    res.json({ tasks, raw: output });
  } catch (err) {
    res.json({ tasks: [], error: err.error || 'Failed to get tasks' });
  }
});

// GET /api/tasks/:id - single task details
app.get('/api/tasks/:id', async (req, res) => {
  try {
    const output = await run(`bd show ${req.params.id}`);
    res.json({ task: output });
  } catch (err) {
    res.status(404).json({ error: 'Task not found' });
  }
});

// GET /api/diff - git diff against main branch
app.get('/api/diff', async (req, res) => {
  try {
    // Detect base branch (main or master)
    let baseBranch = 'main';
    try {
      await run('git rev-parse --verify main');
    } catch {
      baseBranch = 'master';
    }

    // Get current branch
    const currentBranch = (await run('git branch --show-current')).trim();

    // Get diff
    let diff = '';
    if (currentBranch === baseBranch) {
      // On main branch, show uncommitted changes
      diff = await run('git diff HEAD');
    } else {
      // Show diff from base branch
      diff = await run(`git diff ${baseBranch}...HEAD`);
    }

    // Get list of changed files
    let files = [];
    try {
      const filesOutput = currentBranch === baseBranch
        ? await run('git diff HEAD --name-only')
        : await run(`git diff ${baseBranch}...HEAD --name-only`);
      files = filesOutput.trim().split('\n').filter(f => f);
    } catch {
      files = [];
    }

    res.json({
      baseBranch,
      currentBranch,
      diff,
      files,
      fileCount: files.length
    });
  } catch (err) {
    res.json({ diff: '', files: [], error: err.error || 'Failed to get diff' });
  }
});

// GET /api/status - git status info
app.get('/api/status', async (req, res) => {
  try {
    const branch = (await run('git branch --show-current')).trim();
    const status = await run('git status --porcelain');
    const clean = status.trim() === '';

    // Get ahead/behind counts
    let ahead = 0, behind = 0;
    try {
      const tracking = await run('git rev-list --left-right --count HEAD...@{upstream} 2>/dev/null');
      const parts = tracking.trim().split(/\s+/);
      ahead = parseInt(parts[0]) || 0;
      behind = parseInt(parts[1]) || 0;
    } catch {
      // No upstream tracking
    }

    // Get repo name from path
    const repoName = path.basename(REPO_PATH);

    res.json({
      repoName,
      repoPath: REPO_PATH,
      branch,
      clean,
      ahead,
      behind,
      uncommitted: status.trim().split('\n').filter(l => l).length
    });
  } catch (err) {
    res.json({ error: err.error || 'Failed to get status' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Monitoring repo: ${REPO_PATH}`);
});
