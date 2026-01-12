#!/usr/bin/env bash
#
# decompose-init.sh - Initialize an epic with worktree for feature decomposition
#
# Usage: decompose-init.sh "Feature name" "Description"
# Output: epic_id on success, exits non-zero on failure
#
# This script:
# 1. Creates an epic bead with -t epic
# 2. Creates epic branch from current HEAD
# 3. Creates worktree at .worktrees/{epic_id}/
# 4. Sets active-branch label for merge-up
# 5. Updates .gitignore
# 6. Validates everything worked
#

set -euo pipefail

SCRIPT_NAME="decompose-init.sh"

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
Usage: $SCRIPT_NAME "Feature name" "Description"

Creates an epic bead with worktree for feature decomposition.

Arguments:
    Feature name    Name of the feature/epic (used in bead title)
    Description     Description of the feature

Output:
    Prints epic_id to stdout on success

Example:
    epic_id=\$($SCRIPT_NAME "Auth System" "User authentication with JWT")
EOF
    exit 1
}

# =============================================================================
# VALIDATION
# =============================================================================

[[ $# -lt 2 ]] && usage

feature_name="$1"
description="$2"

# Must be in a git repo
git rev-parse --git-dir &>/dev/null || die "Not in a git repository"

# Must have bd command
command -v bd &>/dev/null || die "bd command not found"

# Must have jq for JSON parsing
command -v jq &>/dev/null || die "jq command not found"

# Get project root
project_root=$(git rev-parse --show-toplevel)
active_branch=$(git branch --show-current)

[[ -z "$active_branch" ]] && die "Not on a branch (detached HEAD?)"

log_info "Creating epic: $feature_name"
log_info "Active branch: $active_branch"

# =============================================================================
# CREATE EPIC BEAD
# =============================================================================

log_info "Creating epic bead..."

epic_json=$(bd create "Epic: ${feature_name}" -t epic -p 0 -d "$description" --json 2>/dev/null) \
    || die "Failed to create epic bead"

epic_id=$(echo "$epic_json" | jq -r '.id // empty')
[[ -z "$epic_id" ]] && die "Failed to parse epic ID from: $epic_json"

log_info "Created epic: $epic_id"

# =============================================================================
# CREATE BRANCH AND WORKTREE
# =============================================================================

log_info "Creating epic branch..."

# Create branch from current HEAD
git branch "epic/${epic_id}" || die "Failed to create branch epic/${epic_id}"

log_info "Creating worktree..."

# Create worktrees directory if needed
mkdir -p "${project_root}/.worktrees"

# Create worktree
git worktree add "${project_root}/.worktrees/${epic_id}" "epic/${epic_id}" \
    || die "Failed to create worktree at .worktrees/${epic_id}"

# =============================================================================
# SET METADATA
# =============================================================================

log_info "Setting active-branch label..."

bd update "$epic_id" --add-label "active-branch:${active_branch}" \
    || log_warn "Failed to set active-branch label (continuing anyway)"

# =============================================================================
# UPDATE .gitignore
# =============================================================================

if ! grep -q "^\.worktrees/$" "${project_root}/.gitignore" 2>/dev/null; then
    log_info "Adding .worktrees/ to .gitignore..."
    echo ".worktrees/" >> "${project_root}/.gitignore"
fi

# =============================================================================
# VALIDATION
# =============================================================================

log_info "Validating..."

# Check worktree exists
if ! git worktree list | grep -q "${epic_id}"; then
    die "Validation failed: Worktree not found in 'git worktree list'"
fi

# Check branch exists
if ! git rev-parse --verify "epic/${epic_id}" &>/dev/null; then
    die "Validation failed: Branch epic/${epic_id} not found"
fi

# Check worktree directory exists
if [[ ! -d "${project_root}/.worktrees/${epic_id}" ]]; then
    die "Validation failed: Worktree directory not found"
fi

log_info "Epic created successfully!"
log_info "  Epic ID: $epic_id"
log_info "  Branch: epic/${epic_id}"
log_info "  Worktree: .worktrees/${epic_id}/"
log_info "  Merge target: $active_branch"

# Output epic_id to stdout (only this goes to stdout, rest is stderr)
echo "$epic_id"
