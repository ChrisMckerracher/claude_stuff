#!/usr/bin/env bash
set -e

if [[ -z "$HOME" ]]; then
    echo "Error: \$HOME is not set" >&2
    exit 1
fi

trap 'echo "Error on line $LINENO"; exit 1' ERR

PLUGIN_DIR="$HOME/.claude/plugins/local/agent-ecosystem"

log_info() { echo -e "\033[0;34m==>\033[0m $1"; }
log_success() { echo -e "\033[0;32m==>\033[0m $1"; }

create_plugin_structure() {
    log_info "Creating plugin structure at $PLUGIN_DIR..."

    mkdir -p "$PLUGIN_DIR/.claude-plugin"
    mkdir -p "$PLUGIN_DIR/agents"
    mkdir -p "$PLUGIN_DIR/skills"
    mkdir -p "$PLUGIN_DIR/hooks"
    mkdir -p "$PLUGIN_DIR/templates"

    # Write plugin.json
    if [[ -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]]; then
        log_info "plugin.json already exists, skipping..."
    else
        cat > "$PLUGIN_DIR/.claude-plugin/plugin.json" << 'EOF'
{
  "name": "agent-ecosystem",
  "description": "Specialized agents, merge tree workflows, and invisible task tracking",
  "version": "0.1.0",
  "author": {
    "name": "chrismck"
  },
  "keywords": ["agents", "beads", "merge-tree", "tdd", "workflow"]
}
EOF
    fi

    log_success "Plugin structure created"
}

create_plugin_structure

echo ""
echo "Plugin created at: $PLUGIN_DIR"
echo ""
echo "To enable, add to ~/.claude/settings.json:"
echo '  "enabledPlugins": {'
echo '    "agent-ecosystem@local": true'
echo '  }'
