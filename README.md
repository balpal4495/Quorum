# Quorum

**Quorum gives your AI coding assistant memory and judgment.**

When Claude Code, Copilot, or Cursor works in your codebase, it forgets everything between sessions. It retries approaches that already failed. It contradicts decisions made last week. It has no idea what the team has already learned.

Quorum fixes this. It installs a persistent knowledge store into your project and gives your AI a structured workflow for querying it before proposing solutions, validating designs before acting, and writing new knowledge back — with you approving every write.

---

## Get started in one command

Run this from your project root:

```bash
npx @balpal4495/quorum@latest init
```

Then run `npm install`.

That's the whole setup. Quorum copies its modules into `quorum/`, merges instruction files for your AI (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`), and creates the Chronicle knowledge store at `.chronicle/`.

---

## Then just talk to your AI

Once initialized, open your AI in agent mode and tell it:

> "Follow quorum/SETUP.md"

Your AI reads the instruction files, wires the modules into your project's entry point, runs the tests, and reports what it did. From that point it operates under Quorum — querying Chronicle before every proposal, running designs through Jury and Council, and staging entries for your approval.

**Works with:**
- Claude Code (`claude` CLI or VS Code extension)
- GitHub Copilot (agent mode)
- Cursor
- Any other AI that can read files and run terminal commands

---

## What changes after setup

### Your AI now has a memory

Before proposing anything, your AI queries Chronicle — the project's knowledge store. If a similar approach was tried and rejected, it knows. If a design decision was made last month, it knows.

> *"I queried Chronicle before proposing the Redis session approach. Entry `[abc-123]` shows we rejected this in March — key rotation wasn't viable. I'm proposing JWT with RS256 instead."*

### Your AI validates designs before acting

Every proposal goes through Jury (confidence scoring against evidence) and Council (adversarial panel review) before it reaches you. Low-confidence or contested ideas get challenged internally first.

> *"Jury scored this 0.41 — gaps in lock strategy and rollback plan. Council flagged the same issue. I've revised the migration plan to use a shadow column approach before bringing it to you."*

### You approve what gets remembered

When a decision is made, your AI stages a Chronicle entry using `oracle.propose()`. You approve it with `oracle.commit(proposalId)`. Nothing is indexed without your explicit sign-off.

```
.chronicle/
  proposals/    ← AI-staged entries waiting for your approval
  committed/    ← approved entries, indexed and searchable
  SUMMARY.md    ← auto-generated weekly context for your AI to read
```

Commit `.chronicle/committed/` to git. Future sessions — and your teammates' sessions — start with that context.

### Every merged PR creates a Chronicle proposal automatically

A GitHub Actions workflow fires when any PR merges to main. It creates a Chronicle proposal capturing the decision, which files changed, and any explicitly deferred items from the PR description. The proposal sits in `proposals/` until you commit it — nothing is auto-indexed.

This means the gap between "PR merged" and "Chronicle knows about it" is now zero.

---

## Real examples

### An agent that remembers a past failure

Your AI is about to propose symmetric JWT signing. Oracle returns:

```
[abc-123] Tried HS256 JWT in March. Rejected — no way to rotate keys without
          invalidating all active sessions. Decision: RS256 with short-lived tokens.
          status: committed · confidence: 0.91
```

Jury flags it as a direct conflict. The agent revises before Council even sees it.

---

### Onboarding a new session to an established project

Day one of a new Claude Code session. Before touching anything:

```
> query Chronicle for: authentication, session handling, token strategy

  6 entries found:
  - HS256 rejected (key rotation problem) → use RS256
  - Redis sessions tried and removed (memory overhead at scale)
  - Current approach: RS256 JWT, 15-min expiry, refresh rotation in httpOnly cookies
  - Upcoming: OAuth migration planned for Q3
```

The AI works with full project context from the first message — no archaeology through git history.

---

### Validating a risky database change

An agent proposes adding a `NOT NULL` column to a 50M-row table. Jury returns:

```
confidence: 0.41
gaps: ["no lock strategy documented", "no rollback plan"]
council_brief: challenge
```

Council's Chairman gives a structured verdict:

```json
{
  "satisfied": false,
  "blockers": [
    {
      "issue": "Naive ALTER TABLE takes an exclusive lock for minutes on a 50M-row table",
      "evidence": ["db-017"],
      "required_fix": "Use shadow column pattern or pg_repack. Add rollback path."
    }
  ],
  "warnings": [],
  "advisor_split": { "proceed": 0, "redesign": 4, "investigate-more": 1 }
}
```

The agent revises the plan. You approve the Chronicle entry once it's solid. The reasoning — including alternatives considered and why they were rejected — is on record for the next time someone touches that table:

```json
{
  "decision": "Use shadow column pattern for NOT NULL migration on users table",
  "alternatives_considered": ["naive ALTER TABLE", "pg_repack"],
  "rejected_reason": ["ALTER TABLE takes exclusive lock for minutes on 50M rows"],
  "scope": ["database", "migrations"],
  "affected_areas": ["db/migrations/", "src/models/user.ts"],
  "validation_plan": ["Confirm 100% backfill before applying NOT NULL constraint", "Test rollback path on staging"],
  "review_after": "2026-08-01"
}
```

---

## What's inside

Four portable TypeScript modules installed into `quorum/modules/`:

| Module | What it does |
|---|---|
| **Oracle** | Query and write interface to Chronicle. No LLM required. |
| **Jury** | Evaluates a proposed design against Chronicle evidence. Returns a decomposed confidence score and hard-blocker gaps. |
| **Council** | A panel of advisors challenges the design independently, reviewers critique anonymously, a Chairman gives a structured verdict with blockers and warnings. |
| **Sentinel** | Shows which files the AI knows nothing about, flags stale knowledge, and posts a coverage map on every PR. |

The modules live in your repo — readable by any AI working in the codebase. Nothing is hidden in `node_modules`.

---

## How Jury works

Before calling the LLM, Jury runs a **deterministic preflight** — no LLM required — that checks whether the design touches sensitive areas (auth, database migrations, crypto, payments, PII, secrets), mentions a rollback strategy, and whether any refuted Chronicle entries conflict with the design. These facts are injected into the Jury prompt as hard ground truth.

The LLM then scores the design across four dimensions:

| Dimension | What it measures |
|---|---|
| Evidence support | Do validated Chronicle entries confirm this approach works here? |
| Feasibility | Do Chronicle entries suggest this is achievable? |
| Risk | How well does the design address known failure modes? |
| Completeness | Does the design cover the full outcome? |

Confidence is recomputed as the exact average of those four scores — the LLM's stated confidence is discarded. Jury also separates `blocking_gaps` (must resolve before proceeding) from `gaps` (useful but not critical).

---

## How Council works

Before running the full panel, a **risk classifier** reads the design text and Chronicle evidence and assigns a risk level:

| Risk | Council mode | LLM calls |
|---|---|---|
| Low | 1 advisor + 1 reviewer | 4 |
| Medium | 1 advisor + 2 reviewers | 5 |
| High | 5 advisors + 5 reviewers | 12 |
| Critical | 5 advisors + 5 reviewers (+ human architecture flag) | 12 |

Auth, crypto, payments, and data deletion trigger Critical. Database migrations, PII, permissions trigger High. Cache, queues, deployments trigger Medium. Everything else is Low.

The Chairman's verdict is **structured**:

```json
{
  "blockers": [
    {
      "issue": "No rollback plan for destructive migration",
      "evidence": ["db-017"],
      "required_fix": "Add shadow-column migration and rollback path before execution"
    }
  ],
  "warnings": [
    {
      "issue": "No integration test for token expiry edge case",
      "suggested_fix": "Add test covering token rotation during concurrent requests"
    }
  ],
  "advisor_split": { "proceed": 2, "redesign": 2, "investigate-more": 1 }
}
```

Blockers must be resolved before the human gate. Warnings can be ticketed. High `advisor_split` disagreement is surfaced explicitly — it means genuine uncertainty, not a safe proceed.

Every Oracle ID cited in the verdict is also validated against the evidence pack that was actually sent. Hallucinated citations are flagged in `citation_validation.hallucinated_ids` and stripped from the Chronicle proposal.

---

## Eval suite

`evals/` contains canonical test cases — known-bad proposals that Council should block and known-good ones it should pass:

| Case | Expected outcome |
|---|---|
| Naive NOT NULL migration on large table | Block — no lock strategy |
| HS256 JWT when RS256 was already chosen | Block — cites refuted entry auth-022 |
| PII fields logged to stdout | Block — GDPR violation in evidence |
| Payment charge without idempotency key | Block — duplicate charge risk |
| Redis sessions (previously removed) | Block — memory overhead already documented |
| Cache without stampede protection | Block — prior incident in Chronicle |
| Safe internal rename | Proceed — low risk, no conflicts |
| RS256 JWT (approved pattern) | Proceed — matches validated Chronicle entry |
| Migration with rollback + shadow column | Proceed — addresses documented failure mode |
| Novel WebSocket design, no evidence | Investigate-more — no Chronicle evidence either way |

Deterministic assertions (preflight, risk classifier) run on every CI pass. LLM-dependent assertions (confidence bounds, Council recommendation) activate with `EVAL_LLM=1`.

```bash
npx vitest run evals/
```

---

## Sentinel — coverage and drift

Sentinel surfaces two things Chronicle can't tell you about itself.

**Coverage** — which parts of your codebase has the AI never documented?

**Drift** — do existing Chronicle entries still accurately describe the code, or have they gone stale?

Add `sentinel-pr.yml` (included in `quorum/`) to your GitHub Actions and every PR gets a comment showing a full-project coverage table and a colour-coded heatmap. Changed modules are highlighted. Reviewers see exactly where knowledge is solid and where it goes dark.

---

## For custom agent pipelines

If you're building your own agent workflow programmatically, the modules expose a clean TypeScript API. Wire your LLM provider and call directly:

```typescript
import { setup } from "./quorum/modules/setup"

const { oracle, evaluate, deliberate } = await setup({ llm: myLLMProvider })

const evidence = await oracle.query("authentication patterns")
const jury     = await evaluate({ outcome, design, evidence })
const verdict  = await deliberate({ outcome, design, evidence, jury_output: jury })
```

The `LLMProvider` type is a simple function — wire OpenAI, Anthropic, or anything else:

```typescript
// Anthropic
const llm = async (messages, model = "claude-3-5-sonnet-20241022") => {
  const res = await anthropic.messages.create({ model, messages, max_tokens: 2048 })
  return res.content[0].type === "text" ? res.content[0].text : ""
}

// OpenAI
const llm = async (messages, model = "gpt-4o") => {
  const res = await openai.chat.completions.create({ model, messages })
  return res.choices[0].message.content ?? ""
}
```

Full API reference: [modules/README.md](modules/README.md)

---

## Releases

Quorum is published as `@balpal4495/quorum`. New versions release automatically when a semver tag is pushed — via GitHub Actions and OIDC Trusted Publishing, no stored tokens.

---

## Docs

- [SETUP.md](SETUP.md) — full bootstrap sequence (the file you point your AI at)
- [modules/README.md](modules/README.md) — TypeScript API reference
- [modules/AGENTS.md](modules/AGENTS.md) — file ownership map
- [modules/CLAUDE.md](modules/CLAUDE.md) — design decisions and invariants
