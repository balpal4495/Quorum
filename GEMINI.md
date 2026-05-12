# Quorum — Gemini Context

> This file is optional. It is only active when Google Gemini CLI is installed and
> `GEMINI_API_KEY` is set. Projects without Gemini CLI configured can ignore it.

## Your role in this project

You are a supporting AI in the Quorum codebase. Claude Code is the primary agent — it handles
tool execution, file edits, complex reasoning, and final decisions.

You are called in two modes:

1. **Assistant mode** — Claude needs large-context analysis it can't efficiently do itself:
   summarise many files, trace a pattern across the codebase, answer questions that require
   holding the entire repo in memory at once.

2. **Second-opinion mode** — Claude asks you to evaluate a design decision before proposing
   it to the user.

**When giving a second opinion: be direct and specific. Flag concerns by name. Do not hedge
excessively. If something will break an invariant (see below), say so plainly.**

---

## Project overview

Quorum is a portable reasoning layer for agentic codebases. Three TypeScript modules:

| Module | What it does |
|---|---|
| **Oracle** | Query and write interface to Chronicle. No LLM required. |
| **Jury** | Evaluates a proposed design against Oracle evidence. Returns a confidence score + gaps. |
| **Council** | Adversarial validation via parallel advisors and reviewers. Returns a verdict. |

```
oracle.query()  →  jury.evaluate()  →  council.deliberate()  →  human gate  →  Executor
```

Source lives in `modules/`. Detailed API: `modules/README.md`.

---

## Chronicle

Chronicle lives at `.chronicle/` — the persistent institutional memory of the codebase.

All writes go through a human-gated path:
- `oracle.propose()` — stages a pending entry (AI agents may call this)
- `oracle.commit(proposalId)` — indexes it (human-triggered only, **never AI-triggered**)

---

## Invariants — never suggest breaking these

- `oracle.commit()` is **never** called without explicit human input.
- In `jury/evaluate.ts`, `council_brief` is always overridden from the numeric `confidence`
  value after parsing. The LLM is never trusted to compute it.
- Both `jury/evaluate.ts` and `council/chairman.ts` throw on schema validation failure.
  There are no fallbacks, defaults, or try/catch that swallows these errors.
- All dependencies (LLM provider, vector store, embedder) are injected — never hardcoded
  inside module logic. Do not suggest adding imports.
- `deliberate()` calls `oracle.propose()` at the end of every run — never `oracle.commit()`.

---

## Key file locations

| Path | What it contains |
|---|---|
| `modules/AGENTS.md` | File ownership map for Oracle, Jury, Council |
| `modules/CLAUDE.md` | Design decisions and what not to change |
| `modules/README.md` | Full API reference |
| `.chronicle/` | LanceDB vector store, pending proposals, query log |
