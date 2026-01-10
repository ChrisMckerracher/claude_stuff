# README Visual Improvements Design

**Product brief:** `docs/plans/product/readme-readability-research.md`
**Date:** 2026-01-10
**Status:** DRAFT

---

## Goal

Transform the README from technically comprehensive but visually dense to immediately appealing and navigable, following industry best practices for open-source documentation.

## Background

Product research identified that our README lacks visual identity, progressive disclosure, and navigation aids that top open-source projects use. The content is accurate but the presentation doesn't create immediate impact.

**Key gaps identified:**
- No badges (trust signals)
- No table of contents (navigation)
- Value proposition buried after feature list
- No visual hierarchy/breathing room

## Approach

Make targeted edits to improve first impressions while preserving all existing content. Focus on restructuring and adding visual elements, not rewriting prose.

---

## Design

### Change 1: Add Badges After Title

**Location:** Line 1, immediately after `# Agent Ecosystem for Claude Code`

**Add:**
```markdown
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-blue.svg)](https://claude.ai/code)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
```

**Rationale:** Badges provide instant trust signals and key info at a glance. MIT license, plugin type, and Node requirement are the most relevant.

---

### Change 2: Stronger Opening Tagline

**Location:** Lines 3-5, replace current opening

**Current:**
```markdown
A productivity system for Claude Code built on specialized agents, merge tree workflows, and invisible task tracking via [beads](https://github.com/steveyegge/beads).

> **This is a Claude Code Plugin** - Install it to add specialized agents, spelunking, and workflow automation to your Claude Code sessions.
```

**Proposed:**
```markdown
> **Orchestrate AI agents for software development.** Design, implement, review, and ship with 7 specialized agents that collaborate through merge tree workflows.

A [Claude Code](https://claude.ai/code) plugin providing specialized agents, persistent codebase exploration, and invisible task tracking via [beads](https://github.com/steveyegge/beads).
```

**Rationale:** Lead with action-oriented value proposition. "Orchestrate AI agents" is more compelling than "A productivity system."

---

### Change 3: Add Collapsible Table of Contents

**Location:** After the opening paragraph, before `## Overview`

**Add:**
```markdown
<details>
<summary><strong>Table of Contents</strong></summary>

- [Overview](#overview)
- [Installation](#installation)
- [Usage](#usage)
  - [Commands](#commands)
  - [Spelunk System](#spelunk-system)
  - [Typical Workflow](#typical-workflow)
- [Architecture](#architecture)
  - [Authority Hierarchy](#authority-hierarchy)
  - [Agent Responsibilities](#agent-responsibilities)
  - [Merge Tree Concept](#merge-tree-concept)
- [Plugin Structure](#plugin-structure)
- [Hooks](#hooks)
- [GitLab Integration](#gitlab-integration)
- [Dashboard](#dashboard)
- [Dependencies](#dependencies)
- [Development](#development)
- [License](#license)

</details>
```

**Rationale:** At 440+ lines, navigation is essential. Collapsible keeps it from dominating the page.

---

### Change 4: Add Section Dividers

**Location:** Before each `##` heading

**Add horizontal rules before these sections:**
- `## Installation`
- `## Usage`
- `## Architecture`
- `## Plugin Structure`
- `## Hooks`
- `## GitLab Integration`
- `## Dashboard`
- `## Dependencies`
- `## Development`

**Format:**
```markdown
---

## Section Name
```

**Rationale:** Visual breathing room helps users scan and find sections. Common pattern in polished READMEs.

---

### Change 5: Collapse Detailed Plugin Structure

**Location:** Lines 238-312 (Plugin Structure section)

**Wrap in collapsible:**
```markdown
## Plugin Structure

This is a valid Claude Code plugin.

<details>
<summary><strong>View full directory structure</strong></summary>

```
plugin/                              # <- Plugin root
├── .claude-plugin/
...
```

</details>

When installed, spelunk documents are written to your project's `docs/spelunk/` directory:

<details>
<summary><strong>View spelunk output structure</strong></summary>

```
your-project/
└── docs/spelunk/
...
```

</details>
```

**Rationale:** Directory trees are useful for developers but overwhelming for casual readers. Collapsing them reduces visual noise while keeping info accessible.

---

### Change 6: Collapse Hooks Configuration

**Location:** Lines 332-353 (Enabling Hooks subsection)

**Wrap JSON config in collapsible:**
```markdown
### Enabling Hooks

<details>
<summary><strong>View settings.json configuration</strong></summary>

```json
{
  "hooks": {
    "SessionStart": [
      ...
    ]
  }
}
```

</details>

See `hooks/README.md` for full configuration.
```

**Rationale:** Configuration snippets are reference material, not primary reading.

---

## Alternatives Considered

### Alternative A: Full Section Reorder
Product research suggested moving Installation after Features. Rejected because:
- Current order (Overview → Install → Usage) is conventional
- Users expect to find install instructions early
- The value prop improvement (Change 2) addresses the "why before how" concern

### Alternative B: ASCII Art Logo
Product research suggested an ASCII banner. Deferred because:
- Higher effort for marginal benefit
- Badges provide sufficient visual identity
- Can be added later without structural changes

### Alternative C: Screenshots/GIFs
Deferred to future iteration:
- Requires capturing actual tool output
- High effort, medium impact
- Current changes are sufficient for first pass

---

## Task Breakdown

| Task | Blocks | Description | Est. Lines |
|------|--------|-------------|------------|
| 1. Add badges | none | Insert 3 badge lines after title | 3 |
| 2. Rewrite opening | none | Replace lines 3-5 with stronger tagline | 4 |
| 3. Add TOC | none | Insert collapsible TOC after opening | 20 |
| 4. Add section dividers | none | Insert `---` before 9 section headings | 9 |
| 5. Collapse plugin structure | none | Wrap directory trees in `<details>` | 8 |
| 6. Collapse hooks config | none | Wrap JSON config in `<details>` | 6 |

**Total:** ~50 lines added/modified
**All tasks are independent - can be done in any order**

---

## Success Criteria

- [ ] 3 badges visible immediately after title
- [ ] Opening paragraph is action-oriented ("Orchestrate AI agents...")
- [ ] Collapsible TOC present and all links work
- [ ] Horizontal rules separate major sections
- [ ] Plugin structure trees are collapsed by default
- [ ] Hooks configuration is collapsed by default
- [ ] All existing content preserved (no deletions)
- [ ] README renders correctly on GitHub

---

## Deferred Items

For future consideration:
1. ASCII art logo/banner
2. Screenshot of `/visualize` output
3. GIF showing typical workflow
4. "Quick Start" section with 3-command install

---

**Next:** Awaiting Product Agent validation before implementation
