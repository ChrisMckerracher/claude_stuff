#!/usr/bin/env bash
# Cleanup script for testing fresh installs of agent-ecosystem plugin

set -e

MARKETPLACE_DIR="$HOME/.claude/plugins/local"
CACHE_DIR="$HOME/.claude/plugins/cache/local"
SETTINGS_FILE="$HOME/.claude/settings.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}==>${NC} $1"; }
log_warn() { echo -e "${RED}==>${NC} $1"; }

echo "Cleaning up agent-ecosystem plugin..."
echo ""

# Remove plugin and marketplace directory
if [ -d "$MARKETPLACE_DIR" ]; then
    log_info "Removing $MARKETPLACE_DIR"
    rm -rf "$MARKETPLACE_DIR"
    log_success "Removed marketplace directory"
else
    log_info "Marketplace directory not found (already clean)"
fi

# Remove plugin cache
if [ -d "$CACHE_DIR" ]; then
    log_info "Removing $CACHE_DIR"
    rm -rf "$CACHE_DIR"
    log_success "Removed plugin cache"
else
    log_info "Plugin cache not found (already clean)"
fi

# Clean up settings.json if jq is available
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        TEMP_FILE=$(mktemp)

        # Remove extraKnownMarketplaces.local
        if jq -e '.extraKnownMarketplaces.local' "$SETTINGS_FILE" &>/dev/null; then
            log_info "Removing extraKnownMarketplaces.local from settings"
            jq 'del(.extraKnownMarketplaces.local)' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"

            # Remove empty extraKnownMarketplaces object if no other marketplaces
            if jq -e '.extraKnownMarketplaces == {}' "$SETTINGS_FILE" &>/dev/null; then
                jq 'del(.extraKnownMarketplaces)' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"
            fi
            log_success "Removed marketplace from settings"
        fi

        # Remove enabledPlugins entry
        if jq -e '.enabledPlugins["agent-ecosystem@local"]' "$SETTINGS_FILE" &>/dev/null; then
            log_info "Removing agent-ecosystem@local from enabledPlugins"
            jq 'del(.enabledPlugins["agent-ecosystem@local"])' "$SETTINGS_FILE" > "$TEMP_FILE" && mv "$TEMP_FILE" "$SETTINGS_FILE"
            log_success "Removed plugin from enabledPlugins"
        fi
    else
        log_warn "jq not found - please manually edit $SETTINGS_FILE to remove:"
        echo "  - extraKnownMarketplaces.local"
        echo "  - enabledPlugins[\"agent-ecosystem@local\"]"
    fi
else
    log_info "Settings file not found"
fi

echo ""
log_success "Cleanup complete!"
echo ""
echo "To reinstall, run:"
echo "  ./scripts/install-ecosystem.sh"
