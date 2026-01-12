# Hooks Analysis

**Lens:** boundaries
**Focus:** hooks/session-start.sh implementation and plugin.json hook registration
**Generated:** 2026-01-11
**For:** Architect Agent

## Summary

This document analyzes the hook system implementation, specifically the session-start.sh script and plugin.json hook registration, identifying a critical mismatch between hook registration locations.

## Files Analyzed

| File | Purpose |
|------|---------|
| `plugin/hooks/session-start.sh` | Session start hook script |
| `plugin/hooks/pre-push-security.sh` | Pre-push security gate script |
| `plugin/.claude-plugin/plugin.json` | Plugin manifest with hook registration |
| `plugin/hooks/README.md` | Hook documentation |

---

## 1. session-start.sh Implementation

**Path:** `/Users/chrismck/tasks/claude_stuff/plugin/hooks/session-start.sh`

### What It Does

```
1. Reads JSON input from stdin (Claude Code hook protocol)
2. Extracts cwd (current working directory) from input
3. Checks if .beads directory exists in project
4. If beads initialized:
   - Runs `bd ready --json` to get ready tasks
   - Outputs count of ready tasks to Claude
   - Suggests using /visualize for full tree
5. Always exits 0 (non-blocking hook)
```

### Input/Output Contract

| Input | Format | Source |
|-------|--------|--------|
| stdin | JSON with `{ "cwd": "..." }` | Claude Code hook system |

| Output | Format | Purpose |
|--------|--------|---------|
| stdout | Plain text | Injected into Claude context |
| exit 0 | Always | Non-blocking (never vetoes) |

### Dependencies

- `jq` - JSON parsing
- `bd` CLI - beads task tracker
- `.beads/` directory must exist for output

---

## 2. pre-push-security.sh Implementation

**Path:** `/Users/chrismck/tasks/claude_stuff/plugin/hooks/pre-push-security.sh`

### What It Does

```
1. Reads JSON input from stdin
2. Extracts cwd from input
3. Runs security checks on staged files:
   - Scans for secrets (password, secret, api_key, token patterns)
   - Checks for .env files
   - Checks for private key files (.pem, .key)
4. If issues found: exits 2 (blocking veto)
5. If clean: exits 0 (allow)
```

### Issue: Hook Trigger Mismatch

The README documents this hook as triggering on `PreToolUse` with `Bash` matcher, but:
- This only runs BEFORE bash commands, not specifically before git push
- It checks `git diff --cached` which shows staged files, not files being pushed
- The hook name suggests "pre-push" but actually runs on ANY bash command

---

## 3. plugin.json Hook Registration

**Path:** `/Users/chrismck/tasks/claude_stuff/plugin/.claude-plugin/plugin.json`

### Current Registration

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"
          }
        ]
      }
    ]
  }
}
```

### Analysis

| Aspect | Status | Notes |
|--------|--------|-------|
| SessionStart hook | REGISTERED | Uses `${CLAUDE_PLUGIN_ROOT}` variable |
| PreToolUse hook | NOT REGISTERED | Only documented in README |
| Event name format | CORRECT | PascalCase matches Claude Code spec |
| Matcher field | PRESENT | Empty string (matches all) |

---

## 4. Critical Findings

### FINDING 1: Hook Registration Location Mismatch

| Location | SessionStart | PreToolUse (security) |
|----------|--------------|----------------------|
| plugin.json | YES | NO |
| README.md | Documented | Documented |
| settings.json | Requires manual copy | Requires manual copy |

**Issue:** The pre-push-security.sh hook is NOT registered in plugin.json. Users must manually add it to their settings.json.

### FINDING 2: Pre-Push Hook Name vs Behavior Mismatch

| Aspect | Name Implies | Actual Behavior |
|--------|--------------|-----------------|
| Trigger | Before `git push` | Before ANY bash command |
| Scope | Push operation | All bash tool usage |
| Files checked | Files being pushed | Staged files (--cached) |

**Issue:** The "pre-push" hook actually runs on every Bash command when configured with `PreToolUse` + `Bash` matcher. This is by design (catches push attempts) but the naming is misleading.

### FINDING 3: Hook Event Names Are Correct

The hook event names used are valid Claude Code hook events:

| Event | Description | Used Correctly |
|-------|-------------|----------------|
| `SessionStart` | When Claude session begins | YES |
| `PreToolUse` | Before any tool execution | YES (in docs) |

---

## 5. Boundary Interfaces

### External Boundaries

```
Claude Code Hook System
        |
        v
+------------------+
| session-start.sh |-----> bd CLI (beads)
+------------------+
        |
        v
   Context Output
```

### Registration Boundary

```
plugin.json (plugin manifest)
        |
        +--> SessionStart hooks (REGISTERED)
        |
        X--> PreToolUse hooks (NOT REGISTERED - manual only)
```

---

## 6. Recommendations for Architect

### Option A: Register All Hooks in plugin.json

Add PreToolUse hook to plugin.json so plugin installation includes it:

```json
{
  "hooks": {
    "SessionStart": [ ... ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/pre-push-security.sh"
          }
        ]
      }
    ]
  }
}
```

### Option B: Rename pre-push-security.sh

Consider renaming to `bash-security-gate.sh` to accurately reflect behavior (runs on all bash, not just push).

### Option C: Document the Gap

If manual registration is intentional (user choice), document clearly in README that plugin.json only includes SessionStart, and security hook requires manual opt-in.

---

## Source File Hashes

| File | Hash (first 8) |
|------|----------------|
| plugin/hooks/session-start.sh | (to compute) |
| plugin/hooks/pre-push-security.sh | (to compute) |
| plugin/.claude-plugin/plugin.json | (to compute) |
| plugin/hooks/README.md | (to compute) |
