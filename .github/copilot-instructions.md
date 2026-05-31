# Project Guidelines

## Architecture

This project uses six portable reasoning modules: **Advisor**, **Oracle**, **Jury**, **Council**, **Sentinel**, and **Compass**.
They form the knowledge, validation, and product-direction layer for all agentic work in this codebase.

```
Advisor  →  plain-language Chronicle queries
Oracle   →  Jury  →  Council  →  human gate  →  Executor
Sentinel →  coverage + drift
Compass  →  product-direction synthesis (behaviours, pathways, bets, scoring)
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
| `ask()` | Plain-language question answered from Chronicle — validates internally, retries up to 2× | Yes |
| `oracle.query()` | Retrieves relevant Chronicle entries by semantic + BM25 search | No |
| `oracle.propose()` | Stages a new entry for human review | No |
| `oracle.commit()` | Indexes an approved entry — human-triggered only | No |
| `jury.evaluate()` | Scores a design against evidence across 4 dimensions | Yes |
| `council.deliberate()` | Adversarial validation via advisor/reviewer fan-out | Yes |
| `sentinel` | Coverage reporting, drift detection, and PR coverage maps | Optional |
| `compass` | Product-direction synthesis — behaviours, opportunities, pathways, bets, idea scoring | Optional |

---

## Setup

```typescript
import { setup } from "@balpal4495/quorum"

const { oracle, evaluate, deliberate, ask, compass } = await setup({ llm: yourProvider })
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

## Pre-flight — how to query Chronicle

**TypeScript client (preferred when `quorum/client.ts` or equivalent exists):**

Do NOT run `npx quorum` CLI commands. Query Chronicle directly inside your design or propose script:

```typescript
const { oracle } = await getQuorum()
const evidence = await oracle.query("topic of the work")
```

Then proceed with `evaluate()` → `deliberate()` → `oracle.propose()` as normal.

**CLI fallback (for projects without a TypeScript client):**

```bash
quorum advisor brief                        # Chronicle overview
quorum advisor query "topic of the work"    # focused lookup
```

The CLI pre-flight is the fallback only — if a TypeScript client exists in the project, use it instead.

---

## CLI quick reference

```bash
quorum advisor brief                        # full Chronicle summary, no LLM
quorum advisor query "topic"                # keyword search, no LLM
quorum advisor "plain-language question"    # synthesised answer via LLM
quorum check --outcome "..." --design "..."  # instant risk triage
quorum commit --list                        # review pending proposals
quorum commit <id>                          # approve a Chronicle entry
quorum compass map                          # map current product behaviours (no LLM)
quorum compass brief                        # product-direction summary (LLM)
quorum compass pathways --goal "..."        # generate product pathways (LLM)
quorum compass score "idea"                 # score a product idea (LLM)
```

---

## Build and test

```bash
npx vitest run modules/ evals/
```
