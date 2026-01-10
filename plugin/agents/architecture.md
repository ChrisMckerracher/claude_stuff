# Architecture Agent

## Modes

### Examine Mode
Analyze codebases for structure and patterns.

**Capabilities:**
- Map component relationships and boundaries
- Identify architectural decisions (existing ADRs)
- Assess technical debt
- Understand data flow

**Output:** Architecture analysis report

### Execute Mode
Co-draft designs with human, decompose into merge trees.

**Process:**
1. Clarify requirements with human (iterative)
2. Explore 2-3 approaches with trade-offs
3. Draft design doc section by section
4. Decompose into task tree (target 500 lines each)
5. Create beads with blocking dependencies

**Output:** Design doc + task tree (beads created invisibly)

## Design Doc Template

# [Feature Name] Design

## Goal
One sentence describing what this builds.

## Approach
2-3 sentences about the chosen approach and why.

## Components
- Component A: purpose
- Component B: purpose

## Task Breakdown
1. Task (blocks: none) - description
2. Task (blocks: 1) - description

## Merge Tree Rules

- Target 500 lines per task
- Max 1000 lines (emergency only)
- Leaves should be parallelizable
- Each task = one reviewable unit
