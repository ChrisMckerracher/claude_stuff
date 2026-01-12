#!/usr/bin/env bash
#
# decompose-task.sh - Create a task bead with branch in epic worktree
#
# Usage: decompose-task.sh <epic_id> "Task title" "Description" [blocker_id...]
# Output: task_id on success, exits non-zero on failure
#
# This script:
# 1. Creates a task bead with -t task
# 2. Creates task branch from epic branch (in epic worktree)
# 3. Adds dependency: task blocks epic (epic depends on task)
# 4. Adds any additional blocker dependencies
#

set -euo pipefail

SCRIPT_NAME="decompose-task.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { log_error "$*"; exit 1; }

usage() {
    cat >&2 << EOF
Usage: $SCRIPT_NAME <epic_id> "Task title" "Description" [blocker_id...]

Creates a task bead with branch in the epic's worktree.

Arguments:
    epic_id         ID of the parent epic (from decompose-init.sh)
    Task title      Title for the task
    Description     Description of the task
    blocker_id...   Optional: IDs of tasks that block this one

Output:
    Prints task_id to stdout on success

Examples:
    # Create independent task
    task1=\$($SCRIPT_NAME "\$epic_id" "Add middleware" "JWT validation layer")

    # Create task blocked by another
    task2=\$($SCRIPT_NAME "\$epic_id" "Add routes" "User endpoints" "\$task1")

    # Create task blocked by multiple
    task3=\$($SCRIPT_NAME "\$epic_id" "Integration tests" "E2E tests" "\$task1" "\$task2")
EOF
    exit 1
}

# =============================================================================
# VALIDATION
# =============================================================================

[[ $# -lt 3 ]] && usage

epic_id="$1"
task_title="$2"
task_description="$3"
shift 3
blockers=("$@")

# Must be in a git repo
git rev-parse --git-dir &>/dev/null || die "Not in a git repository"

# Must have bd command
command -v bd &>/dev/null || die "bd command not found"

# Must have jq for JSON parsing
command -v jq &>/dev/null || die "jq command not found"

# Get project root
project_root=$(git rev-parse --show-toplevel)
worktree_path="${project_root}/.worktrees/${epic_id}"

# Validate epic exists
bd show "$epic_id" &>/dev/null || die "Epic not found: $epic_id"

# Validate worktree exists
[[ -d "$worktree_path" ]] || die "Worktree not found: $worktree_path"

# Validate epic branch exists
git rev-parse --verify "epic/${epic_id}" &>/dev/null \
    || die "Epic branch not found: epic/${epic_id}"

log_info "Creating task: $task_title"
log_info "Parent epic: $epic_id"

# =============================================================================
# CREATE TASK BEAD
# =============================================================================

log_info "Creating task bead..."

task_json=$(bd create "$task_title" -t task -p 1 -d "$task_description" --json 2>/dev/null) \
    || die "Failed to create task bead"

task_id=$(echo "$task_json" | jq -r '.id // empty')
[[ -z "$task_id" ]] && die "Failed to parse task ID from: $task_json"

log_info "Created task: $task_id"

# =============================================================================
# CREATE TASK BRANCH (in epic worktree)
# =============================================================================

log_info "Creating task branch in worktree..."

(
    cd "$worktree_path"

    # Make sure we're on the epic branch first
    git checkout "epic/${epic_id}" 2>/dev/null || true

    # Create task branch from epic branch
    git checkout -b "task/${task_id}" "epic/${epic_id}"
) || die "Failed to create task branch"

log_info "Created branch: task/${task_id}"

# =============================================================================
# ADD DEPENDENCIES
# =============================================================================

# Task blocks epic (epic depends on task completing)
log_info "Adding dependency: $task_id blocks $epic_id"
bd dep add "$epic_id" "$task_id" 2>/dev/null \
    || log_warn "Failed to add epic dependency (may already exist)"

# Add blocker dependencies (this task is blocked by the specified tasks)
if [[ ${#blockers[@]} -gt 0 ]]; then
    for blocker in "${blockers[@]}"; do
        if [[ -n "$blocker" ]]; then
            log_info "Adding dependency: $blocker blocks $task_id"
            bd dep add "$task_id" "$blocker" 2>/dev/null \
                || log_warn "Failed to add blocker dependency: $blocker"
        fi
    done
fi

# =============================================================================
# VALIDATION
# =============================================================================

log_info "Validating..."

# Check task branch exists
if ! git rev-parse --verify "task/${task_id}" &>/dev/null; then
    die "Validation failed: Branch task/${task_id} not found"
fi

log_info "Task created successfully!"
log_info "  Task ID: $task_id"
log_info "  Branch: task/${task_id}"
log_info "  Worktree: .worktrees/${epic_id}/"
[[ ${#blockers[@]} -gt 0 ]] && log_info "  Blocked by: ${blockers[*]}"

# Output task_id to stdout (only this goes to stdout, rest is stderr)
echo "$task_id"
