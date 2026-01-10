#!/usr/bin/env bash
set -e

if [[ -z "$HOME" ]]; then
    echo "Error: \$HOME is not set" >&2
    exit 1
fi

trap 'echo "Error on line $LINENO"; exit 1' ERR

# Find source directory (repo root/plugin)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SOURCE_DIR="$REPO_ROOT/plugin"

MARKETPLACE_DIR="$HOME/.claude/plugins/local"
PLUGIN_DIR="$MARKETPLACE_DIR/agent-ecosystem"
SETTINGS_FILE="$HOME/.claude/settings.json"

log_info() { echo -e "\033[0;34m==>\033[0m $1"; }
log_success() { echo -e "\033[0;32m==>\033[0m $1"; }
log_error() { echo -e "\033[0;31mError:\033[0m $1" >&2; }
log_warn() { echo -e "\033[0;33mWarning:\033[0m $1"; }

# Verify source content exists
if [[ ! -d "$SOURCE_DIR" ]]; then
    log_error "Source plugin directory not found: $SOURCE_DIR"
    exit 1
fi

create_marketplace() {
    log_info "Creating marketplace at $MARKETPLACE_DIR..."

    mkdir -p "$MARKETPLACE_DIR/.claude-plugin"

    # Write marketplace.json
    cat > "$MARKETPLACE_DIR/.claude-plugin/marketplace.json" << 'EOF'
{
  "name": "local",
  "description": "Local marketplace for custom plugins",
  "owner": {
    "name": "chrismck"
  },
  "plugins": [
    {
      "name": "agent-ecosystem",
      "source": "./agent-ecosystem",
      "description": "Specialized agents, merge tree workflows, and invisible task tracking",
      "version": "0.1.0"
    }
  ]
}
EOF

    log_success "Marketplace created"
}

create_plugin_structure() {
    log_info "Creating plugin structure at $PLUGIN_DIR..."

    mkdir -p "$PLUGIN_DIR/.claude-plugin"

    # Copy content from repo
    log_info "Copying agents..."
    cp -R "$SOURCE_DIR/agents" "$PLUGIN_DIR/"

    log_info "Copying skills..."
    cp -R "$SOURCE_DIR/skills" "$PLUGIN_DIR/"

    log_info "Copying hooks..."
    cp -R "$SOURCE_DIR/hooks" "$PLUGIN_DIR/"

    log_info "Copying templates..."
    cp -R "$SOURCE_DIR/templates" "$PLUGIN_DIR/"

    log_info "Copying commands..."
    cp -R "$SOURCE_DIR/commands" "$PLUGIN_DIR/"

    log_info "Copying plugin.json..."
    cp "$SOURCE_DIR/.claude-plugin/plugin.json" "$PLUGIN_DIR/.claude-plugin/"

    # Make hooks executable
    chmod +x "$PLUGIN_DIR/hooks/"*.sh 2>/dev/null || true

    log_success "Plugin structure created"
}

configure_settings() {
    log_info "Configuring Claude settings..."

    # Create settings file if it doesn't exist
    if [[ ! -f "$SETTINGS_FILE" ]]; then
        mkdir -p "$(dirname "$SETTINGS_FILE")"
        echo '{}' > "$SETTINGS_FILE"
    fi

    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        log_warn "jq not found - cannot auto-configure settings.json"
        echo ""
        echo "Please manually add to $SETTINGS_FILE:"
        cat << 'EOF'
  "enabledPlugins": {
    "agent-ecosystem@local": true
  },
  "extraKnownMarketplaces": {
    "local": {
      "source": {
        "source": "directory",
        "path": "$HOME/.claude/plugins/local"
      }
    }
  }
EOF
        return 0
    fi

    # Use jq to update settings
    local TEMP_FILE=$(mktemp)

    # Add extraKnownMarketplaces if not present
    if ! jq -e '.extraKnownMarketplaces.local' "$SETTINGS_FILE" &>/dev/null; then
        log_info "Adding local marketplace to settings..."
        jq --arg path "$MARKETPLACE_DIR" '.extraKnownMarketplaces.local = {
            "source": {
                "source": "directory",
                "path": $path
            }
        }' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"
    else
        log_info "Local marketplace already configured"
    fi

    # Enable the plugin if not already enabled
    if ! jq -e '.enabledPlugins["agent-ecosystem@local"]' "$SETTINGS_FILE" &>/dev/null; then
        log_info "Enabling agent-ecosystem plugin..."
        jq '.enabledPlugins["agent-ecosystem@local"] = true' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"
    else
        log_info "Plugin already enabled"
    fi

    log_success "Settings configured"
}

create_marketplace
create_plugin_structure
configure_settings

echo ""
log_success "Agent Ecosystem installed!"
echo ""
echo "Restart Claude Code to use the new commands:"
echo "  /architect, /code, /visualize, /review, /security, etc."
