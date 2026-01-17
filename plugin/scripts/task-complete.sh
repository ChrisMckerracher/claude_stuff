#!/usr/bin/env bash
#
# task-complete.sh - Complete a task by merging to epic and rebasing dependents
#
# Usage: task-complete.sh <task_id>
# Output: JSON status on stdout, logs on stderr
#
# This script:
# 1. Validates the task exists and is open
# 2. Derives the epic root from the task ID
# 3. Finds the epic worktree
# 4. Commits any pending changes on the task branch
# 5. Merges the task branch to the epic branch
# 6. Rebases all dependent task branches from the updated epic
# 7. Closes the task bead
# 8. Outputs JSON status indicating what was merged/rebased
#

set -euo pipefail

SCRIPT_NAME="task-complete.sh"
readonly VERSION="1.0.0"

# Exit codes
readonly EXIT_SUCCESS=0
readonly EXIT_ERROR=1
readonly EXIT_VALIDATION=2
readonly EXIT_CONFLICT=4

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global state
TASK_ID=""
EPIC_ROOT=""
PROJECT_ROOT=""
WORKTREE_PATH=""
MERGED=false
REBASED=()
REBASE_FAILED=()
EPIC_COMMIT=""

# =============================================================================
# LOGGING FUNCTIONS
# =============================================================================

log_info() { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
die() { log_error "$*"; exit "${EXIT_ERROR}"; }

usage() {
    cat >&2 << EOF
Usage: $SCRIPT_NAME <task_id>

Complete a task by:
1. Committing work on task branch
2. Merging task branch to epic branch
3. Rebasing all dependent task branches
4. Closing the task bead

Output: JSON status on stdout, logs on stderr

Arguments:
    task_id    ID of the task to complete (e.g., bd-abc123.1)

Example:
    status=\$($SCRIPT_NAME bd-abc123.1)
    echo "\$status" | jq .
EOF
    exit "${EXIT_VALIDATION}"
}

# =============================================================================
# OUTPUT JSON
# =============================================================================

output_status() {
    local merged_json merged_bool
    local rebased_json
    local rebase_failed_json

    merged_bool="false"
    [[ "$MERGED" == "true" ]] && merged_bool="true"

    # Build rebased array
    if [[ ${#REBASED[@]} -eq 0 ]]; then
        rebased_json="[]"
    else
        rebased_json=$(printf '%s\n' "${REBASED[@]}" | jq -R . | jq -s .)
    fi

    # Build rebase_failed array
    if [[ ${#REBASE_FAILED[@]} -eq 0 ]]; then
        rebase_failed_json="[]"
    else
        rebase_failed_json=$(printf '%s\n' "${REBASE_FAILED[@]}" | jq -R . | jq -s .)
    fi

    cat << EOF
{
  "task_id": "$TASK_ID",
  "epic_id": "$EPIC_ROOT",
  "merged": $merged_bool,
  "rebased": $rebased_json,
  "rebase_failed": $rebase_failed_json,
  "epic_commit": "$EPIC_COMMIT"
}
EOF
}

# =============================================================================
# VALIDATION FUNCTIONS
# =============================================================================

validate_inputs() {
    [[ -z "$TASK_ID" ]] && die "Task ID cannot be empty"

    # Must be in a git repo
    git rev-parse --git-dir &>/dev/null || die "Not in a git repository"

    # Must have bd command
    command -v bd &>/dev/null || die "bd command not found"

    # Must have jq for JSON parsing
    command -v jq &>/dev/null || die "jq command not found"

    log_info "Task ID: $TASK_ID"
}

validate_task_exists() {
    log_info "Validating task exists..."

    bd show "$TASK_ID" &>/dev/null || die "Task not found: $TASK_ID"

    local task_json
    task_json=$(bd show "$TASK_ID" --json 2>/dev/null) || die "Failed to get task data"

    local task_status
    task_status=$(echo "$task_json" | jq -r '.status // empty')

    if [[ "$task_status" != "open" ]]; then
        die "Task is not open (status: $task_status). Already completed?"
    fi

    log_info "Task status: open"
}

validate_epic() {
    log_info "Validating epic..."

    # Validate epic exists
    bd show "$EPIC_ROOT" &>/dev/null || die "Epic not found: $EPIC_ROOT"

    log_info "Epic: $EPIC_ROOT"
}

validate_worktree() {
    log_info "Checking worktree health..."

    # Get project root
    PROJECT_ROOT=$(git rev-parse --show-toplevel)
    WORKTREE_PATH="${PROJECT_ROOT}/.worktrees/${EPIC_ROOT}"

    # Worktree health check
    if ! git worktree list | grep -q "$WORKTREE_PATH"; then
        cat >&2 << EOF
${RED}WORKTREE ERROR${NC}

Worktree corrupted or missing: $WORKTREE_PATH

${YELLOW}To fix:${NC}
  decompose-init $EPIC_ROOT   # Re-initialize the epic worktree
EOF
        exit "${EXIT_VALIDATION}"
    fi

    # Check worktree directory exists
    if [[ ! -d "$WORKTREE_PATH" ]]; then
        die "Worktree directory not found: $WORKTREE_PATH"
    fi

    # Check epic branch exists
    if ! git rev-parse --verify "epic/${EPIC_ROOT}" &>/dev/null; then
        die "Epic branch not found: epic/${EPIC_ROOT}"
    fi

    log_info "Worktree: $WORKTREE_PATH"
}

validate_task_branch() {
    (
        cd "$WORKTREE_PATH"

        if ! git rev-parse --verify "task/${TASK_ID}" &>/dev/null; then
            die "Task branch not found: task/${TASK_ID}"
        fi
    )

    log_info "Task branch verified: task/${TASK_ID}"
}

# =============================================================================
# MERGE FUNCTIONS
# =============================================================================

commit_and_merge_task() {
    log_info "Committing and merging task branch..."

    (
        cd "$WORKTREE_PATH"

        # Checkout task branch
        git checkout "task/${TASK_ID}" 2>/dev/null || \
            die "Failed to checkout task branch"

        # Add all changes
        git add -A

        # Commit if there are changes
        if git diff --staged --quiet; then
            log_info "No changes to commit"
        else
            git commit -m "Complete ${TASK_ID}" || \
                die "Failed to commit changes"
            log_info "Changes committed"
        fi

        # Checkout epic branch
        git checkout "epic/${EPIC_ROOT}" 2>/dev/null || \
            die "Failed to checkout epic branch"

        # Merge task branch (abort on conflict)
        log_info "Merging task/${TASK_ID} to epic/${EPIC_ROOT}..."

        if ! git merge --no-ff --edit "task/${TASK_ID}" 2>/dev/null; then
            # Handle merge conflict
            local conflicted_files
            conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "")

            cat >&2 << EOF

${RED}MERGE CONFLICT${NC} merging ${TASK_ID} to epic

${YELLOW}Conflicting files:${NC}
$(echo "$conflicted_files" | sed 's/^/  - /' | grep -v '^  - $')

${GREEN}Task committed but not merged to epic.${NC}

${YELLOW}Worktree:${NC} $WORKTREE_PATH
${YELLOW}Current branch:${NC} epic/${EPIC_ROOT} (merge in progress)

${YELLOW}Next steps:${NC}
  cd $WORKTREE_PATH
  git status                          # See conflicts
  # Edit and resolve conflicting files
  git add <resolved-files>
  git commit                          # Complete the merge
  $SCRIPT_NAME $TASK_ID               # Re-run this command to continue

${YELLOW}To abort the merge:${NC}
  cd $WORKTREE_PATH
  git merge --abort
  # Keep working on the task, then re-run task-complete

EOF
            exit "${EXIT_CONFLICT}"
        fi

        log_info "Merge successful"
    ) || exit $?

    MERGED=true

    # Get the epic commit hash
    EPIC_COMMIT=$(git -C "$WORKTREE_PATH" rev-parse --short "epic/${EPIC_ROOT}")
    log_info "Epic now at: $EPIC_COMMIT"
}

# =============================================================================
# REBASE FUNCTIONS
# =============================================================================

get_dependent_tasks() {
    log_info "Finding dependent tasks..."

    local epic_json
    epic_json=$(bd --cwd "$PROJECT_ROOT" show "$EPIC_ROOT" --json 2>/dev/null) || {
        log_warn "Could not fetch epic data"
        echo ""
        return
    }

    local dependents
    dependents=$(echo "$epic_json" | jq -r "
        .blocking_issues[]? |
        select(.blocked_by[]? == \"$TASK_ID\") |
        .id
    " 2>/dev/null || echo "")

    if [[ -z "$dependents" ]]; then
        log_info "No dependent tasks found"
    else
        local dep_count
        dep_count=$(echo "$dependents" | wc -l | xargs)
        log_info "Found $dep_count dependent task(s)"
    fi

    echo "$dependents"
}

rebase_dependent_tasks() {
    local dependents
    dependents=$(get_dependent_tasks)

    if [[ -z "$dependents" ]]; then
        return
    fi

    (
        cd "$WORKTREE_PATH"

        for dep in $dependents; do
            [[ -z "$dep" ]] && continue

            log_info "Processing dependent: $dep"

            # Check if task branch exists
            if ! git rev-parse --verify "task/${dep}" &>/dev/null; then
                log_warn "Task branch not found: task/${dep} (skipping)"
                REBASE_FAILED+=("$dep")
                continue
            fi

            # Checkout dependent task branch
            git checkout "task/${dep}" 2>/dev/null || {
                log_warn "Failed to checkout task/${dep} (skipping)"
                REBASE_FAILED+=("$dep")
                continue
            }

            # Rebase from epic
            log_info "Rebasing task/${dep} from epic/${EPIC_ROOT}..."

            if ! git rebase "epic/${EPIC_ROOT}" 2>/dev/null; then
                # Handle rebase conflict
                local conflicted_files
                conflicted_files=$(git diff --name-only --diff-filter=U 2>/dev/null || echo "")

                cat >&2 << EOF

${YELLOW}REBASE CONFLICT${NC} on dependent task ${dep}

${TASK_ID} merged successfully to epic.
Dependent task ${dep} has conflicts that need manual resolution.

${YELLOW}Conflicting files:${NC}
$(echo "$conflicted_files" | sed 's/^/  - /' | grep -v '^  - $')

${YELLOW}Worktree:${NC} $WORKTREE_PATH
${YELLOW}Current branch:${NC} task/${dep} (rebase in progress)

${YELLOW}To resolve:${NC}
  cd $WORKTREE_PATH
  git status                          # Verify you're on task/${dep}
  # Resolve conflicts in affected files
  git add <resolved-files>
  git rebase --continue

${YELLOW}If resolution fails, roll back:${NC}
  cd $WORKTREE_PATH
  git rebase --abort                  # Abandon rebase, return to pre-rebase state
  bd open ${dep} --reason "Rebase failed, reopening"  # Reopen the task

EOF
                REBASE_FAILED+=("$dep")

                # Return to epic branch before continuing
                git checkout "epic/${EPIC_ROOT}" 2>/dev/null || true
                continue
            fi

            log_info "Rebased: ${dep}"
            REBASED+=("$dep")
        done

        # Return to epic branch
        git checkout "epic/${EPIC_ROOT}" 2>/dev/null || true
    ) || true
}

# =============================================================================
# TASK FUNCTIONS
# =============================================================================

close_task_bead() {
    log_info "Closing task bead..."

    bd --cwd "$PROJECT_ROOT" close "$TASK_ID" \
        --reason "Merged to epic, dependents rebased" 2>/dev/null || \
        die "Failed to close task bead"

    log_info "Task closed: $TASK_ID"
}

# =============================================================================
# BUS NOTIFICATION
# =============================================================================

notify_bus_worker_done() {
    # Notify the claude-bus that this worker has completed its task.
    # This is non-blocking - if the bus is not running, we log a warning
    # but don't fail the task completion.
    #
    # The bus uses this notification to:
    # 1. Mark the worker as available in LRU queue
    # 2. Dispatch any queued tasks to the now-available worker

    log_info "Notifying bus of task completion..."

    # Check if claude-bus CLI is available
    if ! command -v claude-bus &>/dev/null; then
        log_warn "claude-bus CLI not found - skipping bus notification"
        log_warn "Bus can recover by checking: bd list --status in_progress"
        return 0
    fi

    # Send notification (non-blocking - don't fail if bus is unavailable)
    if claude-bus notify-done "$TASK_ID" 2>/dev/null; then
        log_info "Bus notified: worker available for next task"
    else
        log_warn "Bus notification failed (bus may not be running)"
        log_warn "Bus can recover by checking: bd list --status in_progress"
    fi

    return 0
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    # Parse arguments
    case "${1:-}" in
        -h|--help)
            usage
            ;;
        -v|--version)
            echo "$SCRIPT_NAME v$VERSION"
            exit 0
            ;;
        "")
            usage
            ;;
        *)
            TASK_ID="$1"
            ;;
    esac

    # Extract epic root from task ID
    # bd-abc123.1 -> bd-abc123
    EPIC_ROOT="${TASK_ID%%.*}"

    # Validate inputs and environment
    validate_inputs
    validate_task_exists
    validate_epic
    validate_worktree
    validate_task_branch

    # Perform merge
    commit_and_merge_task

    # Rebase dependents
    rebase_dependent_tasks

    # Close task
    close_task_bead

    # Notify bus that worker is available
    notify_bus_worker_done

    # Output success
    log_info "Task completion successful!"
    log_info "  Merged to epic: $TASK_ID -> $EPIC_ROOT"
    if [[ ${#REBASED[@]} -gt 0 ]]; then
        log_info "  Rebased dependents: ${REBASED[*]}"
    fi
    if [[ ${#REBASE_FAILED[@]} -gt 0 ]]; then
        log_warn "  Rebase failed for: ${REBASE_FAILED[*]}"
        log_warn "  These tasks may need manual attention"
    fi

    # Output JSON status
    output_status
}

main "$@"
