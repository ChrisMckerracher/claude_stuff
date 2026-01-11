#!/usr/bin/env bash
# =============================================================================
# DEVELOPMENT/CONTRIBUTING ONLY
# For primary installation, use: /plugin install https://github.com/ChrisMckerracher/claude_stuff
# This script is for local development or contributing to the plugin.
# =============================================================================
set -euo pipefail

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
        if ! npm install -g @anthropic-ai/bd 2>&1; then
            log_info "npm install failed, trying alternative methods..."
        fi
    fi

    # Try go install
    if ! command -v bd &> /dev/null && command -v go &> /dev/null; then
        log_info "Installing via go..."
        if ! go install github.com/steveyegge/beads/cmd/bd@latest 2>&1; then
            log_info "go install failed, trying alternative methods..."
        fi
    fi

    # Try direct download
    if ! command -v bd &> /dev/null; then
        log_info "Installing from GitHub releases..."
        INSTALL_SCRIPT=$(mktemp)
        trap "rm -f '$INSTALL_SCRIPT'" EXIT
        curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh -o "$INSTALL_SCRIPT"
        if [[ ! -s "$INSTALL_SCRIPT" ]]; then
            log_error "Downloaded script is empty"
            exit 1
        fi
        bash "$INSTALL_SCRIPT"
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

# Create plugin structure
setup_plugin() {
    log_info "Setting up plugin..."
    PLUGIN_DIR="$HOME/.claude/plugins/local/agent-ecosystem"

    # Run setup script if it exists in same directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$SCRIPT_DIR/setup-plugin.sh" ]; then
        bash "$SCRIPT_DIR/setup-plugin.sh"
    else
        log_info "setup-plugin.sh not found, creating minimal structure..."
        mkdir -p "$PLUGIN_DIR/.claude-plugin"
        mkdir -p "$PLUGIN_DIR/agents"
        mkdir -p "$PLUGIN_DIR/skills"
        mkdir -p "$PLUGIN_DIR/hooks"
        mkdir -p "$PLUGIN_DIR/templates"
    fi

    log_success "Plugin structure ready"
}

setup_plugin

log_success "Agent Ecosystem installed!"
echo ""
echo "Quick start:"
echo "  /architect    - Start design session"
echo "  /visualize    - See task tree"
echo "  /code         - Implement next task"
echo "  /review       - Code review"
echo "  /security     - Security audit"
echo ""
echo "To enable the plugin, add to ~/.claude/settings.json:"
echo '  "enabledPlugins": {'
echo '    "agent-ecosystem@local": true'
echo '  }'
