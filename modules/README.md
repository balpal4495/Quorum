# Advisor · Oracle · Jury · Council · Sentinel

Five portable modules for the knowledge and reasoning layer of any agentic workflow.

```
Advisor  →  plain-language questions answered from Chronicle
Oracle   →  Jury  →  Council  →  human gate  →  Executor
Sentinel →  coverage + drift + PR coverage map
```

---

## Modules

| Module | Responsibility | LLM? |
|---|---|---|
| **Advisor** | Ask a plain-language question — synthesises Chronicle evidence into a concise answer with an internal validation loop | Yes |
| **Oracle** | Query and write interface to Chronicle (the persistent knowledge store) | No |
| **Jury** | Evaluate a design against Oracle evidence — produces a confidence score | Yes |
| **Council** | Adversarial validation via parallel advisor/reviewer fan-out — produces a verdict | Yes |
| **Sentinel** | Chronicle coverage reporting, drift detection, and PR coverage maps | Optional |

---

## Chronicle

Chronicle is the data that underpins the system. It is not a module — it lives at `.chronicle/` in your project root.

```
.chronicle/
  committed/      ← approved entries as JSON (committed to git, source of truth)
  proposals/      ← staged entries awaiting human approval (JSON, not indexed yet)
  SUMMARY.md      ← auto-generated agent context, rebuilt on every commit
```

Every entry goes through `oracle.propose()` → human approval → `oracle.commit()`. There are no auto-commits.

### Chronicle entry schema (v2)

```typescript
type ChronicleEntry = {
  // Always present (v1 + v2)
  id: string
  key_insight: string        // v1: primary text; v2: copy of decision for compat
  affected_areas: string[]   // file paths — used by Sentinel for coverage matching
  status: "validated" | "refuted" | "open"
  confidence: number         // 0–1
  source_module: string
  evidence_cited: string[]
  timestamp: string

  // v2 fields (optional — absent on legacy entries)
  schema_version?: 2
  topic?: string                    // short label: "auth/session strategy"
  decision?: string                 // the decision — primary text in v2
  scope?: string[]                  // domain tags: ["auth", "sessions"] — additive
  alternatives_considered?: string[]
  rejected_reason?: string[]
  supersedes?: string | null        // ID of the entry this replaces
  superseded_by?: string | null     // ID of the entry that replaced this

  // Outcome tracking fields (optional — filled in post-execution)
  outcome?: string                  // what actually happened when acted on
  validation_plan?: string[]        // steps that confirm the decision was correct
  review_after?: string             // ISO date to re-evaluate for drift
  post_merge_result?: "successful" | "bug" | "partial" | "rolled-back"
}
```

Use `entryText(entry)` from `shared/types` whenever you need to read the primary text — it returns `entry.decision ?? entry.key_insight` and works across both schema versions.

New entries created by Council automatically include `decision`, `topic`, `alternatives_considered`, `rejected_reason`, and `scope` (from the risk classifier) from the deliberation output.

---

## Dependencies

**Required** (must be in your project):
```
zod
```

**Optional** — only needed if using the included default adapters:
```
vectordb              ← LanceDB adapter (oracle/adapters/lance-db.ts)
@xenova/transformers  ← local ONNX embedder (oracle/adapters/xenova-embedder.ts)
```

You can substitute any vector store and embedder by implementing the `VectorStore` and `embedder` interfaces.

---

## TypeScript runtime requirement

Quorum ships TypeScript source (`.ts` files). Programmatic imports require a
TS-aware runtime or bundler. Plain `node` will not work without a loader.

**Supported runtimes:**

```bash
# tsx (recommended — zero config)
npx tsx your-script.ts

# ts-node
npx ts-node --esm your-script.ts

# Bun
bun your-script.ts

# Vitest / Jest with ts transform — works out of the box in test files
```

**Bundlers:** esbuild, Vite, Rollup, webpack — all supported with standard TS config.

**Plain Node.js** (no TS runtime): use the CLI instead:

```bash
quorum advisor "question"
quorum check --outcome "..." --design "..."
```

The CLI is always available after `npm install -g @balpal4495/quorum` and requires no
TS loader. It is the recommended interface for most host-project use cases.

---

## TypeScript

Requires TypeScript 4.7+ and `zod` v3.

Recommended `tsconfig.json` settings:
```json
{
  "compilerOptions": {
    "strict": true,
    "moduleResolution": "node"
  }
}
```

---

## Quick start

### npm users

```typescript
import { setup } from "@balpal4495/quorum"

// The simplest entry point — wires all modules from one call
const { oracle, evaluate, deliberate, ask } = await setup({ llm: myLLMProvider })

// Ask a plain-language question (Advisor)
const answer = await ask("what did the team decide about authentication?")
// answer.what_we_know, .recommendation, .next_step, .risks, .blockers, .retries

// Or run the full evaluation pipeline for a proposed design:
const evidence = await oracle.query("authentication patterns in this codebase")
```

### Quorum repo contributors

Working directly inside the Quorum source tree? Import from the local path instead:

```typescript
import { setup } from "./modules/setup"

const { oracle, evaluate, deliberate, ask } = await setup({ llm: myLLMProvider })
```

### Manual wiring (without setup())

```typescript
import { createOracleClient, xenovaEmbed, createLanceDBStore } from "@balpal4495/quorum/oracle"
import { evaluate } from "@balpal4495/quorum/jury"
import { deliberate } from "@balpal4495/quorum/council"

// Wire Oracle manually
const oracle = createOracleClient({
  embedder: xenovaEmbed,
  vectorStore: await createLanceDBStore(".chronicle"),
})

// Retrieve evidence for the task at hand
const evidence = await oracle.query("authentication patterns in this codebase")

// 3. Jury evaluates the design against the evidence
const juryOutput = await evaluate(
  {
    outcome: "Add JWT authentication to the API",
    design: "RS256 tokens, 15-min expiry, refresh rotation in httpOnly cookies",
    evidence,
  },
  { llm: yourLLMProvider, model: "gpt-4o-mini" },
)

// 4. Council validates adversarially
const verdict = await deliberate(
  {
    outcome: "Add JWT authentication to the API",
    design: "RS256 tokens, 15-min expiry, refresh rotation in httpOnly cookies",
    evidence,
    jury_output: juryOutput,
  },
  {
    llm: yourLLMProvider,
    oracle,
    models: {
      frame:    "gpt-4o-mini",
      advisors: "gpt-4o-mini",
      reviewers: "gpt-4o",
      chairman: "gpt-4o",
    },
  },
)

// 5. Route on verdict
if (verdict.satisfied) {
  // → human gate → Executor
} else if (verdict.recommendation === "redesign") {
  // → return to Designer with verdict.verdict as feedback
} else {
  // → return to Detective with juryOutput.gaps
}

// 6. Human approves the proposed Chronicle entry
// The Council automatically called oracle.propose() — you just need to commit:
// await oracle.commit(proposalId)
```

---

## Advisor

The Advisor is the plain-language interface to Chronicle. Use it to answer questions rather than to evaluate designs. It is a **read-only** path — it never calls `oracle.propose()` or `oracle.commit()`.

```typescript
import { ask } from "@balpal4495/quorum/advisor"

const answer = await ask(
  { question: "What did the team decide about session handling?", evidence },
  { llm: myLLMProvider },
)
```

Or via `setup()`, which queries Oracle automatically:

```typescript
const { ask } = await setup({ llm: myLLMProvider })
const answer = await ask("What did the team decide about session handling?")
```

### Advisor output

```typescript
interface AdvisorOutput {
  question: string
  confidence: number        // 0–1 — how confident the answer is given the evidence
  what_we_know: string      // plain-language summary of relevant Chronicle knowledge
  risks: string[]           // real risks worth knowing
  blockers: string[]        // hard blockers — must be resolved before acting (often empty)
  recommendation: string    // one clear recommended action
  next_step: string         // specific next step or quorum command
  retries: number           // how many retry attempts were needed (0 = first try succeeded)
}
```

### Validation loop

Advisor validates its own answer before returning. If `confidence < 0.7` or `blockers.length > 0`, it retries the LLM call with the previous answer as context — up to 2 retries. After the retry budget is exhausted, the best answer is returned regardless. Throws on non-JSON or schema-invalid LLM output.

---

## LLM provider interface

The `LLMProvider` type is a simple function. Wire it to any provider:

```typescript
import type { LLMProvider } from "@balpal4495/quorum"

// OpenAI example
const openaiProvider: LLMProvider = async (messages, model = "gpt-4o") => {
  const res = await openai.chat.completions.create({ model, messages })
  return res.choices[0].message.content ?? ""
}

// Anthropic example
const anthropicProvider: LLMProvider = async (messages, model = "claude-3-5-sonnet-20241022") => {
  const system = messages.find(m => m.role === "system")?.content ?? ""
  const userMessages = messages.filter(m => m.role !== "system")
  const res = await anthropic.messages.create({ model, system, messages: userMessages, max_tokens: 2048 })
  return res.content[0].type === "text" ? res.content[0].text : ""
}
```

---

## Jury output

```typescript
interface JuryOutput {
  confidence: number              // exact average of the four breakdown scores
  confidence_breakdown: {
    evidence_support: number      // do validated entries confirm this approach?
    feasibility: number           // is this achievable given what Chronicle knows?
    risk: number                  // how well does the design address failure modes?
    completeness: number          // does it cover the full outcome?
  }
  assessment: string
  gaps: string[]                  // all missing evidence
  blocking_gaps: string[]         // subset of gaps that are hard blockers
  council_brief: "challenge" | "pressure-test"
  recommendation: "proceed" | "investigate-more" | "redesign"
}
```

`confidence` is always recomputed from the breakdown average — the LLM's stated value is discarded. `council_brief` is derived from `confidence` (< 0.6 → challenge, ≥ 0.6 → pressure-test).

### Preflight (no LLM)

Before the LLM runs, Jury executes a deterministic preflight:

```typescript
import { runPreflight } from "@balpal4495/quorum/jury"

const preflight = runPreflight(outcome, design, evidence)
// preflight.touches_sensitive_area
// preflight.sensitive_areas      — ["auth", "database", ...]
// preflight.rollback_mentioned
// preflight.test_strategy_mentioned
// preflight.chronicle_conflicts  — refuted entry IDs that overlap with the design
```

Results are injected into the Jury prompt as hard facts. Auth, database migrations, crypto, payments, PII, and secrets are the detected sensitive areas.

### Jury output routing

| `recommendation` | Next step |
|---|---|
| `proceed` | Pass to Council |
| `investigate-more` | Return to Detective with `blocking_gaps` |
| `redesign` | Return to Designer |

---

## Council output

```typescript
interface CouncilOutput {
  satisfied: boolean
  verdict: string
  blockers: Array<{              // must be resolved before proceeding
    issue: string
    evidence: string[]           // Oracle entry IDs that evidence this blocker
    required_fix: string
  }>
  warnings: Array<{              // should be addressed, does not block
    issue: string
    suggested_fix?: string
  }>
  challenges: string[]           // flat list of all issues — backwards compatible
  evidence_cited: string[]
  citation_validation: {
    valid_ids: string[]          // cited IDs that were in the evidence pack
    hallucinated_ids: string[]   // cited IDs that were NOT — hallucinated
  }
  advisor_split: {               // how advisors split on recommendation
    proceed: number
    redesign: number
    "investigate-more": number
  }
  recommendation: "proceed" | "redesign" | "investigate-more"
}
```

Only `citation_validation.valid_ids` are written to the Chronicle proposal — hallucinated IDs are stripped automatically.

### Risk classifier (no LLM)

Before running the panel, Council classifies risk and scales fan-out accordingly:

```typescript
import { classifyRisk } from "./modules/council"

const risk = classifyRisk(outcome, design, evidence)
// risk.level          — "low" | "medium" | "high" | "critical"
// risk.reasons        — ["authentication or authorisation logic", ...]
// risk.council_mode   — "jury-only" | "lite" | "full"
```

| Risk | Triggers | Council mode | Advisor + Reviewer |
|---|---|---|---|
| Low | Nothing sensitive detected | jury-only — skipped | 0 + 0 |
| Medium | Cache, queues, deployments, rate limiting | lite | 1 + 2 |
| High | DB migrations, permissions, PII, secrets | full | 5 + 5 |
| Critical | Auth, payments, crypto, data deletion | full + human flag | 5 + 5 |

Refuted entries in the evidence pack always elevate risk by at least one level. `jury-only` means Council is not called at all — Jury alone is sufficient for low-risk designs.

### Council output routing

| `satisfied` | `recommendation` | Next step |
|---|---|---|
| `true` | `proceed` | Human gate → Executor |
| `false` | `redesign` | Return to Designer with `blockers` |
| `false` | `investigate-more` | Return to Detective with `juryOutput.blocking_gaps` |

---

## Eval suite

`evals/` contains canonical test cases — known-bad proposals that should block and known-good ones that should pass. Deterministic assertions run on every CI pass:

```bash
npx vitest run evals/
```

Each case defines the proposal, expected risk level, expected preflight signals, and (optionally) expected Council recommendation for LLM-gated assertions. See `evals/cases/` for the full set and `evals/runner.ts` for the runner API.

---

## Sentinel

Sentinel is the health and visibility layer. It operates independently of the Oracle → Jury → Council pipeline and has no LLM dependency for its core functions.

### Coverage

Reports which source files have Chronicle entries and which are blind spots.

```typescript
import { coverage } from "./modules/sentinel"

const report = await coverage(".chronicle", "src", {
  excludeTestFiles: true, // default — __tests__/, *.test.ts, *.spec.ts are excluded
})
// report.percentage, report.uncoveredFiles, report.coverageByFile
```

### Drift detection

For each Chronicle entry, asks the LLM whether the `key_insight` still accurately describes the current code. Advisory only — never modifies entries.

```typescript
import { detectDrift } from "./modules/sentinel"

const report = await detectDrift(".chronicle", "src", llmProvider)
// report.flags (potentially stale), report.confirmed, report.skipped
```

### Vitest assertions

Drop into any Vitest suite to get coverage and drift as named tests.

```typescript
import { describe } from "vitest"
import { sentinelAssertions } from "./modules/sentinel"

const assertions = sentinelAssertions({
  chronicleDir: ".chronicle",
  codebasePath: "src",       // defaults to "." — scan from project root
  llm: myLLMProvider,        // omit to skip drift tests
  minCoveragePercent: 50,    // default 0 = advisory only, never fails CI
})

describe("sentinel", () => { assertions.forEach(a => a()) })
```

`minCoveragePercent: 0` (the default) means the coverage test is purely advisory — it logs gaps to the console but never fails the build. Raise it as the project matures.

### PR coverage map

`sentinel/review.ts` exports `reviewContext(changedFiles, chronicleDir, codebasePath)` — used by the `sentinel-pr.yml` GitHub Actions workflow to post a PR comment showing the full-project coverage table and a colour-coded Mermaid heatmap. Test files are excluded from the scan.

---

## Running tests

Tests use [Vitest](https://vitest.dev/). Add to your project's test config or run directly:

```bash
# Module unit tests
npx vitest run modules/

# Eval suite (deterministic assertions — no LLM required)
npx vitest run evals/

# Eval suite with LLM-gated assertions (jury confidence + council recommendation)
EVAL_LLM=1 OPENAI_API_KEY=sk-... npx vitest run evals/
```

---

## What these modules do NOT include

The following are application-specific and must be built in the host project:

- **Detective** — investigation and task intake
- **Designer** — solution proposal
- **Executor** — task execution (existing tools/agents)
- **Validator** — satisfaction evaluator on implementation
- **Human gate UI** — approval interface for Chronicle proposals
- **Workflow orchestration** — LangGraph, Inngest, or equivalent
