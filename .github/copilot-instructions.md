# Project Guidelines

## Architecture

This project uses three portable reasoning modules: **Oracle**, **Jury**, and **Council**.
They form the knowledge and validation layer for all agentic work in this codebase.

```
oracle.query()  →  jury.evaluate()  →  council.deliberate()  →  human gate  →  Executor
```

Source: `modules/` — see [modules/README.md](modules/README.md) for full API reference.

---

## Chronicle — the persistent knowledge store

Chronicle lives at `.chronicle/` and is the institutional memory of this codebase.
Every prior decision, investigation finding, and outcome is stored there.

**Always query Oracle before proposing a solution.** Treat existing entries as ground truth for what has been tried, what worked, and what failed.

```typescript
const evidence = await oracle.query("describe what you're about to do")
// Use evidence to inform your proposal before proceeding
```

**Never call `oracle.commit()` without explicit human approval.**
`oracle.propose()` writes a pending file. A human must call `oracle.commit(proposalId)` to index it.
There are no auto-commits. Do not attempt to bypass this gate.

---

## Module responsibilities

| Module | What it does | LLM? |
|---|---|---|
| `oracle.query()` | Retrieves relevant Chronicle entries by semantic + BM25 search | No |
| `oracle.propose()` | Stages a new entry for human review | No |
| `oracle.commit()` | Indexes an approved entry — human-triggered only | No |
| `jury.evaluate()` | Scores a design against evidence across 4 dimensions | Yes |
| `council.deliberate()` | Adversarial validation via advisor/reviewer fan-out | Yes |

---

## Setup

```typescript
import { setup } from "./modules/setup"

const { oracle, evaluate, deliberate } = await setup({ llm: yourProvider })
```

`setup()` creates Chronicle directories, warms the embedder, and wires all dependencies.
Call it once at application startup.

---

## Routing rules

After `jury.evaluate()`:

| `recommendation` | Action |
|---|---|
| `proceed` | Pass to `council.deliberate()` |
| `investigate-more` | Return to Detective with `juryOutput.gaps` |
| `redesign` | Return to Designer |

After `council.deliberate()`:

| `satisfied` | `recommendation` | Action |
|---|---|---|
| `true` | `proceed` | Human gate → Executor |
| `false` | `redesign` | Return to Designer with `verdict` as feedback |
| `false` | `investigate-more` | Return to Detective with `juryOutput.gaps` |

---

## Rules for AI agents

- **Evidence first.** Query Oracle before proposing any design or implementation.
- **No auto-commits.** Never call `oracle.commit()` autonomously. Only propose.
- **Cite entries.** When referencing Chronicle findings, use the entry ID (e.g. `[abc-123]`).
- **Respect refuted entries.** A `refuted` entry means this was tried and failed — surface the failure reason, don't ignore it.
- **Fail loudly.** Jury and Council throw on bad LLM output. Do not swallow errors or default to passing scores.
- **These modules are the portable core.** Detective, Designer, Executor, and Validator are application-specific — do not add them here.

---

## Build and test

```bash
npx vitest run modules/
```
