# Quorum

**Git-backed memory and design review for AI coding agents.**

Your agent knows how to code. It does not know what your team decided last week.

Quorum gives Claude Code, Cursor, Codex, Copilot, and other coding agents a project memory they check before proposing changes — and only humans approve what gets remembered.

```bash
npx @balpal4495/quorum@latest init
```

This creates `.chronicle/`, adds agent instructions to `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md`, and gives every future AI session access to the project's approved memory.

---

## The problem

AI coding agents forget:

- decisions made in prior sessions
- approaches that already failed and why
- which parts of the codebase are risky
- team-specific architecture rules
- why something was rejected

Every new session starts from zero. The same mistakes get proposed again. The same rejected patterns get rediscovered.

---

## Why not just use agent instructions?

Agent instructions tell the AI how to behave.
Quorum tells the AI what the project has already learned.

| | Agent instructions | Chronicle |
|---|---|---|
| Content | Rules and preferences | Decisions, rejections, outcomes |
| Growth | Static — you write them | Grows — the agent stages, you approve |
| Durability | Easy to overwrite or ignore | Git-backed, survives config changes |
| Failed approaches | Not tracked | Hard stops on refuted patterns |
| Human approval | Not required | Required for every indexed entry |

Instructions are a starting point. Chronicle is accumulated project knowledge.

---

## What changes after Quorum

**Without Quorum:**

> "I'll replace sessions with HS256 JWTs."

**With Quorum:**

> "I checked Chronicle first. HS256 was rejected in March — key rotation would invalidate all active sessions. The validated approach is RS256 with short-lived access tokens and refresh rotation in httpOnly cookies."

The agent didn't discover this through code archaeology. Chronicle told it. That knowledge was approved by a human and has been there for every session since.

---

## Three guarantees

### 1. It remembers

Every session starts from approved project knowledge, not a blank chat window. Decisions, rejected approaches, risky areas, and architectural rules — all available before the first line of code is written.

### 2. It checks

Risky proposals are compared against Chronicle evidence before they reach you. Refuted approaches are hard stops. Missing rollback plans and undocumented risks are surfaced before implementation.

### 3. It learns under human control

The agent can stage new lessons. Only you decide what becomes project memory. Nothing is indexed without your sign-off.

---

## Where Quorum fits

Quorum does not replace your coding-agent workflow.

Use Superpowers, Claude Code, Cursor rules, Codex instructions, or your own process for planning and implementation. Quorum adds the missing memory and evidence layer underneath them.

```
Agent workflow:
  brainstorm → design → plan → implement → review → merge

Quorum layer:
  remember → check evidence → flag risk → stage learning → human approval
```

> **Your agent already has a workflow. Quorum gives it institutional memory.**

### Using Quorum with Superpowers

| Superpowers phase | Quorum hook |
|---|---|
| Brainstorming | `quorum advisor brief` and `quorum advisor query "topic"` before proposing options |
| Writing the design | Chronicle entries as evidence for accepted and rejected approaches |
| Planning | `quorum check` on the proposed design before implementation |
| TDD / implementation | Stage meaningful decisions as Chronicle proposals |
| Code review | Check whether the change contradicts validated entries |
| Finish branch | `quorum commit --list`, approve learnings, then `quorum growth` |

---

## The Quorum loop

```
1. Start with memory
   quorum advisor brief
   quorum advisor query "authentication"

2. Check the design
   quorum check --outcome "migrate auth" --design "..."

3. Stage what was learned
   The agent proposes a Chronicle entry.

4. Approve memory
   quorum commit --list
   quorum commit <id>

5. Keep memory healthy
   quorum growth
   quorum evolve
```

Every PR merge posts a growth comment showing what Chronicle learned. `quorum evolve` periodically consolidates entries and resolves contradictions.

---

## What you can do

| Job | Command |
|---|---|
| Ask what the project already knows | `quorum advisor "what did we decide about auth?"` |
| Search memory without an LLM | `quorum advisor query "auth"` |
| Start a session with full context | `quorum advisor brief` |
| Check a design before coding | `quorum check --outcome ... --design ...` |
| Approve what the agent should remember | `quorum commit <id>` |
| See whether memory is growing | `quorum growth` |
| Consolidate stale or duplicate entries | `quorum evolve` |
| Seed Chronicle from git history | `quorum bootstrap --from-git --propose` |
| Ingest docs and source files as evidence | `quorum ingest docs/ --recurse` |
| Ingest URLs as evidence | `quorum ingest-url https://example.com/rfc` |
| Find undocumented areas | `quorum sentinel coverage` |
| Understand what the product currently does | `quorum compass map` |
| Generate product pathways toward a goal | `quorum compass pathways --goal "..."` |
| Score a product idea | `quorum compass score "add Slack integration"` |
| Stage a direction decision for Chronicle | `quorum compass propose --from-last` |

---

## Start small, then add guardrails

### Level 0 — Cold start
New repo with no Chronicle yet? Seed it from git history:
```bash
quorum bootstrap --from-git --since P90D --propose
quorum commit --list   # review, then approve entries
```
Each commit becomes a low-trust draft proposal (`confidence: 0.4`, `needs_human_summary: true`). Nothing is indexed until you run `quorum commit <id>`.

### Level 1 — Local memory
Use `quorum advisor brief` and `quorum advisor query` at the start of AI sessions. No setup beyond `init`.

### Level 2 — Human-approved learning
Let the agent stage proposals. Approve them with `quorum commit`. Chronicle grows.

### Level 3 — Design checks
Run `quorum check` before risky changes. Auth, database, payments, PII, crypto — each gets a deterministic preflight and risk level.

### Level 4 — Team memory in Git
Commit `.chronicle/committed/` so every teammate and every new AI session starts with the same accumulated knowledge.

### Level 5 — CI and PR visibility
Enable the GitHub Actions workflows for automatic PR growth comments, coverage reports, and drift checks.

---

## Get started

```bash
npx @balpal4495/quorum@latest init
npm install
```

Then run Quorum from your project:

```bash
npx quorum advisor brief
npx quorum advisor "what has the team decided about auth?"
npx quorum check --outcome "..." --design "..."
```

**Optional — install the CLI globally:**

```bash
npm install -g @balpal4495/quorum
quorum advisor brief
```

> **v2 architecture:** Implementation lives in the npm package (`node_modules/@balpal4495/quorum`). Project memory lives in your repo (`.chronicle/`). Agent docs bridge the two (`quorum/CLAUDE.md`, `.github/copilot-instructions.md`). Nothing is copied into your project that you need to maintain.

---

## LLM setup

LLM-powered commands (`advisor`, `evolve`, `check`, `compass`, `serve`) auto-detect whichever provider is available. No config file is needed — Quorum picks the first working option from the list below.

**Recommended: use a CLI tool you're already logged into.** No API key required.

### Option 1 — Claude Code CLI (recommended)

If you have [Claude Code](https://claude.ai/code) installed and are logged in, Quorum uses it automatically.

```bash
# Verify it's working
echo "say hi" | claude --print
```

Quorum detects the `Claude Code-credentials` keychain entry (macOS) or a session file in `~/.claude/sessions/`. If the command above works, Quorum will use it.

### Option 2 — GitHub Copilot CLI

If you have the [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli) installed and are logged in via VS Code, Quorum uses it automatically.

```bash
# Verify it's working
copilot -p "say hi"
```

Quorum detects `~/.copilot/session-state/` having at least one session (created after first auth). If the command above works, Quorum will use it.

### Option 3 — API keys

Set any one of these environment variables:

| Variable | Provider |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `OPENAI_BASE_URL` | Any OpenAI-compatible endpoint (Azure, Groq, etc.) |

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

### Option 4 — Gemini CLI

If you have the [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed and authenticated, Quorum uses it automatically.

```bash
# Verify it's working
gemini -p "say hi"
```

### Option 5 — Ollama (local, last resort)

If Ollama is running at `localhost:11434`, Quorum uses the first available model. Set `OLLAMA_MODEL` to pin a specific model, or `OLLAMA_HOST` for a non-default address.

```bash
ollama serve
export OLLAMA_MODEL=llama3.2   # optional
```

### Checking what was detected

```bash
quorum serve   # startup line shows: LLM: Claude Code CLI
```

### No LLM — still useful

Without any provider, `advisor query`, `advisor brief`, `check`, and `coverage` all work with no LLM. Commands output Chronicle evidence and a synthesis request that your agent (Claude Code, Copilot, Codex) can answer inline.

---

## Upgrading from v1

If your project has a `quorum/modules/` folder (the v1 vendored pattern), migrate in one step:

```bash
quorum migrate-v2
```

After any `npm update @balpal4495/quorum`, refresh agent instruction files:

```bash
quorum sync
```

---

## Runtime model

The CLI works in plain Node 18+.

Programmatic imports are TypeScript-native and require a TS-aware runtime such as `tsx`, `ts-node`, Bun, or a bundler. Plain `node` will not resolve `.ts` files.

```bash
# recommended for scripts
npx tsx your-script.ts

# or Bun
bun your-script.ts
```

For most host-project use cases the CLI is sufficient and requires no loader. See [modules/README.md](modules/README.md) for the full programmatic API.

---

## Command reference

### `quorum ingest` — ingest files and folders

```bash
quorum ingest README.md SETUP.md
quorum ingest docs/ --recurse
quorum ingest docs/ --recurse --propose   # also stage as proposals
```

Writes low-trust evidence to `.chronicle/sources/` and `.chronicle/evidence/`. Content-hash deduplication skips files that have not changed since the last ingest. Use `--propose` to also write to `.chronicle/proposals/` for review with `quorum commit --list`.

Supported extensions: `.md`, `.txt`, `.js`, `.ts`, `.json`, `.yaml`, `.html`, and other plain-text formats. Binary and unsupported files are recorded as sources with a fallback summary.

---

### `quorum ingest-git` — ingest git history

```bash
quorum ingest-git --since P90D
quorum ingest-git --since P6M --propose   # also stage commits as proposals
```

`--since` accepts ISO 8601 durations: `P30D`, `P6M`, `P1Y`. Defaults to `P90D`. Each commit is stored as a source record and an evidence record containing the commit subject and changed files. Already-ingested commits are skipped by hash.

---

### `quorum ingest-url` — ingest URLs

```bash
quorum ingest-url https://example.com/internal-rfc
quorum ingest-url https://example.com/rfc https://example.com/spec --propose
```

Fetches each URL (http/https only), strips HTML, and stores a low-trust evidence record. Follows redirects. Deduplicates by URL on re-runs.

---

### `quorum bootstrap` — cold-start Chronicle from history

```bash
quorum bootstrap --from-git
quorum bootstrap --from-git --since P6M --propose
```

Convenience wrapper around `ingest-git`. Seeds a new Chronicle from the project's commit history. Without `--propose`, evidence sits in `.chronicle/evidence/` until you promote it. With `--propose`, every commit becomes a draft proposal ready for `quorum commit`.

All ingested evidence uses the same low-trust format as PR-merge proposals:

```json
{
  "source_quality": "metadata-derived",
  "needs_human_summary": true,
  "status": "open",
  "confidence": 0.4
}
```

This solves the cold-start problem: a repo gets candidate memory from real history without bypassing the human gate.

---

### `quorum advisor` — ask Chronicle a question

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

No LLM required for `query` and `brief`. When an LLM is available, `advisor` synthesises and validates answers internally — retrying up to 2 times if confidence is below 0.7. When running inside Claude Code, Copilot, or Codex with no separate API key, it outputs Chronicle evidence and a synthesis request for the agent to answer inline.

---

### `quorum check` — instant risk triage

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
Accepts JSON on stdin: `echo '{"outcome":"…","design":"…"}' | quorum check --json`

---

### `quorum commit` — the human gate

```bash
quorum commit --list                    # see all pending proposals
quorum commit a1b2c3d4                  # approve and index (partial ID works)
quorum commit a1b2c3d4 --dry-run        # preview without writing
```

Writes to `.chronicle/committed/`, updates `SUMMARY.md`, removes the proposal. Always works — no extra dependencies required. Install `@xenova/transformers` and `vectordb` to also embed entries for semantic search.

```
.chronicle/
  sources/      ← raw ingested source records (files, URLs, git commits)
  evidence/     ← low-trust extracted insights, not yet Chronicle
  proposals/    ← AI-staged entries waiting for your approval
  committed/    ← approved entries, indexed and searchable
  SUMMARY.md    ← auto-generated context for your AI to read
```

---

### `quorum serve` — governance UI + MCP server

```bash
quorum serve              # starts on http://localhost:4242
quorum serve --port 8080  # custom port
quorum serve --no-llm     # disable LLM auto-detection
```

Starts a single HTTP server that provides:

- **Governance UI** at `/` — browse committed entries, review and approve pending proposals (with inline evidence, Jury breakdown, and Council conditions), track Chronicle health, and run Compass product-direction analysis.
- **MCP server** at `POST /mcp` — JSON-RPC 2.0 endpoint exposing 10 tools and 6 resources to any MCP-compatible agent.
- **REST API** — used by the UI and accessible directly:

| Route | Description |
|---|---|
| `GET /api/entries?q=<query>` | Search committed Chronicle entries |
| `GET /api/proposals` | List pending proposals |
| `GET /api/coverage` | Chronicle coverage map |
| `GET /api/growth` | Chronicle health score |
| `GET /api/compass?subcommand=map\|brief\|opportunities\|bets` | Compass product direction |
| `PATCH /api/proposals/:id` | Edit a pending proposal before committing |

**MCP resources** (readable by agents via `resources/read`):

```
chronicle://summary          chronicle://proposals
chronicle://coverage         chronicle://growth
chronicle://compass          chronicle://entry/{id}
```

**MCP tools**: `quorum_query`, `quorum_brief`, `quorum_stage`, `quorum_pending`, `quorum_coverage`, `quorum_growth`, `quorum_help`, `quorum_advisor`\*, `quorum_check`, `quorum_compass`\*

\* LLM-powered tools auto-activate when `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `GEMINI_API_KEY` is set. Without a key they return a `no-llm` status with CLI fallback instructions.

---

### `quorum growth` — is Chronicle actually learning?

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

Status levels: `EMPTY` → `STALLED` (14 days) → `SLOW` (7 days) → `HEALTHY` → `THRIVING` (3+ this week). When stalled, it tells you what to do.

---

### `quorum evolve` — Chronicle self-improvement

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

### Every merged PR shows what Chronicle learned

On every PR merge, Quorum automatically posts a growth comment:

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

Enable by copying `.github/workflows/` from the [Quorum repo](https://github.com/balpal4495/Quorum). `sentinel-pr.yml` also posts a coverage table on every PR showing which files Chronicle knows about and which are blind spots.

---

## Real examples

### An agent that remembers a past failure

Your AI is about to propose symmetric JWT signing. Chronicle returns:

```
[abc-123] Tried HS256 JWT in March. Rejected — no way to rotate keys without
          invalidating all active sessions. Decision: RS256 with short-lived tokens.
          status: validated · confidence: 0.91
```

Jury flags it as a direct conflict. The agent revises before it ever reaches you.

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

Council gives a structured verdict with blockers. The agent revises. You approve the Chronicle entry once it's solid:

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

The next person touching that table has the full reasoning. They don't repeat the mistake.

---

## How it works under the hood

You do not need to understand these internals to use Quorum. They live in `node_modules/@balpal4495/quorum` after install. The `quorum/` folder that `init` creates in your project contains agent-readable docs and Chronicle data — not module source.

| Module | What it does | LLM |
|---|---|---|
| **Advisor** | Plain-language interface to Chronicle. Ask a question, get an answer synthesised from evidence, validated with an internal retry loop. | Auto |
| **Oracle** | Query and write interface to Chronicle. Two-pass retrieval (vector + BM25). | No |
| **Jury** | Evaluates a design against Chronicle evidence. Four-dimension confidence score, deterministic preflight, hard-blocker gaps. | Yes |
| **Council** | Adversarial panel — advisors challenge independently, reviewers critique anonymously, Chairman gives a structured verdict. Risk-scaled fan-out. | Yes |
| **Sentinel** | Coverage reporting (which files Chronicle knows about), drift detection (are entries still accurate), PR coverage maps. | Optional |
| **Compass** | Product-direction layer — maps current behaviours from code and docs, identifies gaps and opportunities, generates pathways, strategic bets, and idea scores grounded in Chronicle evidence. All writes go through `oracle.propose()`. | Optional |

### How Jury works

Before calling the LLM, Jury runs a **deterministic preflight** — checks sensitive areas (auth, database migrations, crypto, payments, PII, secrets), rollback strategy, and refuted Chronicle conflicts. These are injected as hard ground truth.

The LLM scores across four dimensions: evidence support, feasibility, risk, completeness. Confidence is the exact average — the LLM's stated value is discarded. Jury separates `blocking_gaps` (must resolve) from `gaps` (useful but not blocking).

### How Council works

A risk classifier scales the panel before it runs:

| Risk | Triggers | Council mode | LLM calls |
|---|---|---|---|
| Low | Nothing sensitive | jury-only — Council skipped | 0 |
| Medium | Cache, queues, deployments | lite — 1 advisor + 2 reviewers | 5 |
| High | DB migrations, PII, permissions | full — 5 advisors + 5 reviewers | 12 |
| Critical | Auth, payments, crypto, data deletion | full + human flag | 12 |

Refuted entries always elevate risk by at least one level. Citation validation strips hallucinated Oracle IDs before any proposal is written.

### LLM auto-detection

Quorum tries providers in this order: **Claude Code CLI** → **Copilot CLI** → `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GEMINI_API_KEY` → `OPENAI_BASE_URL` → Gemini CLI → Ollama. See [LLM setup](#llm-setup) for how to configure each option.

---

## For custom agent pipelines

```typescript
import { setup } from "@balpal4495/quorum"

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

```bash
npx vitest run evals/
```

Deterministic assertions run without any LLM. Set `EVAL_LLM=1` to also test Jury confidence and Council recommendations against a real LLM.

---

## What Quorum is not

Quorum is not a coding agent.  
Quorum is not a replacement for TDD, code review, or planning.  
Quorum is not a private SaaS memory store.  
Quorum does not auto-approve what the AI learns.

It is a project-local memory, evidence, and review layer for agents you already use.

---

## Releases

Published as `@balpal4495/quorum`. Releases trigger automatically on PR merge via label (`release:patch`, `release:minor`, `release:major`) — GitHub Actions bumps the version, tags, and publishes via OIDC Trusted Publishing.

---

## Docs

- [SETUP.md](SETUP.md) — full bootstrap sequence (point your AI at this)
- [modules/README.md](modules/README.md) — TypeScript API reference
- [modules/AGENTS.md](modules/AGENTS.md) — file ownership map
- [modules/CLAUDE.md](modules/CLAUDE.md) — design decisions and invariants
