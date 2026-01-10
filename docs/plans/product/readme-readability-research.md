# README Readability & Appeal Research

**Product Agent Mode:** Research
**Date:** 2026-01-10

---

## Executive Summary

Our current README is **technically comprehensive but visually dense**. Industry best practices show that the most appealing READMEs combine visual hierarchy, progressive disclosure, and strategic use of badges/imagery to create immediate impact while remaining navigable.

Key opportunities:
1. Add visual identity (logo, badges)
2. Improve "above the fold" impact
3. Add table of contents for navigation
4. Use visual separators and whitespace strategically
5. Front-load value proposition before details

---

## Current README Analysis

### Strengths
- Comprehensive coverage of features
- Good use of tables for commands
- Includes ASCII diagrams for architecture
- Code examples present
- Clear section hierarchy

### Weaknesses
| Issue | Impact |
|-------|--------|
| No visual identity (logo, banner) | Project looks generic, no brand recognition |
| Dense wall of text in overview | Users may bounce before understanding value |
| No badges | Missing trust signals (build status, version, license) |
| No table of contents | Hard to navigate 440+ line document |
| Feature list before "why" | Users don't know why they should care |
| No GIFs/screenshots | Hard to visualize what the tool does |

---

## Industry Best Practices Research

### Visual Elements (from [awesome-readme](https://github.com/matiassingers/awesome-readme))

Top READMEs include:
- **Project logos/banners** - Immediate visual identity
- **Animated GIFs** - Show tool in action
- **Badges** - Trust signals at a glance
- **Architecture diagrams** - We have this (good!)

### Structure (from [Best-README-Template](https://github.com/othneildrew/Best-README-Template))

Recommended order:
1. Logo + Title + Tagline
2. Badges (build, version, license)
3. Brief description (1-2 sentences max)
4. Table of Contents
5. Features / Highlights
6. Installation
7. Usage
8. Architecture
9. Contributing / Development
10. License

### Badges (from [Shields.io](https://github.com/badges/shields))

Recommended badges for this project:
- License (MIT)
- Claude Code version compatibility
- Node.js version requirement
- GitHub stars (social proof)

### Progressive Disclosure (from [readme-best-practices](https://github.com/jehna/readme-best-practices))

> "Save your development instructions for the bottom of your README. The people looking for that know how to find it, whereas your average user will be scared off by complicated build instructions."

Our current README puts installation very early - consider whether this serves our audience.

---

## Recommendations

### Priority 1: Visual Identity (HIGH IMPACT)

**Add logo or banner at top**

Options:
1. Simple text banner with ASCII art
2. Create SVG logo for project
3. Use stylized header image

Example ASCII banner:
```
    ___                    __     ______                       __
   /   | ____ ____  ____  / /_   / ____/________  _________  / /____  ____
  / /| |/ __ `/ _ \/ __ \/ __/  / __/ / ___/ __ \/ ___/ __ \/ __/ _ \/ __ \
 / ___ / /_/ /  __/ / / / /_   / /___/ /__/ /_/ (__  ) /_/ / /_/  __/ / / /
/_/  |_\__, /\___/_/ /_/\__/  /_____/\___/\____/____/ .___/\__/\___/_/ /_/
      /____/                                       /_/
```

**Add badges immediately after title:**
```markdown
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Claude Code](https://img.shields.io/badge/Claude%20Code-Plugin-blue)
![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-green)
```

### Priority 2: Table of Contents (HIGH IMPACT)

Add collapsible TOC after overview:

```markdown
<details>
<summary>Table of Contents</summary>

- [Installation](#installation)
- [Usage](#usage)
  - [Commands](#commands)
  - [Workflows](#typical-workflow)
- [Architecture](#architecture)
- [Spelunk System](#spelunk-system)
- [Dashboard](#dashboard)
- [GitLab Integration](#gitlab-integration)
- [Development](#development)

</details>
```

### Priority 3: Reorder for Impact (MEDIUM IMPACT)

**Current order:**
1. Title + callout
2. Overview (feature list)
3. Installation
4. Usage/Commands
5. Architecture
6. ...

**Proposed order:**
1. Title + badges + tagline
2. **"What it does" (1 paragraph)**
3. **Quick demo GIF or screenshot** (if available)
4. Table of Contents
5. Key Features (highlights)
6. Quick Start (minimal install)
7. Commands
8. Architecture
9. Full Installation details
10. Development
11. License

### Priority 4: Visual Breathing Room (MEDIUM IMPACT)

Add horizontal rules between major sections:

```markdown
---

## Installation

---

## Usage
```

Consider collapsible sections for detailed content:

```markdown
<details>
<summary>Full Plugin Structure</summary>

... detailed structure ...

</details>
```

### Priority 5: Screenshot/GIF (LOW PRIORITY, HIGH EFFORT)

If possible, add:
- Screenshot of `/visualize` output showing task tree
- GIF of typical workflow (architect -> code -> merge-up)
- Screenshot of dashboard web UI

---

## Comparison: Before vs After

### Current "Above the Fold"
```
# Agent Ecosystem for Claude Code

A productivity system...

> **This is a Claude Code Plugin** - Install it...

## Overview

This plugin provides:
- **7 Specialist Agents**...
- **Spelunk System**...
```

### Proposed "Above the Fold"
```
[LOGO/BANNER]

# Agent Ecosystem for Claude Code

![License](badge) ![Claude Code](badge) ![Node](badge)

**Orchestrate AI agents for software development** - Design, implement, review, and ship with specialized agents that collaborate through merge tree workflows.

<details><summary>Table of Contents</summary>...</details>

## Why This Plugin?

Stop context-switching between design, coding, and review. This plugin provides 7 specialized agents that handle different aspects of development, with invisible task tracking and persistent codebase knowledge that survives across sessions.

## Quick Start
...
```

---

## Competitive Analysis

| Project | Visual Identity | Badges | TOC | Demo |
|---------|----------------|--------|-----|------|
| beads | Yes (ASCII) | Yes (3) | No | No |
| superpowers | No | No | No | No |
| **Our README** | No | No | No | No |
| Best examples | Yes | Yes | Yes | Yes |

---

## Implementation Effort

| Change | Effort | Impact |
|--------|--------|--------|
| Add badges | 5 min | High |
| Add TOC | 10 min | High |
| Reorder sections | 30 min | Medium |
| Add horizontal rules | 5 min | Low |
| Create logo | 1-2 hrs | High |
| Create demo GIF | 2+ hrs | Medium |

---

## Recommendation

**REVISE README with these changes:**

1. **Immediate (do now):**
   - Add 3-4 badges after title
   - Add collapsible table of contents
   - Add horizontal rules between sections

2. **Short-term:**
   - Reorder sections for progressive disclosure
   - Write stronger value proposition at top
   - Use collapsible sections for detailed content

3. **Optional enhancement:**
   - Create simple logo/banner
   - Add screenshot of dashboard/visualize output

---

## Sources

- [awesome-readme](https://github.com/matiassingers/awesome-readme) - Curated list of excellent READMEs
- [Best-README-Template](https://github.com/othneildrew/Best-README-Template) - Popular template with 15k+ stars
- [Shields.io](https://github.com/badges/shields) - Badge service used by major projects
- [readme-best-practices](https://github.com/jehna/readme-best-practices) - Best practices guide
- [standard-readme](https://github.com/RichardLitt/standard-readme) - Specification for consistent READMEs
- [Hatica Blog on GitHub README](https://www.hatica.io/blog/best-practices-for-github-readme/) - Industry best practices
