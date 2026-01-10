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
