#!/bin/bash
#
# statusline.sh - Claude Code status line script for agent-ecosystem plugin
#
# Displays: [Model] $X.XX | branch | N tasks
#
# Configuration (.claude/settings.json):
#   {
#     "statusLine": {
#       "type": "command",
#       "command": "./plugin/scripts/statusline.sh"
#     }
#   }
#

# Read JSON input from Claude Code
input=$(cat)

# Extract model and cost from JSON stdin
MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // "."')

# Get git branch (or "-" if not in a repo)
BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null || echo "-")
[[ -z "$BRANCH" ]] && BRANCH="-"

# Get beads task count (or "-" if no .beads directory)
if [[ -d "$CWD/.beads" ]]; then
    TASKS=$(cd "$CWD" && bd ready --json 2>/dev/null | jq 'length' 2>/dev/null || echo "?")
else
    TASKS="-"
fi

# Output status line (keep under 80 chars for Windows compatibility)
printf "[%s] \$%.2f | %s | %s tasks" "$MODEL" "$COST" "$BRANCH" "$TASKS"
