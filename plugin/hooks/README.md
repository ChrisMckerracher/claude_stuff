# Hook Registration

Add these to your `~/.claude/settings.json` or project `.claude/settings.json`:

## Session Start Hook

Shows ready tasks when starting a Claude session in a project with beads:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

## Pre-Push Security Hook

Runs security checks before push operations:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/pre-push-security.sh"
          }
        ]
      }
    ]
  }
}
```

## Full Configuration Example

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/session-start.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/plugins/local/agent-ecosystem/hooks/pre-push-security.sh"
          }
        ]
      }
    ]
  }
}
```
