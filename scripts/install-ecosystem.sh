#!/usr/bin/env bash
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_error() { echo -e "${RED}Error:${NC} $1" >&2; }

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    if ! command -v git &> /dev/null; then
        log_error "git is required but not installed"
        exit 1
    fi

    if ! command -v claude &> /dev/null; then
        log_error "claude (Claude Code CLI) is required but not installed"
        echo "Install from: https://claude.ai/code"
        exit 1
    fi

    log_success "Prerequisites satisfied"
}

# Install beads
install_beads() {
    log_info "Installing beads..."

    if command -v bd &> /dev/null; then
        log_info "beads already installed: $(bd version 2>/dev/null || echo 'unknown version')"
        return 0
    fi

    # Try npm first (easiest)
    if command -v npm &> /dev/null; then
        log_info "Installing via npm..."
        npm install -g @anthropic-ai/bd || true
    fi

    # Try go install
    if ! command -v bd &> /dev/null && command -v go &> /dev/null; then
        log_info "Installing via go..."
        go install github.com/steveyegge/beads/cmd/bd@latest
    fi

    # Try direct download
    if ! command -v bd &> /dev/null; then
        log_info "Installing from GitHub releases..."
        curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
    fi

    if command -v bd &> /dev/null; then
        log_success "beads installed successfully"
    else
        log_error "Failed to install beads"
        exit 1
    fi
}

check_prerequisites
install_beads

log_success "Foundation installed!"
echo ""
echo "Next: Run ./scripts/setup-plugin.sh to create the plugin structure"
