# Quorum — Claude Code Instructions

## Project overview

Quorum is a portable reasoning layer for agentic codebases. Five TypeScript modules:

```
Advisor  →  plain-language Chronicle queries
Oracle   →  Jury  →  Council  →  human gate  →  Executor
Sentinel →  coverage + drift
```

Full module rules and design decisions: [modules/CLAUDE.md](modules/CLAUDE.md)
File ownership map: [modules/AGENTS.md](modules/AGENTS.md)

---

## Session protocol — run this every session

This is not optional. Quorum is a self-improving system. It only improves if you use it.

### On session start

**If this project has a `quorum/client.ts` (or equivalent `getQuorum()` entrypoint):**

Do NOT run CLI commands. Query Chronicle directly inside your design script:

```typescript
const { oracle } = await getQuorum()
const evidence = await oracle.query("topic of the work")
```

Then proceed with `evaluate()` → `deliberate()` → `oracle.propose()` as normal.
The CLI commands below are the fallback for projects that have not set up a TypeScript client.

**If this project does NOT have a TypeScript client (CLI-only setup):**

Run these before reading any code or proposing anything:

```bash
node bin/quorum.js advisor brief
```

This shows what's in Chronicle. Read it. It tells you what the team has already learned.

Then query for the topic at hand:

```bash
node bin/quorum.js advisor query "topic of the work"
```

If there are relevant entries, treat them as ground truth. If there are none, that's useful to know too — it means you're working in undocumented territory.

### During the session

Before making any architectural decision, query Chronicle first.

**TypeScript client (preferred):**

```typescript
const { oracle } = await getQuorum()
const evidence = await oracle.query("the specific decision you're about to make")
```

**CLI fallback (if no TypeScript client):**

```bash
node bin/quorum.js advisor query "the specific decision you're about to make"
```

If an entry is refuted, do not retry the approach. Surface the failure reason.

### On session end

For every significant decision made in the session, create a Chronicle proposal.

What counts as Chronicle-worthy:
- A new module or significant feature and its design rationale
- An API or interface choice that will affect future sessions
- A rejected approach and why it was rejected (important — prevents re-trying bad ideas)
- A configuration or tooling decision that affects all future work
- A failure or bug root cause that was non-obvious

What does NOT need a Chronicle entry:
- Routine code changes, style fixes, obvious bug fixes
- Things already fully captured in git commit messages
- Transient implementation details with no future impact

**Template for a Chronicle proposal:**

```javascript
// Run with: node -e "..."
const { randomUUID } = require('crypto')
const { writeFileSync, mkdirSync } = require('fs')
const path = require('path')

mkdirSync('.chronicle/proposals', { recursive: true })

const proposal = {
  schema_version: 2,
  topic: 'short label — module/area',
  decision: 'One sentence: what was decided and why.',
  key_insight: 'One sentence: what was decided and why.',   // same as decision
  affected_areas: ['path/to/relevant/file.ts'],
  scope: ['module-name', 'area-tag'],
  alternatives_considered: ['Other approach that was considered'],
  rejected_reason: ['Why the alternative was rejected'],
  status: 'validated',      // or 'open' if still uncertain
  confidence: 0.9,          // how certain you are this is right
  source_module: 'council',
  evidence_cited: [],
  work_ref: { type: 'pr', ref: 'PR #N' },  // or spike/story
}

const id = randomUUID()
writeFileSync(path.join('.chronicle', 'proposals', id + '.json'), JSON.stringify(proposal, null, 2), 'utf8')
console.log('Proposed:', id.slice(0, 8), '—', proposal.topic)
```

After creating proposals, tell the user: "I've staged N Chronicle entries — run `quorum commit --list` to review."

---

## Chronicle — the persistent knowledge store

Chronicle lives at `.chronicle/`. It is the team's accumulated learning — what has been tried, what worked, what failed, and why decisions were made.

**Rules:**
- **Query first, always.** `node bin/quorum.js advisor query "topic"` before proposing any design.
- **Never call `oracle.commit()` autonomously.** Use the proposal template above. A human must run `quorum commit <id>`.
- **Cite entries by ID.** When referencing a Chronicle finding, use `[entry-id-prefix]`.
- **Respect refuted entries.** If an entry is refuted, do not retry the approach without surfacing the failure reason to the user first.

---

## Gemini CLI (optional assistant)

```bash
which gemini 2>/dev/null
```

If empty, skip. Never install it or ask the user to install it mid-task.

**Use Gemini when:**
- You need to survey many files at once before deciding where to look
- You want to trace a pattern across the whole codebase
- You want a second opinion on an architecture decision before proposing it

```bash
source ~/.zshrc && gemini -p "What are all the public exports across modules/ and what does each do?"
source ~/.zshrc && find . -name "*.ts" | xargs cat | gemini -p "Find every place oracle.commit() is called"
```

Reason about Gemini's output — it assists, you decide. Never pass it unfiltered to the user.

---

## Build and test

```bash
npx vitest run modules/ evals/
```

All 141 tests must pass before any PR.
