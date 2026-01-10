#!/usr/bin/env bash
# Session start hook - load context and show ready tasks

# Read hook input
INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Check if beads initialized in project
if [ -d "$CWD/.beads" ]; then
    # Get ready tasks
    READY=$(cd "$CWD" && bd ready --json 2>/dev/null)

    if [ -n "$READY" ] && [ "$READY" != "[]" ]; then
        COUNT=$(echo "$READY" | jq 'length')

        # Output context for Claude
        echo "Project has beads task tracking. $COUNT task(s) ready to work on."
        echo "Use /visualize to see full task tree."
    fi
fi

# Always exit 0 for non-blocking
exit 0
