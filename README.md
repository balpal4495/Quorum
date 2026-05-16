# Quorum

**Quorum gives your AI coding assistant persistent memory and judgment — and keeps it getting smarter over time.**

When Claude Code, Copilot, Cursor, or Codex works in your codebase, it forgets everything between sessions. It retries approaches that already failed. It contradicts decisions made last week. It has no idea what the team has already learned.

Quorum fixes this. It installs a persistent knowledge store (Chronicle) into your project, gives your AI a structured workflow for querying it before proposing solutions, validates designs before acting, and writes new knowledge back — with you approving every write.

---

## Get started in one command

```bash
npx @balpal4495/quorum@latest init
```

Then `npm install`. That's it.

Quorum copies its modules into `quorum/`, merges instruction files for your AI (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), and creates the Chronicle knowledge store at `.chronicle/`.

---

## How Quorum learns over time

This is the core loop. Every session makes the project smarter.

```
session start
  └─ AI reads Chronicle (quorum advisor brief + query)
       └─ work happens informed by accumulated knowledge
            └─ decisions and learnings staged as proposals (oracle.propose)
                 └─ you approve from terminal (quorum commit)
                      └─ Chronicle grows
                           └─ PR merged → growth comment posted automatically
                                └─ periodic: quorum evolve consolidates + improves entries
```

**Session start** — the AI runs `quorum advisor brief` to see what Chronicle knows, then `quorum advisor query "topic"` to get relevant entries before touching any code.

**During work** — Oracle is queried before every significant decision. Refuted entries are treated as hard stops. Validated entries inform the approach.

**Session end** — the AI stages Chronicle proposals for every meaningful decision made. You review and commit them with `quorum commit`.

**On every PR merge** — a growth comment is posted automatically showing exactly what Chronicle learned from that PR.

**Periodically** — `quorum evolve` reviews all entries and proposes consolidations, resolves contradictions, and promotes confirmed knowledge.

**Visibility at any time** — `quorum growth` shows whether learning is actually happening, how fast, and what was learned recently.

---

## CLI commands

```bash
npm install -g @balpal4495/quorum
# or: npx @balpal4495/quorum <command>
```

| Command | What it does | LLM |
|---|---|---|
| `quorum advisor "question"` | Ask a plain-language question — answer synthesised from Chronicle evidence | Auto¹ |
| `quorum advisor query "topic"` | Search Chronicle entries by keyword | No |
| `quorum advisor brief` | High-level Chronicle summary | No |
| `quorum growth` | Chronicle health — growth rate, recent learnings, weekly sparkline | No |
| `quorum evolve` | Consolidate and improve Chronicle entries | Auto¹ |
| `quorum status` | Chronicle health — pending proposals, committed entries | No |
| `quorum check --outcome X --design Y` | Deterministic preflight + risk classifier | No |
| `quorum commit <id>` | Approve and index a pending proposal | No |
| `quorum sentinel [coverage]` | Chronicle coverage of your source files | No |
| `quorum init` | Scaffold Quorum into a project | No |

¹ **Auto-detect** — Quorum finds whichever LLM is available: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_BASE_URL`, Ollama at localhost:11434, or an authenticated `gemini` CLI. When running inside Claude Code, Copilot, Codex, or any other AI agent without a separate key, these commands output Chronicle evidence and a synthesis request directly — the agent answers inline. No key required.

---

## `quorum advisor` — ask Chronicle a question

```bash
quorum advisor "what did we decide about authentication?"
quorum advisor query "session handling"   # keyword search, no LLM
quorum advisor brief                      # full Chronicle summary, no LLM
```

```
Question: what did we decide about authentication?

  What we know
  The team settled on RS256 JWT after rejecting HS256 — key rotation without
  invalidating active sessions was the blocker. Tokens are 15-min expiry with
  refresh rotation in httpOnly cookies.

  Recommendation
  Follow the RS256 pattern. Entry [abc-123] is validated at 0.91 confidence.

  Risks
  · OAuth migration is planned for Q3 — coordinate before adding new auth surfaces

  Next step
  quorum advisor query "oauth migration" to check current status
```

Advisor validates its own answer internally — if confidence is below 0.7 or blockers exist, it retries up to 2 times with the previous answer as context before returning.

---

## `quorum growth` — is Chronicle actually learning?

```bash
quorum growth
quorum growth --json   # machine-readable, for CI
```

```
Chronicle growth

  Status        THRIVING
  Total entries 17
  Last 7 days   6 commits
  Last 30 days  17 commits
  Last commit   0 days ago  2026-05-16
  Pending       2 proposals awaiting quorum commit

  Weekly commits
    w/c 2026-05-11  ▪▪▪▪▪▪  6
    w/c 2026-05-04  ▪▪▪▪▪▪▪▪▪▪▪  11

  Recent learnings
    bf448871  Low-risk designs skip Council entirely — Jury alone is sufficient…  2026-05-16
    3efb1789  Advisor validates answers before returning — retries up to 2 times…  2026-05-16
    090c7dc6  Advisor is a read-only path — never calls oracle.propose()…         2026-05-16
    e57c30d5  Releases trigger from PR labels, not manual tag pushes…             2026-05-16
```

Status levels: `EMPTY` → `STALLED` (14 days with no commits) → `SLOW` (7 days) → `HEALTHY` → `THRIVING` (3+ commits this week). When stalled, it tells you exactly what to do.

---

## `quorum evolve` — Chronicle self-improvement

```bash
quorum evolve             # analyse and stage improvement proposals
quorum evolve --dry-run   # preview without writing
```

```
Quorum evolve  17 entries · via Anthropic

  ✓  Analysis complete

  2 improvements found

  ✓  consolidate  10b848a2 + d93b6f40
     Both entries describe Mermaid rendering failures — distinct symptoms, same root cause
     → Mermaid diagrams have three known failure modes in GitHub PR descriptions…

  ✓  promote      55278b3d → validated (0.88)
     Confirmed by three subsequent entries referencing SUMMARY.md temporal context

  2 proposals staged — run quorum commit --list to review
```

Three improvement types:

- **consolidate** — two entries covering the same ground → one sharper entry with `supersedes`
- **resolve** — a validated entry contradicted by a newer one → mark it `refuted`
- **promote** — an `open` entry confirmed by later entries → elevate to `validated`

Every proposed improvement goes through the human gate (`quorum commit`). Nothing is auto-committed.

---

## `quorum check` — instant risk triage

```bash
quorum check \
  --outcome "migrate auth from sessions to JWT" \
  --design "replace session middleware with HS256 tokens on all routes"
```

```
Preflight
  ⚠  Sensitive areas: auth
  ✗  No rollback strategy mentioned
  ✗  No test strategy mentioned

Risk
  Level:        CRITICAL
  Council mode: full
  Reasons:
    · authentication or authorisation logic

  ⚠  Critical risk — human architecture review required before proceeding.
```

Exit codes: `0` = low/medium, `1` = high, `2` = critical — pipe directly into CI scripts.
Also accepts JSON on stdin: `echo '{"outcome":"…","design":"…"}' | quorum check --json`

---

## `quorum commit` — the human gate

```bash
quorum commit --list                    # see all pending proposals
quorum commit a1b2c3d4                  # approve and index (partial ID prefix works)
quorum commit a1b2c3d4 --dry-run        # preview without writing
```

Writes to `.chronicle/committed/`, updates `SUMMARY.md`, removes the proposal. Always works — no extra dependencies required. Install `@xenova/transformers` and `vectordb` to also embed and index in the vector store for semantic search.

---

## What changes after setup

### Your AI starts every session with full project context

Before touching any code, your AI reads Chronicle:

```bash
quorum advisor brief                          # what has the project learned?
quorum advisor query "topic of the work"      # what's relevant to today's task?
```

> *"I queried Chronicle before proposing the Redis session approach. Entry `[abc-123]` shows we rejected this in March — key rotation wasn't viable. I'm proposing JWT with RS256 instead."*

### Designs are validated before they reach you

Every proposal goes through Jury (confidence scoring against evidence) and Council (adversarial panel) before it surfaces. Low-confidence or contested ideas get challenged internally first.

> *"Jury scored this 0.41 — gaps in lock strategy and rollback plan. Council flagged the same. I've revised the migration to use a shadow column approach before bringing it to you."*

### You approve what gets remembered

```bash
quorum commit --list        # see what's pending
quorum commit <id>          # approve and index
```

Nothing is indexed without your sign-off.

```
.chronicle/
  proposals/    ← AI-staged entries waiting for your approval
  committed/    ← approved entries, indexed and searchable
  SUMMARY.md    ← auto-generated weekly context for your AI to read
```

Commit `.chronicle/committed/` to git. Every future session — yours and your teammates' — starts with that context.

### Every merged PR shows what Chronicle learned

Quorum ships two GitHub Actions workflows. Enable them by copying `.github/workflows/` from the [Quorum repo](https://github.com/balpal4495/Quorum):

**`chronicle-on-merge.yml`** — fires on every PR merge. Creates a Chronicle proposal from the PR metadata and posts a growth comment:

```
## Quorum Chronicle — what this PR taught

Chronicle grew from 14 → 17 entries

Committed this PR:
  ✅ [bf448871]  Low-risk designs skip Council entirely — jury-only, 0 LLM calls
  ✅ [3efb1789]  Advisor validates answers before returning — retries up to 2 times
  ✅ [090c7dc6]  Advisor is a read-only path — never calls oracle.propose()

2 proposals pending — run quorum commit --list to review.

---
Run quorum growth for full Chronicle health · quorum evolve to consolidate entries
```

**`sentinel-pr.yml`** — posts a coverage table and Mermaid heatmap on every PR showing which files Chronicle knows about and which are blind spots.

---

## Real examples

### An agent that remembers a past failure

Your AI is about to propose symmetric JWT signing. Oracle returns:

```
[abc-123] Tried HS256 JWT in March. Rejected — no way to rotate keys without
          invalidating all active sessions. Decision: RS256 with short-lived tokens.
          status: validated · confidence: 0.91
```

Jury flags it as a direct conflict. The agent revises before Council even sees it.

---

### Onboarding a new session to an established project

Day one of a new Claude Code session. Before touching anything:

```
quorum advisor query "authentication, session handling, token strategy"

  6 entries found:
  · HS256 rejected (key rotation problem) → use RS256
  · Redis sessions tried and removed (memory overhead at scale)
  · Current: RS256 JWT, 15-min expiry, refresh rotation in httpOnly cookies
  · Upcoming: OAuth migration planned for Q3
```

Full project context from the first message — no archaeology through git history.

---

### Validating a risky database change

An agent proposes adding a `NOT NULL` column to a 50M-row table. Jury returns:

```
confidence: 0.41
gaps: ["no lock strategy documented", "no rollback plan"]
council_brief: challenge
```

Council gives a structured verdict with blockers that must be resolved before proceeding. The agent revises. You approve the Chronicle entry once it's solid — including alternatives considered and why they were rejected — so the next person touching that table has the full reasoning:

```json
{
  "decision": "Use shadow column pattern for NOT NULL migration on users table",
  "alternatives_considered": ["naive ALTER TABLE", "pg_repack"],
  "rejected_reason": ["ALTER TABLE takes exclusive lock for minutes on 50M rows"],
  "scope": ["database", "migrations"],
  "validation_plan": ["Confirm 100% backfill before applying NOT NULL constraint"],
  "review_after": "2026-08-01"
}
```

---

## What's inside

Five portable TypeScript modules installed into `quorum/modules/`:

| Module | What it does | LLM |
|---|---|---|
| **Advisor** | Plain-language interface to Chronicle. Ask a question, get a concise answer synthesised from evidence, validated with an internal retry loop. | Yes |
| **Oracle** | Query and write interface to Chronicle. Two-pass retrieval (vector + BM25). | No |
| **Jury** | Evaluates a design against Chronicle evidence. Four-dimension confidence score, deterministic preflight, hard-blocker gaps. | Yes |
| **Council** | Adversarial panel — advisors challenge independently, reviewers critique anonymously, Chairman gives a structured verdict. Risk-scaled fan-out. | Yes |
| **Sentinel** | Coverage reporting (which files Chronicle knows about), drift detection (are entries still accurate), PR coverage maps. | Optional |

The modules live in your repo — readable by any AI working in the codebase. Nothing is hidden in `node_modules`.

---

## How Jury works

Before calling the LLM, Jury runs a **deterministic preflight** that checks whether the design touches sensitive areas (auth, database migrations, crypto, payments, PII, secrets), mentions a rollback strategy, and whether any refuted Chronicle entries conflict with the design. These facts are injected into the prompt as hard ground truth.

The LLM scores the design across four dimensions:

| Dimension | What it measures |
|---|---|
| Evidence support | Do validated Chronicle entries confirm this approach works here? |
| Feasibility | Do Chronicle entries suggest this is achievable? |
| Risk | How well does the design address known failure modes? |
| Completeness | Does the design cover the full outcome? |

Confidence is recomputed as the exact average — the LLM's stated value is discarded. Jury separates `blocking_gaps` (must resolve before proceeding) from `gaps` (useful but not critical).

---

## How Council works

A **risk classifier** runs before the panel and scales fan-out accordingly:

| Risk | Triggers | Council mode | LLM calls |
|---|---|---|---|
| Low | Nothing sensitive | jury-only — Council skipped entirely | 0 |
| Medium | Cache, queues, deployments | lite — 1 advisor + 2 reviewers | 5 |
| High | DB migrations, PII, permissions | full — 5 advisors + 5 reviewers | 12 |
| Critical | Auth, payments, crypto, data deletion | full + human flag | 12 |

Refuted entries in the evidence pack always elevate risk by at least one level.

The Chairman's verdict is structured with `blockers` (must resolve), `warnings` (should address), `advisor_split` (shows disagreement), and `citation_validation` (hallucinated Oracle IDs are stripped before the Chronicle proposal is written).

---

## Eval suite

`evals/` contains canonical test cases — known-bad proposals that should block, known-good ones that should pass:

| Case | Expected |
|---|---|
| Naive NOT NULL migration on large table | Block — no lock strategy |
| HS256 JWT when RS256 was already chosen | Block — cites refuted entry |
| PII fields logged to stdout | Block — GDPR violation in evidence |
| Payment charge without idempotency key | Block — duplicate charge risk |
| Safe internal rename | Proceed — low risk, no conflicts |
| RS256 JWT (approved pattern) | Proceed — matches validated entry |
| Migration with rollback + shadow column | Proceed — addresses documented failure mode |

Deterministic assertions run on every CI pass. LLM assertions activate with `EVAL_LLM=1`.

```bash
npx vitest run evals/
```

---

## Sentinel — coverage and drift

**Coverage** — which parts of your codebase has the AI never documented?

```bash
quorum sentinel coverage --path src
quorum sentinel coverage --json
```

**Drift** — are existing Chronicle entries still accurate? Requires an LLM; use `sentinelAssertions({ llm })` in your test suite.

---

## For custom agent pipelines

Wire the modules directly into any TypeScript agent:

```typescript
import { setup } from "./quorum/modules/setup"

const { oracle, evaluate, deliberate, ask } = await setup({ llm: myLLMProvider })

// Ask a plain-language question
const answer = await ask("what did the team decide about authentication?")

// Full evaluation pipeline
const evidence = await oracle.query("authentication patterns")
const jury     = await evaluate({ outcome, design, evidence })
const verdict  = await deliberate({ outcome, design, evidence, jury_output: jury })
```

```typescript
// Wire any LLM provider
const llm: LLMProvider = async (messages, model = "claude-3-5-sonnet-20241022") => {
  const res = await anthropic.messages.create({ model, messages, max_tokens: 2048 })
  return res.content[0].type === "text" ? res.content[0].text : ""
}
```

Full API reference: [modules/README.md](modules/README.md)

---

## Releases

Published as `@balpal4495/quorum`. Releases trigger automatically on PR merge via label (`release:patch`, `release:minor`, `release:major`) — GitHub Actions bumps the version, tags, and publishes via OIDC Trusted Publishing.

---

## Docs

- [SETUP.md](SETUP.md) — full bootstrap sequence (point your AI at this)
- [modules/README.md](modules/README.md) — TypeScript API reference
- [modules/AGENTS.md](modules/AGENTS.md) — file ownership map
- [modules/CLAUDE.md](modules/CLAUDE.md) — design decisions and invariants
