---
name: security
description: Use when auditing code for security vulnerabilities, or before any merge involving auth/crypto
---

# /security

Invoke the Security Agent.

## Usage

`/security` - Audit current changes for security issues
`/security examine` - Full security audit of codebase
`/security <files>` - Audit specific files

## What Happens

1. Security Agent activates
2. Scans for OWASP Top 10, secrets, vulnerable dependencies
3. Returns security report
4. Can **VETO** merge if critical issues found

## Authority

Security Agent has **VETO power** - outranks all other agents on security matters.

## Pre-Spelunk Documentation Check

Before requesting codebase exploration, ALWAYS check for existing docs:

### What Security Needs
- **trust-zones/** - Authentication boundaries, authorization checks
- **contracts/** - Input validation, sanitization points

### Check Staleness First
```
/code spelunk --check --for=security --focus="<area>"
```

Results:
- **FRESH**: Read docs directly
- **STALE/MISSING**: Request spelunk via Coding Agent

### Request Spelunk Only If Needed
```
Task(
  subagent_type: "agent-ecosystem:code",
  prompt: "spelunk --for=security --focus='<area>'"
)
```

Then read:
- `docs/spelunk/trust-zones/<focus-slug>.md`
- `docs/spelunk/contracts/<focus-slug>.md`

### Using Security Docs for Audits
1. Map all trust boundaries and verify proper checks
2. Trace auth flow from entry points to protected resources
3. Verify authorization at each trust transition
4. Check input validation at boundaries
5. Flag unprotected routes or missing validation
