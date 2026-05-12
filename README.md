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

Council's Chairman gives a verdict:

```
satisfied: false
verdict: "On a table this size, a naive ALTER TABLE takes an exclusive lock for minutes.
          Specify a shadow column pattern or pg_repack. No rollback plan documented."
```

The agent revises the plan. You approve the Chronicle entry once it's solid. The reasoning is on record for the next time someone touches that table.

---

## What's inside

Four portable TypeScript modules installed into `quorum/modules/`:

| Module | What it does |
|---|---|
| **Oracle** | Query and write interface to Chronicle. No LLM required. |
| **Jury** | Evaluates a proposed design against Chronicle evidence. Returns a confidence score. |
| **Council** | A panel of advisors challenges the design independently, reviewers critique anonymously, a Chairman gives a final verdict. |
| **Sentinel** | Shows which files the AI knows nothing about, flags stale knowledge, and posts a coverage map on every PR. |

The modules live in your repo — readable by any AI working in the codebase. Nothing is hidden in `node_modules`.

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
