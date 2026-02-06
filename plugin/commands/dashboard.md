---
description: Launch the agent ecosystem dashboard to view tasks and git diffs
allowed-tools: ["Bash"]
---

# Dashboard Launch

Launch the agent ecosystem dashboard web interface.

## Steps

1. **Start the dashboard server in background:**
```bash
cd $(dirname "$0")/../dashboard && REPO_PATH=$(pwd) PORT=3847 npm start &
```

2. **Open the browser:**
```bash
open http://localhost:3847
```

3. **Confirm to user:**
The dashboard is now running at http://localhost:3847

## Stopping the Dashboard

To stop the dashboard server:
```bash
pkill -f "node server.js"
```

Or find the process and kill it:
```bash
lsof -i :3847
kill <PID>
```
