# Quorum — Bootstrap Setup

You are reading this because Quorum is being set up in a codebase.

---

## Automated setup (preferred)

If you have Node.js 18+ available, run this from the project root:

```bash
npx @balpal4495/quorum@latest init
```

This handles all steps below automatically — copying modules, merging instruction files, updating `package.json`, `.gitignore`, and creating the Chronicle directory.

After it completes, run `npm install` and wire `setup()` into your entry point (see Step 6 below).

---

## Manual setup (AI-assisted fallback)

If the automated script is not available or fails, follow every step below in order.
Do not skip steps. Do not ask for confirmation between steps — complete the full sequence and then report what was done.

---

## Step 1 — Read before touching anything

Read these files in full before proceeding:

- `quorum/modules/README.md` — module overview and quick-start
- `quorum/modules/AGENTS.md` — file ownership and invariants
- `.github/copilot-instructions.md` — workflow rules for AI agents (installed at project root by init)

These are your operating instructions for everything that follows.

---

## Step 2 — Audit the host project

Check what already exists at the project root. Record what you find — you will need this in Step 4.

```
Does .github/copilot-instructions.md exist?        yes / no
Does AGENTS.md exist at the project root?           yes / no
Does CLAUDE.md exist at the project root?           yes / no
Does package.json exist?                            yes / no
Does .gitignore exist?                              yes / no
Does .chronicle/ exist?                             yes / no
```

---

## Step 3 — Install dependencies

Open `package.json` at the project root. Add the following to `dependencies` if they are not already present:

```json
"zod": "^3.23.0",
"vectordb": "^0.4.0",
"@xenova/transformers": "^2.17.0"
```

Then run:

```bash
npm install
```

If the project uses `yarn` or `pnpm`, use the appropriate installer instead.

> `zod` is required for all structured LLM output validation.
> `vectordb` is the LanceDB adapter (swappable — see `quorum/modules/oracle/adapters/`).
> `@xenova/transformers` is the local ONNX embedder (swappable — see `quorum/modules/oracle/adapters/xenova-embedder.ts`).

---

## Step 4 — Merge AI instruction files

### 4a. `.github/copilot-instructions.md`

The automated init command (`npx @balpal4495/quorum@latest init`) handles this step automatically — it creates or appends to `.github/copilot-instructions.md` at the project root.

**If you are completing this step manually:**

Check whether `.github/copilot-instructions.md` already exists.

**If it does not exist:** Fetch the Quorum copilot instructions from the Quorum GitHub repo (`balpal4495/Quorum`) at `.github/copilot-instructions.md` and write it to `.github/copilot-instructions.md` in the project root.

**If it already exists and does not contain `<!-- quorum -->`:** Append the Quorum instructions to the existing file, preceded by:

```markdown
---

<!-- quorum -->
```

Do not replace or overwrite existing content.

### 4b. `AGENTS.md`

**If it does not exist:**
Create `AGENTS.md` at the project root with this content:

```markdown
# Agent Instructions

See [quorum/modules/AGENTS.md](quorum/modules/AGENTS.md) for Quorum module internals.
See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.
```

**If it already exists:**
Append to it:

```markdown

## Quorum modules

See [quorum/modules/AGENTS.md](quorum/modules/AGENTS.md) for Advisor, Oracle, Jury, Council, and Sentinel internals.
```

### 4c. `CLAUDE.md`

**If it does not exist:**
Create `CLAUDE.md` at the project root with this content:

```markdown
# Claude Instructions

See [quorum/modules/CLAUDE.md](quorum/modules/CLAUDE.md) for Quorum module internals.
See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.
```

**If it already exists:**
Append to it:

```markdown

## Quorum modules

See [quorum/modules/CLAUDE.md](quorum/modules/CLAUDE.md) for Advisor, Oracle, Jury, Council, and Sentinel internals.
```

---

## Step 5 — Update .gitignore

**If `.gitignore` does not exist**, create it.

Add the following block if it is not already present:

```gitignore
# Quorum — Chronicle
# entries/ is a LanceDB binary vector store — do not commit
.chronicle/entries/

# proposals/ contains pending human-approval writes — commit these
# (remove the line above if you want to ignore the whole store)
```

---

## Step 6 — Wire setup() into the project

Find the application entry point (e.g. `index.ts`, `server.ts`, `app.ts`, or equivalent).

Add the following import and call at startup, **before** any agent or workflow code runs:

```typescript
import { setup } from "./quorum/modules/setup"

const { oracle, evaluate, deliberate, ask } = await setup({
  llm: yourLLMProvider, // replace with your project's LLM provider function
})
```

`setup()` creates `.chronicle/` directories, warms the embedder, and wires all module dependencies.
It must be called once before any `oracle.query()`, `evaluate()`, `deliberate()`, or `ask()` call.

`ask(question)` is the plain-language interface — it queries Oracle automatically, synthesises Chronicle evidence into a concise answer, and retries internally until the answer meets a confidence threshold. Use it to answer questions rather than to evaluate designs.

If no entry point exists yet, note that `setup()` must be called before first use — do not inline it.

**Approving Chronicle proposals:** after an agent calls `oracle.propose()`, approve and index the entry from the terminal:

```bash
quorum commit --list         # see pending proposals
quorum commit <id>           # approve and index a proposal
quorum commit <id> --dry-run # preview without writing
```

Requires `@xenova/transformers` and `vectordb` (both added in Step 3).

---

## Step 7 — Verify Chronicle is created

Run the project (or call `setup()` in isolation). Confirm that `.chronicle/proposals/` exists after startup.

```bash
ls .chronicle/
# expected: proposals/
# entries/ will appear after the first oracle.commit()
```

If the directory is not created, re-check that `setup()` is being awaited correctly.

---

## Step 8 — Run module tests

Confirm the modules are working in this environment:

```bash
# Module unit tests
npx vitest run quorum/modules/

# Eval suite — deterministic assertions, no LLM required
npx vitest run quorum/evals/
```

All tests should pass. If they fail due to missing dependencies, re-run Step 3.

The eval suite runs canonical test cases (known-bad proposals that should block, known-good ones that should pass) through the deterministic preflight and risk classifier. These pass without any LLM. If you later want to test Jury confidence and Council recommendations against a real LLM, set `EVAL_LLM=1` when running.

---

## Step 9 — Report what was done

Once all steps are complete, report:

1. Which files were created vs appended
2. Which dependencies were added (if any were already present, note that)
3. Whether tests passed
4. The path to `setup()` in the entry point, and the LLM provider that was wired (or a note if it was left as a placeholder)
5. Any step that could not be completed and why

---

## Optional: Step 10 — Gemini CLI integration

Skip this step if you do not have Google Gemini CLI installed. Quorum is fully functional without it.

If you do have it (or want to add it later), this enables Claude Code to delegate large-context
analysis to Gemini — useful when a task requires surveying the whole codebase at once.

**10a. Install Gemini CLI** (if not already installed — requires Node.js 18+):

```bash
npm install -g @google/gemini-cli
```

**10b. Get an API key** from Google AI Studio and add to your shell profile:

```bash
export GEMINI_API_KEY="your-key-here"
export GEMINI_CLI_TRUST_WORKSPACE=true
```

**10c. Create `GEMINI.md`** at the project root so Gemini understands the codebase.
Copy `quorum/modules/AGENTS.md` content as a starting point, or write a brief description of
the project and the Quorum architecture. The `GEMINI.md` in the Quorum repo itself is a
working example.

Once the key is set and `gemini -p "hello"` responds, Claude Code will automatically detect
Gemini and use it for large-context tasks.

---

## After setup

You are now operating under Quorum. The rules in `quorum/modules/AGENTS.md` and `.github/copilot-instructions.md` apply to all subsequent work.

Key reminders:
- **Ask Advisor for context.** `quorum advisor "what has the team decided about X?"` before starting any meaningful work.
- **Query Oracle before proposing anything.** `oracle.query("what you're about to do")` first.
- **Never call `oracle.commit()` autonomously.** Only `oracle.propose()`. A human commits.
- **Chronicle entries are ground truth.** Respect `refuted` entries — do not retry what has already failed.

### CLI quick reference

These commands are available globally after `npm install -g @balpal4495/quorum`:

| Command | What it does |
|---|---|
| `quorum advisor "question"` | Ask a plain-language question — answer synthesised from Chronicle (needs LLM) |
| `quorum advisor query "topic"` | Search Chronicle entries by keyword (no LLM) |
| `quorum advisor brief` | High-level Chronicle summary (no LLM) |
| `quorum status` | Chronicle health — pending proposals, committed entries |
| `quorum check --outcome X --design Y` | Preflight + risk classifier (no LLM) |
| `quorum commit --list` | List pending proposals |
| `quorum commit <id>` | Approve and index a proposal |
| `quorum sentinel coverage [--path <dir>]` | Chronicle coverage of source files |
| `quorum growth` | Chronicle learning health — growth rate, last commit, pending proposals |
| `quorum evolve` | Consolidate Chronicle — merges duplicates, resolves contradictions, promotes open entries |

`quorum check` exit codes: `0` = low/medium risk · `1` = high · `2` = critical

`quorum advisor ask` and `quorum evolve` auto-detect any available LLM: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_BASE_URL`, Ollama at localhost:11434, or an authenticated `gemini` CLI. When running inside an AI agent (Claude Code, Copilot, Codex, Gemini) with no separate key, they output Chronicle evidence and a synthesis request for the agent to answer inline.
