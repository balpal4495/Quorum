# Quorum — Claude Code Instructions

## Project overview

Quorum is a portable reasoning layer for agentic codebases. Three TypeScript modules form
the knowledge and validation layer for all agentic work:

```
oracle.query()  →  jury.evaluate()  →  council.deliberate()  →  human gate  →  Executor
```

Full module rules and design decisions: [modules/CLAUDE.md](modules/CLAUDE.md)
File ownership map: [modules/AGENTS.md](modules/AGENTS.md)

---

## Gemini CLI (optional assistant)

Before attempting any Gemini call, check availability:

```bash
which gemini 2>/dev/null
```

If the command returns empty, skip this section entirely. The project is fully functional
without Gemini. Never try to install it or ask the user to install it mid-task.

**If Gemini is available**, use it as a large-context assistant — it can hold the entire
codebase in a single context window where you work best on focused, precise tasks.

**Call `gemini -p "..."` when:**
- You need to survey many files at once before deciding where to look
- You want to trace a pattern, type, or call across the whole codebase
- You want a second opinion on an architecture decision before proposing it to the user

**Important:** The Bash tool does not auto-source shell profiles. Always prefix Gemini
calls with `source ~/.zshrc &&` so that `GEMINI_API_KEY` and `GEMINI_CLI_TRUST_WORKSPACE`
are loaded from the user's profile before invoking the CLI.

**Patterns:**

```bash
# Broad survey before narrowing
source ~/.zshrc && gemini -p "What are all the public exports across modules/ and what does each do?"

# Trace a pattern across many files
source ~/.zshrc && find . -name "*.ts" | xargs cat | gemini -p "Find every place oracle.commit() is called"

# Second opinion on a design
source ~/.zshrc && gemini -p "I'm about to add streaming to oracle/query.ts. Given the full codebase, what should I watch out for?"
```

**Processing Gemini responses:**
- You reason about Gemini's output — it assists, you decide
- If Gemini contradicts what you know from reading the code, trust your direct reading
- Never pass Gemini's response to the user unfiltered; synthesise it through your own judgment

---

## Chronicle — the persistent knowledge store

Chronicle lives at `.chronicle/`. Every prior decision, investigation finding, and outcome
is stored there.

- **Query Oracle before proposing any solution.** Treat entries as ground truth for what has
  been tried, what worked, and what failed.
- **Never call `oracle.commit()` autonomously.** Use `oracle.propose()` to stage an entry.
  A human must call `oracle.commit(proposalId)` to index it. There are no exceptions.

---

## Rules for AI agents

- **Evidence first.** Query Oracle before proposing any design or implementation.
- **No auto-commits.** Never call `oracle.commit()` without explicit human input.
- **Cite entries.** Use entry IDs (e.g. `[abc-123]`) when referencing Chronicle findings.
- **Respect refuted entries.** Surface the failure reason — don't ignore it.
- **Fail loudly.** Jury and Council throw on bad LLM output. Do not swallow errors.

---

## Build and test

```bash
npx vitest run modules/
```
