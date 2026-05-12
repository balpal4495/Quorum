# Oracle · Jury · Council · Sentinel

Four portable modules for the knowledge and reasoning layer of any agentic workflow.
Drop the `modules/` folder into your project and wire up the dependencies.

```
Oracle  →  Jury  →  Council  →  human gate  →  Executor
Sentinel  →  coverage + drift + PR coverage map
```

---

## Modules

| Module | Responsibility | LLM? |
|---|---|---|
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

```typescript
import { createOracleClient, xenovaEmbed, createLanceDBStore } from "./modules/oracle"
import { evaluate } from "./modules/jury"
import { deliberate } from "./modules/council"

// 1. Wire Oracle (no LLM required)
const oracle = createOracleClient({
  embedder: xenovaEmbed,
  vectorStore: await createLanceDBStore(".chronicle"),
})

// 2. Retrieve evidence for the task at hand
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

## LLM provider interface

The `LLMProvider` type is a simple function. Wire it to any provider:

```typescript
import type { LLMProvider } from "./modules/shared/types"

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

## Output routing

### Jury

| `recommendation` | Next step |
|---|---|
| `proceed` | Pass to Council |
| `investigate-more` | Return to Detective with `gaps` |
| `redesign` | Return to Designer |

### Council

| `satisfied` | `recommendation` | Next step |
|---|---|---|
| `true` | `proceed` | Human gate → Executor |
| `false` | `redesign` | Return to Designer with `verdict` |
| `false` | `investigate-more` | Return to Detective with `juryOutput.gaps` |

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
npx vitest run modules/
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
