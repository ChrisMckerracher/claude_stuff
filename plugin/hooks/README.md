# Hook Registration

## Auto-Registered Hooks (via Plugin)

The **SessionStart** hook is automatically registered when the plugin is installed. It shows ready tasks when starting a Claude session in a project with beads.

No manual configuration needed - just install the plugin.

## Opt-In Hooks (Manual Configuration)

The **PreToolUse** security hook requires manual opt-in because it runs on ALL Bash commands. Add to your `~/.claude/settings.json` or project `.claude/settings.json`:

### Pre-Push Security Hook

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

**Note:** This hook intercepts every Bash command to check for `git push`. Only enable if you want security scanning on all push operations.
