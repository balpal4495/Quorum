# Quorum — Bootstrap Setup

You are reading this because Quorum is being set up in a codebase.

---

## Automated setup (preferred)

If you have Node.js 18+ available, run this from the project root:

```bash
npx @balpal4495/quorum@latest init
```

This handles all steps below automatically — writing Quorum docs, merging instruction files,
updating `package.json`, `.gitignore`, and creating the Chronicle directory.

After it completes, run `npm install`. The CLI is immediately usable:

```bash
quorum advisor brief
quorum advisor "what has the team decided about X?"
quorum check --outcome '...' --design '...'
```

---

## Manual setup (AI-assisted fallback)

If the automated script is not available or fails, follow every step below in order.
Do not skip steps. Do not ask for confirmation between steps — complete the full sequence and then report what was done.

---

## Step 1 — Read before touching anything

Read these files in full before proceeding:

- `quorum/AGENTS.md` — module file ownership and invariants
- `quorum/CLAUDE.md` — design decisions and constraints
- `.github/copilot-instructions.md` — workflow rules for AI agents

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

## Step 3 — Install Quorum

Open `package.json` at the project root. Add to `devDependencies` if not already present:

```json
"@balpal4495/quorum": "^2.0.0"
```

Then run:

```bash
npm install
```

If the project uses `yarn` or `pnpm`, use the appropriate installer instead.

---

## Step 4 — Merge AI instruction files

### 4a. `.github/copilot-instructions.md`

The automated init command handles this step automatically.

**If completing manually:** fetch `.github/copilot-instructions.md` from the Quorum GitHub repo (`balpal4495/Quorum`) and write it to `.github/copilot-instructions.md` in the project root. If the file already exists and does not contain `<!-- quorum:start -->`, append:

```markdown
---

<!-- quorum:start -->
<content from Quorum repo>
<!-- quorum:end -->
```

### 4b. `AGENTS.md`

**If it does not exist:**

```markdown
# Agent Instructions

<!-- quorum:start -->
## Quorum

See [quorum/AGENTS.md](quorum/AGENTS.md) for module file ownership and internals.
See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.
<!-- quorum:end -->
```

**If it already exists:** append the `<!-- quorum:start --> ... <!-- quorum:end -->` block above.

### 4c. `CLAUDE.md`

**If it does not exist:**

```markdown
# Claude Instructions

<!-- quorum:start -->
## Quorum

See [quorum/CLAUDE.md](quorum/CLAUDE.md) for design decisions and invariants.
See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.
<!-- quorum:end -->
```

**If it already exists:** append the `<!-- quorum:start --> ... <!-- quorum:end -->` block above.

---

## Step 5 — Update .gitignore

**If `.gitignore` does not exist**, create it.

Add the following block if not already present:

```gitignore
# Quorum — Chronicle
# entries/ is a LanceDB binary vector store — do not commit
.chronicle/entries/
.chronicle/query-log.jsonl
```

---

## Step 6 — Wire setup() into the project (programmatic use only)

Skip this step if you are using only the CLI (`quorum advisor`, `quorum check`, etc.).

For programmatic use, create a `quorum/client.ts` singleton in the project:

```typescript
import { setup } from "@balpal4495/quorum"

// Replace with your project's LLM provider function
import { llm } from "./llm"

let _quorum: ReturnType<typeof setup> | null = null

export function getQuorum() {
  if (!_quorum) _quorum = setup({ llm })
  return _quorum
}
```

Then use it in design scripts:

```typescript
const { oracle, evaluate, deliberate } = await getQuorum()
const evidence = await oracle.query("topic of the work")
// proceed with evaluate() → deliberate() → oracle.propose()
```

> **Once `quorum/client.ts` exists**, agents should query Chronicle via `oracle.query()` in
> TypeScript scripts — not via `npx quorum` CLI commands. The CLI pre-flight in AGENTS.md /
> CLAUDE.md should be treated as the fallback for projects that have no TypeScript client.

`setup()` creates `.chronicle/` directories, warms the embedder, and wires all module dependencies.
Must be called once before any `oracle.query()`, `evaluate()`, `deliberate()`, or `ask()` call.

`ask(question)` is the plain-language interface — it queries Oracle automatically, synthesises Chronicle evidence into a concise answer, and retries internally until the answer meets a confidence threshold.

**Approving Chronicle proposals:**

```bash
quorum commit --list         # see pending proposals
quorum commit <id>           # approve and index a proposal
quorum commit <id> --dry-run # preview without writing
```

---

## Step 7 — Verify Chronicle is created

Confirm `.chronicle/proposals/` and `.chronicle/committed/` exist:

```bash
ls .chronicle/
# expected: committed/  proposals/
```

---

## Step 8 — Verify the CLI works

```bash
quorum advisor brief
quorum growth
```

Both commands run without any LLM. If they fail, check that `npm install` completed successfully.

To run Quorum's eval suite (optional — tests Quorum's own correctness):

```bash
npx vitest run node_modules/@balpal4495/quorum/evals/
```

---

## Step 9 — Report what was done

Once all steps are complete, report:

1. Which files were created vs appended
2. Whether `npm install` succeeded
3. The path to `setup()` in the entry point if wired (or note if CLI-only)
4. Any step that could not be completed and why

---

## Optional: Step 10 — Gemini CLI integration

Skip this step if you do not have Google Gemini CLI installed. Quorum is fully functional without it.

**10a. Install Gemini CLI** (if not already installed):

```bash
npm install -g @google/gemini-cli
```

**10b. Get an API key** from Google AI Studio and add to your shell profile:

```bash
export GEMINI_API_KEY="your-key-here"
export GEMINI_CLI_TRUST_WORKSPACE=true
```

**10c. Create `GEMINI.md`** at the project root. Use `quorum/AGENTS.md` content as a starting point, or write a brief description of the project and the Quorum architecture.

Once the key is set and `gemini -p "hello"` responds, Claude Code will automatically detect Gemini and use it for large-context tasks.

---

## After setup

You are now operating under Quorum. The rules in `quorum/AGENTS.md` and `.github/copilot-instructions.md` apply to all subsequent work.

Key reminders:
- **Ask Advisor for context.** `quorum advisor "what has the team decided about X?"` before starting any meaningful work.
- **Never call `oracle.commit()` autonomously.** Only `oracle.propose()`. A human commits.
- **Chronicle entries are ground truth.** Respect `refuted` entries — do not retry what has already failed.

### CLI quick reference

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

`quorum advisor ask` and `quorum evolve` auto-detect any available LLM: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENAI_BASE_URL`, Ollama at localhost:11434, or an authenticated `gemini` CLI. When running inside an AI agent with no separate key, they output Chronicle evidence and a synthesis request for the agent to answer inline.
