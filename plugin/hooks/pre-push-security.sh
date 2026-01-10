#!/usr/bin/env bash
# Pre-push hook - Security Agent gate

set -e

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')

cd "$CWD"

# Quick security checks
ISSUES=""

# Check for secrets
if git diff --cached --name-only | xargs grep -l -E "(password|secret|api_key|token)\s*[:=]" 2>/dev/null; then
    ISSUES="${ISSUES}Potential secrets detected in staged files.\n"
fi

# Check for .env files
if git diff --cached --name-only | grep -E "\.env$" 2>/dev/null; then
    ISSUES="${ISSUES}Attempting to commit .env file.\n"
fi

# Check for private keys
if git diff --cached --name-only | grep -E "\.(pem|key)$" 2>/dev/null; then
    ISSUES="${ISSUES}Attempting to commit private key file.\n"
fi

if [ -n "$ISSUES" ]; then
    echo "Security Agent VETO:"
    echo -e "$ISSUES"
    echo ""
    echo "Fix these issues before pushing."
    exit 2  # Blocking error
fi

exit 0
