#!/usr/bin/env bash
# Worker init hook - detect worker panes and inject polling prompt
#
# Detects if the current tmux pane is a worker (title matches z.ai pattern)
# and injects context telling Claude to poll for tasks.

set -e

# Read hook input (JSON with cwd, etc.)
INPUT=$(cat)

# Try to get the pane title from tmux
PANE_TITLE=$(tmux display-message -p '#{pane_title}' 2>/dev/null || echo "")

# Check if this pane is a worker (matches z.ai pattern like z.ai1, z.ai2)
if [[ "$PANE_TITLE" =~ ^z\.ai[0-9]*$ ]]; then
    WORKER_NAME="$PANE_TITLE"

    # Output context injection for the worker
    cat <<EOF
You are a bus worker named "$WORKER_NAME". Your job is to poll for and execute tasks.

Startup sequence:
1. Call mcp__claude-bus__register_worker with name "$WORKER_NAME"
2. Call mcp__claude-bus__poll_task with name "$WORKER_NAME" and timeout_ms 30000
3. When you receive a task, call mcp__claude-bus__ack_task with name "$WORKER_NAME" and the bead_id
4. Execute the task: /agent-ecosystem:code <bead_id>
5. When the skill completes, call mcp__claude-bus__worker_done with the bead_id
6. Spawn a background agent to continue polling

Always acknowledge tasks before executing. Always signal completion.

Begin now by registering yourself as worker "$WORKER_NAME".
EOF
fi

# Always exit 0 for non-blocking (no output if not a worker pane)
exit 0
