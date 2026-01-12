#!/usr/bin/env bash
# gitlab-stack.sh - Manage stacked MR workflows
# Usage: gitlab-stack.sh <command> <stack-name> [options]
set -euo pipefail

readonly VERSION="1.0.0"
readonly SCRIPT_NAME="gitlab-stack.sh"

# Exit codes
readonly EXIT_SUCCESS=0 EXIT_ERROR=1 EXIT_VALIDATION=2 EXIT_AUTH=3 EXIT_CONFLICT=4 EXIT_ROLLBACK=5

# Globals
PROJECT_ROOT="" CURRENT_PHASE="" STACK_NAME=""
CREATED_MRS=()

# Logging
log_info() { echo "[INFO] $*"; }
log_error() { echo "[ERROR] $*" >&2; }
die() { log_error "$1"; exit "${2:-$EXIT_ERROR}"; }

# =============================================================================
# VALIDATION FUNCTIONS
# =============================================================================

validate_stack_name() {
    local name="$1"
    [[ -z "$name" ]] && { log_error "Stack name cannot be empty"; return 1; }
    [[ "$name" == bd-* ]] && { log_error "Stack name cannot start with 'bd-' (reserved for beads)"; return 1; }
    [[ "$name" == */* ]] && { log_error "Stack name cannot contain '/' (used in branch paths)"; return 1; }
    [[ "$name" == *" "* ]] && { log_error "Stack name cannot contain spaces"; return 1; }
    [[ "$name" == -* ]] && { log_error "Stack name cannot start with '-'"; return 1; }
    git check-ref-format --branch "stack/${name}" >/dev/null 2>&1 || { log_error "Stack name '${name}' is not valid for git branches"; return 1; }
    return 0
}

validate_manifest() {
    local manifest_file="$1"
    [[ ! -f "$manifest_file" ]] && { log_error "Manifest file not found: $manifest_file"; return 1; }
    jq empty "$manifest_file" 2>/dev/null || { log_error "Manifest is not valid JSON: $manifest_file"; return 1; }

    local required=("stack_name" "source_branch" "target_branch" "leaves")
    for field in "${required[@]}"; do
        jq -e ".$field" "$manifest_file" >/dev/null 2>&1 || { log_error "Manifest missing required field: $field"; return 1; }
    done

    local manifest_stack_name; manifest_stack_name=$(jq -r '.stack_name' "$manifest_file")
    [[ "$manifest_stack_name" != "$STACK_NAME" ]] && { log_error "Manifest stack_name mismatch"; return 1; }

    local leaves_count; leaves_count=$(jq '.leaves | length' "$manifest_file")
    [[ "$leaves_count" -eq 0 ]] && { log_error "Manifest must have at least one leaf"; return 1; }

    for i in $(seq 0 $((leaves_count - 1))); do
        for field in id title files; do
            jq -e ".leaves[$i].$field" "$manifest_file" >/dev/null 2>&1 || { log_error "Leaf $i missing field: $field"; return 1; }
        done
    done
    log_info "Manifest validation passed"
}

check_glab_auth() {
    command -v glab &>/dev/null || { log_error "glab command not found"; return 1; }
    glab auth status &>/dev/null || { log_error "GitLab CLI not authenticated. Run 'glab auth login'"; return 1; }
    glab api projects/:fullpath &>/dev/null || { log_error "Cannot access current GitLab project"; return 1; }
    log_info "GitLab authentication verified"
}

check_branch_available() {
    local stack_name="$1" branch_name="stack/${stack_name}"
    git rev-parse --verify "$branch_name" >/dev/null 2>&1 && { log_error "Local branch '$branch_name' already exists"; return 1; }
    git ls-remote --heads origin "$branch_name" 2>/dev/null | grep -q . && { log_error "Remote branch '$branch_name' already exists"; return 1; }
    log_info "Branch name '$branch_name' is available"
}

validate_source_files() {
    local manifest_file="$1"
    local source_branch; source_branch=$(jq -r '.source_branch' "$manifest_file")
    local files; files=$(jq -r '.leaves[].files[].path' "$manifest_file" 2>/dev/null || echo "")
    [[ -z "$files" ]] && { log_info "No files specified in manifest"; return 0; }

    while IFS= read -r filepath; do
        git cat-file -e "${source_branch}:${filepath}" 2>/dev/null || { log_error "Missing file: $filepath in $source_branch"; return 1; }
    done <<< "$files"
    log_info "All source files validated"
}

# =============================================================================
# ROLLBACK FUNCTION
# =============================================================================

rollback_stack() {
    local stack_name="$1" project_root="$2"
    echo ""; log_error "Stack creation failed. Rolling back..."

    # Close MRs
    for mr in "${CREATED_MRS[@]}"; do
        log_info "Closing MR !${mr}..."; glab mr close "$mr" 2>/dev/null || true
    done

    # Check tracking doc for additional MRs
    local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"
    if [[ -f "$tracking_doc" ]]; then
        local doc_mrs; doc_mrs=$(grep -oE '![0-9]+' "$tracking_doc" 2>/dev/null | sort -u | tr -d '!' || echo "")
        for mr in $doc_mrs; do
            [[ ! " ${CREATED_MRS[*]} " =~ " ${mr} " ]] && { log_info "Closing MR !${mr}..."; glab mr close "$mr" 2>/dev/null || true; }
        done
        rm -f "$tracking_doc"
    fi

    # Remove worktree
    local worktree_path="${project_root}/.worktrees/${stack_name}"
    [[ -d "$worktree_path" ]] && { log_info "Removing worktree..."; git worktree remove --force "$worktree_path" 2>/dev/null || true; }

    # Delete branches
    log_info "Cleaning up branches..."
    git branch -D "stack/${stack_name}" 2>/dev/null || true
    git for-each-ref --format='%(refname:short)' "refs/heads/stack/${stack_name}/" 2>/dev/null | xargs -r git branch -D 2>/dev/null || true
    git push origin --delete "stack/${stack_name}" 2>/dev/null || true
    git for-each-ref --format='%(refname:short)' "refs/remotes/origin/stack/${stack_name}/" 2>/dev/null | sed 's|origin/||' | xargs -r -I{} git push origin --delete {} 2>/dev/null || true

    log_info "Rollback complete."
    exit "$EXIT_ROLLBACK"
}

on_error() {
    local exit_code=$?
    [[ "$CURRENT_PHASE" == "CREATE" && -n "$STACK_NAME" && -n "$PROJECT_ROOT" ]] && rollback_stack "$STACK_NAME" "$PROJECT_ROOT"
    exit "$exit_code"
}

# =============================================================================
# FILE INTEGRITY FUNCTIONS
# =============================================================================

# -----------------------------------------------------------------------------
# Binary File Detection
# -----------------------------------------------------------------------------
# Detects if a file is binary based on MIME encoding.
# Returns 0 (true) for binary files, 1 (false) for text files.
# When detection fails, treats file as binary (safe default).
#
# Usage: is_binary <filepath>
#        is_binary_in_branch <branch> <filepath>
# -----------------------------------------------------------------------------

is_binary() {
    local filepath="$1"

    # File must exist for local check
    if [[ ! -f "$filepath" ]]; then
        log_error "is_binary: File not found: $filepath"
        return 0  # Treat as binary (safe default)
    fi

    local mime_encoding
    mime_encoding=$(file --mime-encoding "$filepath" 2>/dev/null)

    # If file command fails, treat as binary (safe default)
    if [[ -z "$mime_encoding" ]]; then
        log_info "is_binary: Could not determine encoding for $filepath, treating as binary"
        return 0
    fi

    # Check for binary encoding
    if echo "$mime_encoding" | grep -q "binary"; then
        return 0  # Binary
    fi

    return 1  # Text
}

# Check if a file in a git branch is binary
# This extracts the file to a temp location for detection
is_binary_in_branch() {
    local branch="$1"
    local filepath="$2"
    local tmpfile

    # Verify file exists in branch
    if ! git cat-file -e "${branch}:${filepath}" 2>/dev/null; then
        log_error "is_binary_in_branch: File not found in ${branch}: $filepath"
        return 0  # Treat as binary (safe default)
    fi

    # Extract to temp file for detection
    tmpfile=$(mktemp)
    trap "rm -f '$tmpfile'" RETURN

    if ! git show "${branch}:${filepath}" > "$tmpfile" 2>/dev/null; then
        log_error "is_binary_in_branch: Could not extract file from ${branch}: $filepath"
        return 0  # Treat as binary (safe default)
    fi

    is_binary "$tmpfile"
}

# Get file type classification for logging/reporting
# Returns: "binary", "text", or "unknown"
get_file_type() {
    local filepath="$1"

    if [[ ! -f "$filepath" ]]; then
        echo "unknown"
        return
    fi

    local mime_encoding
    mime_encoding=$(file --mime-encoding "$filepath" 2>/dev/null)

    if [[ -z "$mime_encoding" ]]; then
        echo "unknown"
    elif echo "$mime_encoding" | grep -q "binary"; then
        echo "binary"
    else
        echo "text"
    fi
}

# -----------------------------------------------------------------------------
# Safe File Copy
# -----------------------------------------------------------------------------
# Copies files from source branch preserving exact content.
# - Text files: uses `git show` (allows streaming/piping)
# - Binary files: uses `git checkout` (byte-exact copy)
#
# Usage: copy_file <src_branch> <filepath>
#        copy_file_safe <src_branch> <dest_branch> <filepath>
# -----------------------------------------------------------------------------

copy_file() {
    local src_branch="$1"
    local filepath="$2"

    # Validate inputs
    if [[ -z "$src_branch" || -z "$filepath" ]]; then
        log_error "copy_file: Missing required arguments"
        return 1
    fi

    # Verify file exists in source branch
    if ! git cat-file -e "${src_branch}:${filepath}" 2>/dev/null; then
        log_error "copy_file: File not found in ${src_branch}: $filepath"
        return 1
    fi

    # Ensure parent directory exists
    local parent_dir
    parent_dir=$(dirname "$filepath")
    if [[ "$parent_dir" != "." && ! -d "$parent_dir" ]]; then
        mkdir -p "$parent_dir"
    fi

    # Determine file type and copy appropriately
    if is_binary_in_branch "$src_branch" "$filepath"; then
        # Binary: use git checkout for exact byte copy
        log_info "copy_file: Binary copy: $filepath"
        git checkout "$src_branch" -- "$filepath"
    else
        # Text: use git show (supports streaming)
        log_info "copy_file: Text copy: $filepath"
        git show "${src_branch}:${filepath}" > "$filepath"
    fi

    git add "$filepath"
    return 0
}

# Full safe copy with explicit source and destination branches
# Switches to dest_branch before copying
copy_file_safe() {
    local src_branch="$1"
    local dest_branch="$2"
    local filepath="$3"

    # Validate inputs
    if [[ -z "$src_branch" || -z "$dest_branch" || -z "$filepath" ]]; then
        log_error "copy_file_safe: Missing required arguments"
        return 1
    fi

    # Switch to destination branch
    git checkout "$dest_branch" 2>/dev/null || {
        log_error "copy_file_safe: Could not checkout $dest_branch"
        return 1
    }

    copy_file "$src_branch" "$filepath"
}

# Copy entire directory from source branch
copy_dir_safe() {
    local src_branch="$1"
    local dirpath="$2"

    # Validate inputs
    if [[ -z "$src_branch" || -z "$dirpath" ]]; then
        log_error "copy_dir_safe: Missing required arguments"
        return 1
    fi

    # Remove trailing slash for consistency
    dirpath="${dirpath%/}"

    # Get list of files in directory from source branch
    local files
    files=$(git ls-tree -r --name-only "${src_branch}" -- "$dirpath" 2>/dev/null)

    if [[ -z "$files" ]]; then
        log_error "copy_dir_safe: No files found in ${src_branch}:${dirpath}"
        return 1
    fi

    # Copy each file
    while IFS= read -r file; do
        copy_file "$src_branch" "$file" || return 1
    done <<< "$files"

    return 0
}

# -----------------------------------------------------------------------------
# UTF-8/CRLF Safe File Splitting
# -----------------------------------------------------------------------------
# Splits files by line range using awk for safer handling of:
# - Multi-byte UTF-8 characters at boundaries
# - CRLF line endings
# - Files without trailing newlines
# - BOM markers
#
# Usage: split_file_safe <src_file> <start_line> <end_line> <dest_file>
#        split_file_from_branch <src_branch> <src_file> <start_line> <end_line> <dest_file>
# -----------------------------------------------------------------------------

split_file_safe() {
    local src_file="$1"
    local start_line="$2"
    local end_line="$3"
    local dest_file="$4"

    # Validate inputs
    if [[ -z "$src_file" || -z "$start_line" || -z "$end_line" || -z "$dest_file" ]]; then
        log_error "split_file_safe: Missing required arguments"
        log_error "Usage: split_file_safe <src_file> <start_line> <end_line> <dest_file>"
        return 1
    fi

    # Validate source file exists
    if [[ ! -f "$src_file" ]]; then
        log_error "split_file_safe: Source file not found: $src_file"
        return 1
    fi

    # Validate line numbers are positive integers
    if ! [[ "$start_line" =~ ^[0-9]+$ && "$end_line" =~ ^[0-9]+$ ]]; then
        log_error "split_file_safe: Line numbers must be positive integers"
        return 1
    fi

    if [[ "$start_line" -lt 1 ]]; then
        log_error "split_file_safe: Start line must be >= 1"
        return 1
    fi

    if [[ "$start_line" -gt "$end_line" ]]; then
        log_error "split_file_safe: Start line ($start_line) cannot be greater than end line ($end_line)"
        return 1
    fi

    # Check if source is binary
    if is_binary "$src_file"; then
        log_error "split_file_safe: Cannot split binary file: $src_file"
        return 1
    fi

    # Ensure parent directory exists
    local parent_dir
    parent_dir=$(dirname "$dest_file")
    if [[ "$parent_dir" != "." && ! -d "$parent_dir" ]]; then
        mkdir -p "$parent_dir"
    fi

    # Use awk for safer line extraction
    # awk handles multi-byte UTF-8 better than sed in most implementations
    awk -v start="$start_line" -v end="$end_line" \
        'NR >= start && NR <= end' "$src_file" > "$dest_file"

    local awk_exit=$?
    if [[ $awk_exit -ne 0 ]]; then
        log_error "split_file_safe: awk extraction failed with exit code $awk_exit"
        rm -f "$dest_file"
        return 1
    fi

    # Validate output encoding
    if ! validate_split_encoding "$dest_file"; then
        log_error "split_file_safe: Output encoding validation failed for $dest_file"
        log_error "  Source: $src_file, lines $start_line-$end_line"
        return 1
    fi

    log_info "split_file_safe: Extracted lines $start_line-$end_line from $src_file to $dest_file"
    return 0
}

# Split a file directly from a git branch
split_file_from_branch() {
    local src_branch="$1"
    local src_file="$2"
    local start_line="$3"
    local end_line="$4"
    local dest_file="$5"

    # Validate inputs
    if [[ -z "$src_branch" || -z "$src_file" || -z "$start_line" || -z "$end_line" || -z "$dest_file" ]]; then
        log_error "split_file_from_branch: Missing required arguments"
        return 1
    fi

    # Verify file exists in branch
    if ! git cat-file -e "${src_branch}:${src_file}" 2>/dev/null; then
        log_error "split_file_from_branch: File not found in ${src_branch}: $src_file"
        return 1
    fi

    # Check if file is binary in branch
    if is_binary_in_branch "$src_branch" "$src_file"; then
        log_error "split_file_from_branch: Cannot split binary file: ${src_branch}:${src_file}"
        return 1
    fi

    # Ensure parent directory exists
    local parent_dir
    parent_dir=$(dirname "$dest_file")
    if [[ "$parent_dir" != "." && ! -d "$parent_dir" ]]; then
        mkdir -p "$parent_dir"
    fi

    # Extract line range directly from branch using git show | awk
    git show "${src_branch}:${src_file}" 2>/dev/null | \
        awk -v start="$start_line" -v end="$end_line" \
            'NR >= start && NR <= end' > "$dest_file"

    local pipe_status=("${PIPESTATUS[@]}")
    if [[ ${pipe_status[0]} -ne 0 ]]; then
        log_error "split_file_from_branch: git show failed"
        rm -f "$dest_file"
        return 1
    fi
    if [[ ${pipe_status[1]} -ne 0 ]]; then
        log_error "split_file_from_branch: awk extraction failed"
        rm -f "$dest_file"
        return 1
    fi

    # Validate output encoding
    if ! validate_split_encoding "$dest_file"; then
        log_error "split_file_from_branch: Output encoding validation failed for $dest_file"
        return 1
    fi

    log_info "split_file_from_branch: Extracted lines $start_line-$end_line from ${src_branch}:${src_file}"
    return 0
}

# Validate encoding of split output
# Returns 0 if valid text, 1 if potentially corrupted
validate_split_encoding() {
    local filepath="$1"

    if [[ ! -f "$filepath" ]]; then
        return 1
    fi

    # Empty files are valid
    if [[ ! -s "$filepath" ]]; then
        return 0
    fi

    # Use file command to check output
    local file_output
    file_output=$(file "$filepath" 2>/dev/null)

    # Check for text or empty (both valid)
    if echo "$file_output" | grep -qE "(text|empty|ASCII)"; then
        return 0
    fi

    # Check for common text encodings
    local mime_encoding
    mime_encoding=$(file --mime-encoding "$filepath" 2>/dev/null)

    case "$mime_encoding" in
        *utf-8*|*utf-16*|*ascii*|*iso-8859*|*us-ascii*)
            return 0
            ;;
        *binary*)
            log_error "validate_split_encoding: File appears to be binary after split"
            return 1
            ;;
        *)
            # Unknown encoding - warn but allow
            log_info "validate_split_encoding: Unknown encoding '$mime_encoding' for $filepath"
            return 0
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Pre-Split Validation Helpers
# -----------------------------------------------------------------------------
# Validates that split boundaries don't break syntax structures.
# These are heuristic checks - not full parsing.
#
# Usage: validate_split_boundary <filepath> <line_number>
#        check_balanced_delimiters <filepath> <start_line> <end_line>
#        validate_split_manifest <manifest_file>
# -----------------------------------------------------------------------------

# Check if a line boundary is safe for splitting
# Returns 0 if safe, 1 if potentially dangerous
validate_split_boundary() {
    local filepath="$1"
    local line_num="$2"

    if [[ ! -f "$filepath" ]]; then
        log_error "validate_split_boundary: File not found: $filepath"
        return 1
    fi

    local total_lines
    total_lines=$(wc -l < "$filepath")

    # Boundary at EOF is always safe
    if [[ "$line_num" -ge "$total_lines" ]]; then
        return 0
    fi

    # Get the line and next line for context
    local current_line next_line
    current_line=$(awk -v n="$line_num" 'NR == n' "$filepath")
    next_line=$(awk -v n="$((line_num + 1))" 'NR == n' "$filepath")

    # Check for multi-line string continuation (common patterns)
    # Pattern: line ends with \ (continuation)
    if [[ "$current_line" =~ \\$ ]]; then
        log_error "validate_split_boundary: Line $line_num ends with continuation character"
        return 1
    fi

    # Pattern: unclosed quote
    local quote_count_single quote_count_double
    quote_count_single=$(echo "$current_line" | tr -cd "'" | wc -c)
    quote_count_double=$(echo "$current_line" | tr -cd '"' | wc -c)

    if [[ $((quote_count_single % 2)) -ne 0 ]]; then
        log_error "validate_split_boundary: Line $line_num has unclosed single quote"
        return 1
    fi
    if [[ $((quote_count_double % 2)) -ne 0 ]]; then
        log_error "validate_split_boundary: Line $line_num has unclosed double quote"
        return 1
    fi

    # Check for heredoc start without end
    if [[ "$current_line" =~ \<\<[\'\"]*[A-Za-z_][A-Za-z0-9_]*[\'\"]*$ ]]; then
        log_error "validate_split_boundary: Line $line_num starts a heredoc"
        return 1
    fi

    return 0
}

# Check if delimiters are balanced in a range
# Checks: {}, [], (), <>, ``
check_balanced_delimiters() {
    local filepath="$1"
    local start_line="$2"
    local end_line="$3"

    if [[ ! -f "$filepath" ]]; then
        log_error "check_balanced_delimiters: File not found: $filepath"
        return 1
    fi

    # Extract the range
    local content
    content=$(awk -v start="$start_line" -v end="$end_line" \
        'NR >= start && NR <= end' "$filepath")

    # Count delimiters (simple heuristic - doesn't handle strings/comments)
    local open_braces close_braces
    local open_brackets close_brackets
    local open_parens close_parens

    open_braces=$(echo "$content" | tr -cd '{' | wc -c)
    close_braces=$(echo "$content" | tr -cd '}' | wc -c)
    open_brackets=$(echo "$content" | tr -cd '[' | wc -c)
    close_brackets=$(echo "$content" | tr -cd ']' | wc -c)
    open_parens=$(echo "$content" | tr -cd '(' | wc -c)
    close_parens=$(echo "$content" | tr -cd ')' | wc -c)

    local issues=()

    if [[ "$open_braces" -ne "$close_braces" ]]; then
        issues+=("braces: $open_braces open, $close_braces close")
    fi
    if [[ "$open_brackets" -ne "$close_brackets" ]]; then
        issues+=("brackets: $open_brackets open, $close_brackets close")
    fi
    if [[ "$open_parens" -ne "$close_parens" ]]; then
        issues+=("parens: $open_parens open, $close_parens close")
    fi

    if [[ ${#issues[@]} -gt 0 ]]; then
        log_error "check_balanced_delimiters: Unbalanced delimiters in lines $start_line-$end_line"
        for issue in "${issues[@]}"; do
            log_error "  - $issue"
        done
        return 1
    fi

    return 0
}

# Validate all splits in a manifest file
# Returns 0 if all splits are valid, 1 if any issues found
validate_split_manifest() {
    local manifest_file="$1"

    if [[ ! -f "$manifest_file" ]]; then
        log_error "validate_split_manifest: Manifest not found: $manifest_file"
        return 1
    fi

    # Check if manifest has file_splits section
    local has_splits
    has_splits=$(jq 'has("file_splits")' "$manifest_file" 2>/dev/null)

    if [[ "$has_splits" != "true" ]]; then
        log_info "validate_split_manifest: No file_splits in manifest, skipping validation"
        return 0
    fi

    local splits_count
    splits_count=$(jq '.file_splits | length' "$manifest_file")

    if [[ "$splits_count" -eq 0 ]]; then
        return 0
    fi

    local source_branch
    source_branch=$(jq -r '.source_branch' "$manifest_file")
    local issues=0

    for i in $(seq 0 $((splits_count - 1))); do
        local source_file
        source_file=$(jq -r ".file_splits[$i].source" "$manifest_file")

        # Check source file exists
        if ! git cat-file -e "${source_branch}:${source_file}" 2>/dev/null; then
            log_error "validate_split_manifest: Source file not found: ${source_branch}:${source_file}"
            ((issues++))
            continue
        fi

        # Check if binary
        if is_binary_in_branch "$source_branch" "$source_file"; then
            log_error "validate_split_manifest: Cannot split binary file: $source_file"
            ((issues++))
            continue
        fi

        # Extract to temp for validation
        local tmpfile
        tmpfile=$(mktemp)
        git show "${source_branch}:${source_file}" > "$tmpfile" 2>/dev/null

        local total_lines
        total_lines=$(wc -l < "$tmpfile")

        # Validate each split range
        local split_count
        split_count=$(jq ".file_splits[$i].splits | length" "$manifest_file")

        for j in $(seq 0 $((split_count - 1))); do
            local lines_spec start_line end_line
            lines_spec=$(jq -r ".file_splits[$i].splits[$j].lines" "$manifest_file")

            # Parse "start-end" format
            start_line=$(echo "$lines_spec" | cut -d'-' -f1)
            end_line=$(echo "$lines_spec" | cut -d'-' -f2)

            # Validate range
            if [[ "$end_line" -gt "$total_lines" ]]; then
                log_error "validate_split_manifest: Split range $lines_spec exceeds file length ($total_lines) for $source_file"
                ((issues++))
            fi

            # Validate boundary
            if ! validate_split_boundary "$tmpfile" "$end_line"; then
                log_error "validate_split_manifest: Unsafe split boundary at line $end_line in $source_file"
                ((issues++))
            fi

            # Check balanced delimiters
            if ! check_balanced_delimiters "$tmpfile" "$start_line" "$end_line"; then
                log_error "validate_split_manifest: Unbalanced delimiters in split $lines_spec of $source_file"
                ((issues++))
            fi
        done

        rm -f "$tmpfile"
    done

    if [[ "$issues" -gt 0 ]]; then
        log_error "validate_split_manifest: Found $issues issue(s) in split definitions"
        return 1
    fi

    log_info "validate_split_manifest: All splits validated successfully"
    return 0
}

# Get line count for a file in a branch
get_line_count() {
    local branch="$1"
    local filepath="$2"

    if ! git cat-file -e "${branch}:${filepath}" 2>/dev/null; then
        echo "0"
        return
    fi

    git show "${branch}:${filepath}" 2>/dev/null | wc -l
}

# Detect line ending type in a file
# Returns: "lf", "crlf", "mixed", or "unknown"
detect_line_endings() {
    local filepath="$1"

    if [[ ! -f "$filepath" ]]; then
        echo "unknown"
        return
    fi

    local crlf_count lf_count
    crlf_count=$(grep -c $'\r$' "$filepath" 2>/dev/null || echo "0")
    lf_count=$(grep -c $'[^\r]$' "$filepath" 2>/dev/null || echo "0")

    if [[ "$crlf_count" -gt 0 && "$lf_count" -gt 0 ]]; then
        echo "mixed"
    elif [[ "$crlf_count" -gt 0 ]]; then
        echo "crlf"
    elif [[ "$lf_count" -gt 0 ]]; then
        echo "lf"
    else
        echo "unknown"
    fi
}

# Normalize line endings to LF
normalize_line_endings() {
    local filepath="$1"

    if [[ ! -f "$filepath" ]]; then
        log_error "normalize_line_endings: File not found: $filepath"
        return 1
    fi

    # Check if we need to normalize
    local ending_type
    ending_type=$(detect_line_endings "$filepath")

    case "$ending_type" in
        lf)
            # Already normalized
            return 0
            ;;
        crlf|mixed)
            log_info "normalize_line_endings: Converting $ending_type to LF for $filepath"
            # Use tr to remove carriage returns (more portable than sed)
            local tmpfile
            tmpfile=$(mktemp)
            tr -d '\r' < "$filepath" > "$tmpfile"
            mv "$tmpfile" "$filepath"
            return 0
            ;;
        *)
            # Unknown or empty - leave as is
            return 0
            ;;
    esac
}

# Check for BOM (Byte Order Mark) at start of file
has_bom() {
    local filepath="$1"

    if [[ ! -f "$filepath" ]]; then
        return 1
    fi

    # UTF-8 BOM is 0xEF 0xBB 0xBF
    local first_bytes
    first_bytes=$(head -c 3 "$filepath" | xxd -p 2>/dev/null || echo "")

    [[ "$first_bytes" == "efbbbf" ]]
}

# Preserve BOM in first split only
handle_bom_in_split() {
    local src_file="$1"
    local dest_file="$2"
    local is_first_split="$3"  # "true" or "false"

    if [[ "$is_first_split" != "true" ]]; then
        # Not first split - remove BOM if present
        if has_bom "$dest_file"; then
            log_info "handle_bom_in_split: Removing BOM from non-first split: $dest_file"
            local tmpfile
            tmpfile=$(mktemp)
            tail -c +4 "$dest_file" > "$tmpfile"
            mv "$tmpfile" "$dest_file"
        fi
        return 0
    fi

    # First split - preserve BOM from source if present
    if has_bom "$src_file" && ! has_bom "$dest_file"; then
        log_info "handle_bom_in_split: Preserving BOM in first split: $dest_file"
        local tmpfile
        tmpfile=$(mktemp)
        printf '\xEF\xBB\xBF' > "$tmpfile"
        cat "$dest_file" >> "$tmpfile"
        mv "$tmpfile" "$dest_file"
    fi

    return 0
}

# =============================================================================
# COMMAND: CREATE
# =============================================================================

cmd_create() {
    local stack_name="$1" manifest_file="$2"
    STACK_NAME="$stack_name"
    PROJECT_ROOT=$(git rev-parse --show-toplevel)

    # Phase 1: VALIDATE
    CURRENT_PHASE="VALIDATE"
    echo ""; echo "===== Phase: VALIDATE ====="
    validate_stack_name "$stack_name" || exit "$EXIT_VALIDATION"
    validate_manifest "$manifest_file" || exit "$EXIT_VALIDATION"
    validate_source_files "$manifest_file" || exit "$EXIT_VALIDATION"
    check_glab_auth || exit "$EXIT_AUTH"
    check_branch_available "$stack_name" || exit "$EXIT_CONFLICT"
    log_info "Validation complete"

    # Phase 2: CREATE (with rollback)
    CURRENT_PHASE="CREATE"
    echo ""; echo "===== Phase: CREATE ====="
    trap 'on_error' ERR

    # Create worktree
    git branch "stack/${stack_name}"
    mkdir -p "${PROJECT_ROOT}/.worktrees"
    git worktree add "${PROJECT_ROOT}/.worktrees/${stack_name}" "stack/${stack_name}"
    grep -q "^\.worktrees/$" "${PROJECT_ROOT}/.gitignore" 2>/dev/null || echo ".worktrees/" >> "${PROJECT_ROOT}/.gitignore"

    # Create leaf branches
    local leaves_count; leaves_count=$(jq '.leaves | length' "$manifest_file")
    local source_branch; source_branch=$(jq -r '.source_branch' "$manifest_file")
    local worktree_path="${PROJECT_ROOT}/.worktrees/${stack_name}"

    for i in $(seq 0 $((leaves_count - 1))); do
        local leaf_id; leaf_id=$(jq -r ".leaves[$i].id" "$manifest_file")
        (cd "$worktree_path" && git checkout -b "stack/${stack_name}/${leaf_id}" "stack/${stack_name}")
        log_info "Created branch: stack/${stack_name}/${leaf_id}"
    done

    # Copy files
    for i in $(seq 0 $((leaves_count - 1))); do
        local leaf_id; leaf_id=$(jq -r ".leaves[$i].id" "$manifest_file")
        local files_count; files_count=$(jq ".leaves[$i].files | length" "$manifest_file")
        [[ "$files_count" -eq 0 ]] && continue

        (
            cd "$worktree_path"
            git checkout "stack/${stack_name}/${leaf_id}"
            for j in $(seq 0 $((files_count - 1))); do
                local filepath; filepath=$(jq -r ".leaves[$i].files[$j].path" "$manifest_file")
                local operation; operation=$(jq -r ".leaves[$i].files[$j].operation // \"copy\"" "$manifest_file")
                case "$operation" in
                    copy) copy_file "$source_branch" "$filepath" ;;
                    copy_dir) git checkout "$source_branch" -- "$filepath"; git add "$filepath" ;;
                esac
            done
            git commit -m "Add files for ${leaf_id}" --allow-empty
        )
    done

    # Create MRs
    local target_branch; target_branch=$(jq -r '.target_branch' "$manifest_file")
    for i in $(seq 0 $((leaves_count - 1))); do
        local leaf_id leaf_title
        leaf_id=$(jq -r ".leaves[$i].id" "$manifest_file")
        leaf_title=$(jq -r ".leaves[$i].title" "$manifest_file")
        local mr_number; mr_number=$(glab mr create \
            --source-branch "stack/${stack_name}/${leaf_id}" \
            --target-branch "stack/${stack_name}" \
            --title "[${i}/$((leaves_count))] ${leaf_title}" \
            --description "Part of stack: ${stack_name}" \
            --no-editor 2>&1 | grep -oE '![0-9]+' | tr -d '!' || echo "")
        [[ -n "$mr_number" ]] && { CREATED_MRS+=("$mr_number"); log_info "Created MR !${mr_number} for ${leaf_id}"; }
    done

    # Root MR
    local root_mr; root_mr=$(glab mr create \
        --source-branch "stack/${stack_name}" \
        --target-branch "$target_branch" \
        --title "[Stack] ${stack_name}" \
        --description "Root MR for stack: ${stack_name}" \
        --no-editor 2>&1 | grep -oE '![0-9]+' | tr -d '!' || echo "")
    [[ -n "$root_mr" ]] && { CREATED_MRS+=("$root_mr"); log_info "Created root MR !${root_mr}"; }

    # Generate tracking doc
    mkdir -p "${PROJECT_ROOT}/docs/mr-stacks"
    cat > "${PROJECT_ROOT}/docs/mr-stacks/${stack_name}.md" << EOF
---
stack: ${stack_name}
created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
parent_branch: ${target_branch}
status: in_progress
---
# MR Stack: ${stack_name}
## Overview
| Field | Value |
|-------|-------|
| Created | $(date +"%Y-%m-%d") |
| Parent Branch | ${target_branch} |
| Worktree | .worktrees/${stack_name} |
| Status | in_progress |
## Notes
- $(date +"%Y-%m-%d"): Stack created
EOF

    # Phase 3: COMMIT
    CURRENT_PHASE="COMMIT"
    echo ""; echo "===== Phase: COMMIT ====="
    trap - ERR

    git push -u origin "stack/${stack_name}"
    for i in $(seq 0 $((leaves_count - 1))); do
        local leaf_id; leaf_id=$(jq -r ".leaves[$i].id" "$manifest_file")
        git push -u origin "stack/${stack_name}/${leaf_id}"
    done

    echo ""; log_info "Stack '$stack_name' created successfully!"
    log_info "Tracking doc: docs/mr-stacks/${stack_name}.md"
}

# =============================================================================
# COMMAND: STATUS
# =============================================================================

# Query GitLab for MR details including pipeline, approvals, threads
get_mr_status() {
    local mr_id="$1"
    local mr_data pipeline_status approvals_count threads_count state title

    # Fetch MR data
    mr_data=$(glab api "projects/:fullpath/merge_requests/${mr_id}" 2>/dev/null || echo "{}")
    [[ "$mr_data" == "{}" ]] && { echo "!${mr_id}|unknown|?|-|-|-"; return; }

    state=$(echo "$mr_data" | jq -r '.state // "unknown"')
    title=$(echo "$mr_data" | jq -r '.title // "Untitled"' | cut -c1-40)

    # Pipeline status
    pipeline_status=$(echo "$mr_data" | jq -r '.head_pipeline.status // "-"')
    case "$pipeline_status" in
        success) pipeline_status="passed" ;;
        failed) pipeline_status="FAILED" ;;
        running) pipeline_status="running" ;;
        pending) pipeline_status="pending" ;;
    esac

    # Approvals (requires approvals API endpoint)
    local approvals_data
    approvals_data=$(glab api "projects/:fullpath/merge_requests/${mr_id}/approvals" 2>/dev/null || echo "{}")
    approvals_count=$(echo "$approvals_data" | jq -r '(.approved_by | length) // 0')
    local approvals_required
    approvals_required=$(echo "$approvals_data" | jq -r '.approvals_required // 0')
    local approvals_display="${approvals_count}/${approvals_required}"

    # Unresolved threads
    local discussions
    discussions=$(glab api "projects/:fullpath/merge_requests/${mr_id}/discussions" 2>/dev/null || echo "[]")
    threads_count=$(echo "$discussions" | jq '[.[] | select(.notes[0].resolvable == true and .notes[0].resolved == false)] | length' 2>/dev/null || echo "0")

    echo "!${mr_id}|${state}|${pipeline_status}|${approvals_display}|${threads_count}|${title}"
}

cmd_status() {
    local stack_name="$1"
    local project_root; project_root=$(git rev-parse --show-toplevel)
    local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"

    [[ ! -f "$tracking_doc" ]] && die "Stack '$stack_name' not found. Tracking doc: $tracking_doc"

    # Read stack metadata from frontmatter
    local parent_branch status created
    parent_branch=$(grep -E "^parent_branch:" "$tracking_doc" 2>/dev/null | cut -d: -f2- | tr -d ' ' || echo "unknown")
    status=$(grep -E "^status:" "$tracking_doc" 2>/dev/null | cut -d: -f2- | tr -d ' ' || echo "unknown")
    created=$(grep -E "^created:" "$tracking_doc" 2>/dev/null | cut -d: -f2- | tr -d ' ' || echo "unknown")

    echo ""
    echo "================================"
    echo "Stack: ${stack_name}"
    echo "================================"
    echo ""
    echo "Created:       ${created}"
    echo "Target Branch: ${parent_branch}"
    echo "Status:        ${status}"
    echo "Worktree:      .worktrees/${stack_name}"
    echo ""

    # Extract MR numbers from tracking doc
    local mrs
    mrs=$(grep -oE '![0-9]+' "$tracking_doc" 2>/dev/null | sort -u | tr -d '!' || echo "")

    if [[ -z "$mrs" ]]; then
        echo "No MRs found in tracking document."
        echo ""
        echo "Tracking doc: $tracking_doc"
        return 0
    fi

    # Query GitLab for each MR
    echo "Querying GitLab for MR status..."
    echo ""
    echo "| MR | State | Pipeline | Approvals | Threads | Title |"
    echo "|----|-------|----------|-----------|---------|-------|"

    local merged_count=0 open_count=0 closed_count=0 total_count=0

    for mr in $mrs; do
        local mr_status_line
        mr_status_line=$(get_mr_status "$mr")

        local mr_num state pipeline approvals threads title
        mr_num=$(echo "$mr_status_line" | cut -d'|' -f1)
        state=$(echo "$mr_status_line" | cut -d'|' -f2)
        pipeline=$(echo "$mr_status_line" | cut -d'|' -f3)
        approvals=$(echo "$mr_status_line" | cut -d'|' -f4)
        threads=$(echo "$mr_status_line" | cut -d'|' -f5)
        title=$(echo "$mr_status_line" | cut -d'|' -f6)

        # Status icons
        local state_display
        case "$state" in
            merged) state_display="MERGED"; ((merged_count++)) ;;
            opened) state_display="OPEN"; ((open_count++)) ;;
            closed) state_display="CLOSED"; ((closed_count++)) ;;
            *) state_display="$state" ;;
        esac
        ((total_count++))

        # Thread warning
        local threads_display="$threads"
        [[ "$threads" != "0" && "$threads" != "-" ]] && threads_display="${threads} unresolved"

        echo "| ${mr_num} | ${state_display} | ${pipeline} | ${approvals} | ${threads_display} | ${title} |"
    done

    echo ""
    echo "Summary: ${merged_count}/${total_count} merged, ${open_count} open, ${closed_count} closed"
    echo ""
    echo "Tracking doc: $tracking_doc"
}

# =============================================================================
# COMMAND: SYNC
# =============================================================================

# Update MR status section in tracking doc
update_tracking_doc_mr_status() {
    local tracking_doc="$1"
    local status_table="$2"
    local sync_timestamp="$3"

    # Create a temp file for the new content
    local temp_file
    temp_file=$(mktemp)

    # Check if MR Status section exists
    if grep -q "^## MR Status" "$tracking_doc"; then
        # Replace existing MR Status section
        awk -v status="$status_table" -v timestamp="$sync_timestamp" '
            /^## MR Status/ {
                print "## MR Status (synced: " timestamp ")"
                print ""
                print status
                # Skip until next section or end
                while ((getline line) > 0) {
                    if (line ~ /^## / && line !~ /^## MR Status/) {
                        print ""
                        print line
                        break
                    }
                }
                next
            }
            { print }
        ' "$tracking_doc" > "$temp_file"
    else
        # Insert MR Status section after Overview section
        awk -v status="$status_table" -v timestamp="$sync_timestamp" '
            /^## Overview/ {
                print
                # Print until next section
                while ((getline line) > 0) {
                    if (line ~ /^## /) {
                        print ""
                        print "## MR Status (synced: " timestamp ")"
                        print ""
                        print status
                        print ""
                        print line
                        break
                    }
                    print line
                }
                next
            }
            { print }
        ' "$tracking_doc" > "$temp_file"

        # If no Overview section, append at end
        if ! grep -q "^## MR Status" "$temp_file"; then
            echo "" >> "$temp_file"
            echo "## MR Status (synced: ${sync_timestamp})" >> "$temp_file"
            echo "" >> "$temp_file"
            echo "$status_table" >> "$temp_file"
        fi
    fi

    mv "$temp_file" "$tracking_doc"
}

cmd_sync() {
    local stack_name="$1"
    local project_root; project_root=$(git rev-parse --show-toplevel)
    local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"

    [[ ! -f "$tracking_doc" ]] && die "Stack '$stack_name' not found. Tracking doc: $tracking_doc"

    log_info "Syncing stack '$stack_name' with GitLab..."

    # Extract MR numbers from tracking doc
    local mrs
    mrs=$(grep -oE '![0-9]+' "$tracking_doc" 2>/dev/null | sort -u | tr -d '!' || echo "")

    if [[ -z "$mrs" ]]; then
        log_info "No MRs found in tracking document"
        return 0
    fi

    local sync_timestamp
    sync_timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Build status table
    local status_table=""
    status_table+="| MR | Title | State | Pipeline | Approvals | Threads |\n"
    status_table+="|----|-------|-------|----------|-----------|---------|"

    local merged_count=0 open_count=0 closed_count=0

    for mr in $mrs; do
        local mr_status_line
        mr_status_line=$(get_mr_status "$mr")

        local mr_num state pipeline approvals threads title
        mr_num=$(echo "$mr_status_line" | cut -d'|' -f1)
        state=$(echo "$mr_status_line" | cut -d'|' -f2)
        pipeline=$(echo "$mr_status_line" | cut -d'|' -f3)
        approvals=$(echo "$mr_status_line" | cut -d'|' -f4)
        threads=$(echo "$mr_status_line" | cut -d'|' -f5)
        title=$(echo "$mr_status_line" | cut -d'|' -f6)

        # Status display
        local state_display
        case "$state" in
            merged) state_display="MERGED"; ((merged_count++)) ;;
            opened) state_display="OPEN"; ((open_count++)) ;;
            closed) state_display="CLOSED"; ((closed_count++)) ;;
            *) state_display="$state" ;;
        esac

        # Thread display
        local threads_display="$threads"
        [[ "$threads" != "0" && "$threads" != "-" ]] && threads_display="${threads} unresolved"

        # Pipeline icons
        local pipeline_display
        case "$pipeline" in
            passed) pipeline_display="passed" ;;
            FAILED) pipeline_display="FAILED" ;;
            running) pipeline_display="running" ;;
            *) pipeline_display="$pipeline" ;;
        esac

        status_table+="\n| ${mr_num} | ${title} | ${state_display} | ${pipeline_display} | ${approvals} | ${threads_display} |"

        echo "  ${mr_num}: ${state_display} (pipeline: ${pipeline_display}, threads: ${threads})"
    done

    # Update tracking doc
    update_tracking_doc_mr_status "$tracking_doc" "$(echo -e "$status_table")" "$sync_timestamp"

    echo ""
    log_info "Sync complete at ${sync_timestamp}"
    log_info "Updated: $tracking_doc"
    log_info "Summary: ${merged_count} merged, ${open_count} open, ${closed_count} closed"
}

# =============================================================================
# COMMAND: ROLLUP
# =============================================================================

cmd_rollup() {
    local stack_name="$1"
    local project_root; project_root=$(git rev-parse --show-toplevel)
    local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"
    [[ ! -f "$tracking_doc" ]] && die "Stack '$stack_name' not found"

    log_info "Verifying all leaf MRs are merged..."
    local leaf_mrs; leaf_mrs=$(grep -oE '![0-9]+' "$tracking_doc" | sort -u | tr -d '!' || echo "")
    local pending=()

    for mr in $leaf_mrs; do
        local state; state=$(glab api "projects/:fullpath/merge_requests/${mr}" 2>/dev/null | jq -r '.state')
        case "$state" in
            merged) log_info "  !${mr}: MERGED" ;;
            *) log_info "  !${mr}: ${state}"; pending+=("$mr") ;;
        esac
    done

    [[ ${#pending[@]} -gt 0 ]] && die "Cannot rollup - pending MRs: ${pending[*]}"

    log_info "All merged. Cherry-picking..."
    git fetch origin "stack/${stack_name}"
    git checkout "stack/${stack_name}"

    for mr in $leaf_mrs; do
        local commit; commit=$(glab api "projects/:fullpath/merge_requests/${mr}" | jq -r '.merge_commit_sha')
        [[ -z "$commit" || "$commit" == "null" ]] && continue
        log_info "Cherry-picking !${mr} (${commit:0:7})..."
        git cherry-pick "$commit" || die "Cherry-pick failed. Resolve and run: git cherry-pick --continue"
    done

    git push origin "stack/${stack_name}"
    log_info "Rollup complete"
}

# =============================================================================
# COMMAND: ABANDON
# =============================================================================

cmd_abandon() {
    local stack_name="$1"
    local force_flag="${2:-}"
    local project_root; project_root=$(git rev-parse --show-toplevel)
    local tracking_doc="${project_root}/docs/mr-stacks/${stack_name}.md"
    local worktree_path="${project_root}/.worktrees/${stack_name}"

    echo ""
    echo "================================"
    echo "Abandoning Stack: ${stack_name}"
    echo "================================"
    echo ""

    # Validate stack name
    validate_stack_name "$stack_name" || exit "$EXIT_VALIDATION"

    # Check what exists
    local has_tracking_doc=false has_worktree=false has_local_branch=false has_remote_branch=false
    local mrs=""

    [[ -f "$tracking_doc" ]] && has_tracking_doc=true
    [[ -d "$worktree_path" ]] && has_worktree=true
    git rev-parse --verify "stack/${stack_name}" >/dev/null 2>&1 && has_local_branch=true
    git ls-remote --heads origin "stack/${stack_name}" 2>/dev/null | grep -q . && has_remote_branch=true

    if [[ -f "$tracking_doc" ]]; then
        mrs=$(grep -oE '![0-9]+' "$tracking_doc" 2>/dev/null | sort -u | tr -d '!' || echo "")
    fi

    # Show what will be cleaned up
    echo "Resources to clean up:"
    echo ""
    $has_tracking_doc && echo "  [x] Tracking doc: $tracking_doc"
    $has_worktree && echo "  [x] Worktree: $worktree_path"
    $has_local_branch && echo "  [x] Local branches: stack/${stack_name}/*"
    $has_remote_branch && echo "  [x] Remote branches: origin/stack/${stack_name}/*"
    [[ -n "$mrs" ]] && echo "  [x] MRs to close: $(echo "$mrs" | tr '\n' ' ' | sed 's/ $//')"
    echo ""

    # Check if anything exists
    if ! $has_tracking_doc && ! $has_worktree && ! $has_local_branch && ! $has_remote_branch; then
        log_info "No resources found for stack '$stack_name'. Nothing to abandon."
        return 0
    fi

    # Confirmation unless --force
    if [[ "$force_flag" != "--force" && "$force_flag" != "-f" ]]; then
        echo "This will permanently close all MRs and delete all branches."
        echo -n "Continue? [y/N] "
        read -r confirm
        [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { log_info "Aborted."; return 0; }
        echo ""
    fi

    local errors=0

    # Step 1: Close MRs via glab
    if [[ -n "$mrs" ]]; then
        echo "Step 1: Closing MRs..."
        for mr in $mrs; do
            echo -n "  Closing !${mr}... "
            if glab mr close "$mr" 2>/dev/null; then
                echo "done"
            else
                echo "skipped (may already be closed/merged)"
            fi
        done
        echo ""
    else
        echo "Step 1: No MRs to close"
        echo ""
    fi

    # Step 2: Remove worktree
    echo "Step 2: Removing worktree..."
    if [[ -d "$worktree_path" ]]; then
        # First, try to checkout a different branch in the worktree if we're in it
        if [[ "$(pwd)" == "$worktree_path"* ]]; then
            log_error "Cannot remove worktree while inside it. Please cd to a different directory."
            ((errors++))
        else
            echo -n "  Removing $worktree_path... "
            if git worktree remove --force "$worktree_path" 2>/dev/null; then
                echo "done"
            else
                # Try prune as fallback
                git worktree prune 2>/dev/null || true
                if [[ -d "$worktree_path" ]]; then
                    echo "FAILED (manual removal may be required)"
                    ((errors++))
                else
                    echo "done (via prune)"
                fi
            fi
        fi
    else
        echo "  No worktree found"
    fi
    echo ""

    # Step 3: Delete local branches
    echo "Step 3: Deleting local branches..."
    local local_branches
    local_branches=$(git for-each-ref --format='%(refname:short)' "refs/heads/stack/${stack_name}" "refs/heads/stack/${stack_name}/*" 2>/dev/null || echo "")

    if [[ -n "$local_branches" ]]; then
        for branch in $local_branches; do
            echo -n "  Deleting $branch... "
            if git branch -D "$branch" 2>/dev/null; then
                echo "done"
            else
                echo "FAILED"
                ((errors++))
            fi
        done
    else
        echo "  No local branches found"
    fi
    echo ""

    # Step 4: Delete remote branches
    echo "Step 4: Deleting remote branches..."
    local remote_branches
    remote_branches=$(git for-each-ref --format='%(refname:short)' "refs/remotes/origin/stack/${stack_name}" "refs/remotes/origin/stack/${stack_name}/*" 2>/dev/null | sed 's|origin/||' || echo "")

    if [[ -n "$remote_branches" ]]; then
        for branch in $remote_branches; do
            echo -n "  Deleting origin/$branch... "
            if git push origin --delete "$branch" 2>/dev/null; then
                echo "done"
            else
                echo "skipped (may not exist on remote)"
            fi
        done
    else
        echo "  No remote branches found"
    fi
    echo ""

    # Step 5: Archive tracking doc
    echo "Step 5: Archiving tracking doc..."
    if [[ -f "$tracking_doc" ]]; then
        local archive_dir="${project_root}/docs/mr-stacks/archived"
        local archive_path="${archive_dir}/${stack_name}.md"
        local timestamp
        timestamp=$(date +"%Y-%m-%d_%H%M%S")

        mkdir -p "$archive_dir"

        # Add abandon note to tracking doc before archiving
        {
            echo ""
            echo "## Abandoned"
            echo ""
            echo "- **Date**: ${timestamp}"
            echo "- **Reason**: Manual abandon via gitlab-stack.sh"
        } >> "$tracking_doc"

        # If archive already exists, add timestamp suffix
        if [[ -f "$archive_path" ]]; then
            archive_path="${archive_dir}/${stack_name}_${timestamp}.md"
        fi

        echo -n "  Moving to ${archive_path}... "
        if mv "$tracking_doc" "$archive_path"; then
            echo "done"
        else
            echo "FAILED"
            ((errors++))
        fi
    else
        echo "  No tracking doc found"
    fi
    echo ""

    # Summary
    echo "================================"
    if [[ $errors -eq 0 ]]; then
        log_info "Stack '$stack_name' abandoned successfully"
    else
        log_error "Stack '$stack_name' abandoned with $errors error(s)"
        log_info "Some resources may require manual cleanup"
        exit "$EXIT_ERROR"
    fi
}

# =============================================================================
# COMMAND: COMMENTS
# =============================================================================

cmd_comments() {
    local stack_name="$1" mr_id="$2"
    log_info "Fetching comments for MR !${mr_id}..."
    local discussions; discussions=$(glab api "projects/:fullpath/merge_requests/${mr_id}/discussions" 2>/dev/null || echo "[]")
    [[ "$discussions" == "[]" ]] && { log_info "No comments found"; return 0; }

    echo ""; echo "## Review Comments: !${mr_id}"; echo ""
    echo "$discussions" | jq -r '
        .[] | select(.notes | length > 0) |
        "### Thread\n**Status**: " + (if .notes[0].resolvable then (if .notes[0].resolved then "RESOLVED" else "UNRESOLVED" end) else "N/A" end) + "\n" +
        (.notes | map("**" + .author.username + "**: " + .body) | join("\n"))
    ' 2>/dev/null || echo "Error parsing discussions"
}

# =============================================================================
# COMMAND: FIX
# =============================================================================

cmd_fix() {
    local stack_name="$1" mr_id="$2"
    echo "To fix MR !${mr_id}:"
    echo "1. Review: $SCRIPT_NAME comments $stack_name $mr_id"
    echo "2. Edit in: .worktrees/${stack_name}"
    echo "3. Commit and push to update MR"
}

# =============================================================================
# MAIN
# =============================================================================

usage() {
    cat << EOF
$SCRIPT_NAME v$VERSION - Manage stacked MR workflows

Usage: $SCRIPT_NAME <command> <stack-name> [options]

Commands:
    create <name> <manifest>   Create new MR stack from manifest JSON
    status <name>              Show stack state with pipeline/approvals/threads
    sync <name>                Update tracking doc from GitLab MR states
    rollup <name>              Cherry-pick merged leaf commits to root
    abandon <name> [--force]   Close MRs, remove worktree, archive tracking doc
    comments <name> <mr>       Fetch MR review comments
    fix <name> <mr>            Show fix workflow for an MR

Options:
    -h, --help      Show help
    -v, --version   Show version
    --force, -f     Skip confirmation prompts (abandon only)

Examples:
    $SCRIPT_NAME status my-feature
    $SCRIPT_NAME sync my-feature
    $SCRIPT_NAME abandon my-feature --force
EOF
}

main() {
    case "${1:-}" in
        -h|--help) usage; exit 0 ;;
        -v|--version) echo "$SCRIPT_NAME v$VERSION"; exit 0 ;;
    esac

    local command="${1:-}" stack_name="${2:-}"
    [[ -z "$command" ]] && { usage; exit "$EXIT_ERROR"; }
    git rev-parse --git-dir &>/dev/null || die "Not in a git repository"

    case "$command" in
        create) [[ -z "$stack_name" || -z "${3:-}" ]] && die "Usage: $SCRIPT_NAME create <name> <manifest>"; cmd_create "$stack_name" "$3" ;;
        status) [[ -z "$stack_name" ]] && die "Usage: $SCRIPT_NAME status <name>"; cmd_status "$stack_name" ;;
        sync) [[ -z "$stack_name" ]] && die "Usage: $SCRIPT_NAME sync <name>"; cmd_sync "$stack_name" ;;
        rollup) [[ -z "$stack_name" ]] && die "Usage: $SCRIPT_NAME rollup <name>"; cmd_rollup "$stack_name" ;;
        abandon) [[ -z "$stack_name" ]] && die "Usage: $SCRIPT_NAME abandon <name> [--force]"; cmd_abandon "$stack_name" "${3:-}" ;;
        comments) [[ -z "$stack_name" || -z "${3:-}" ]] && die "Usage: $SCRIPT_NAME comments <name> <mr>"; cmd_comments "$stack_name" "$3" ;;
        fix) [[ -z "$stack_name" || -z "${3:-}" ]] && die "Usage: $SCRIPT_NAME fix <name> <mr>"; cmd_fix "$stack_name" "$3" ;;
        *) die "Unknown command: $command" ;;
    esac
}

main "$@"
