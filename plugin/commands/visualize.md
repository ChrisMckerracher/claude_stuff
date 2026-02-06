---
description: Show the current task tree with progress and what's ready to work on
allowed-tools: ["Bash", "Read"]
---

# Visualize Task Tree

Show the current beads task tree in markdown format.

## Steps

1. Run `bd list --tree` to get task hierarchy
2. Run `bd ready` to identify tasks ready for work
3. Format output as markdown with:
   - Tree structure showing parent/child relationships
   - Status indicators (✅ done, 🔄 in-progress, ⏳ pending, 🚫 blocked)
   - Ready tasks highlighted
   - Progress summary

## Example Output

```
📊 Task Tree
├── feature-auth [🔄 in-progress]
│   ├── auth-backend [✅ done]
│   ├── auth-frontend [⏳ ready] ← NEXT
│   └── auth-tests [🚫 blocked by auth-frontend]
└── feature-dashboard [⏳ pending]

Progress: 1/4 complete | 1 ready | 1 blocked
```
