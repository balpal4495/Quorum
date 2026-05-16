# modules/ — Claude Instructions

Supplements the root-level instructions. Read this when working inside the `modules/` folder.

---

## What these modules are

Five portable TypeScript modules — Advisor, Oracle, Jury, Council, Sentinel — that form the knowledge and reasoning layer of an agentic workflow. They are designed to be dropped into any Node.js codebase.

The entry point for a host application is `setup.ts`. Everything else is internal.

---

## Key design decisions to preserve

### Dependency injection throughout
No module imports a specific LLM provider, vector store, or embedder. All external dependencies are passed in as function arguments or via a deps object. If you add a new capability, follow this pattern — do not hardcode providers.

### Confidence is recomputed from the breakdown — never trusted from the LLM
In `jury/evaluate.ts`, after parsing the LLM response, `confidence` is recomputed as the exact average of the four `confidence_breakdown` dimensions. The LLM's stated `confidence` value is discarded. `council_brief` is then derived from this recomputed value. Do not remove either override.

### Throw on bad LLM output — never default to passing
`jury/evaluate.ts`, `council/chairman.ts`, and `advisor/ask.ts` all throw if the LLM returns non-JSON or output that fails schema validation. This is intentional. A silently passing score is worse than an error. Do not add fallbacks or defaults.

### Advisor is a read-only path
`advisor/ask.ts` queries Oracle and calls the LLM — it never calls `oracle.propose()` or `oracle.commit()`. It has no side effects on Chronicle. Do not add write calls to the Advisor path.

### Advisor validation loop
`advisor/ask.ts` retries the LLM call up to `MAX_RETRIES` (2) times when the answer does not meet the satisfaction threshold (confidence ≥ 0.7, no blockers). The previous answer is included as context in the retry prompt. After the retry budget is exhausted, the best answer is returned regardless. Do not increase `MAX_RETRIES` without considering LLM cost implications.

### oracle.commit() is a human gate
`council/deliberate.ts` calls `oracle.propose()` at the end of every deliberation. It never calls `oracle.commit()`. If you see a code path that calls `oracle.commit()` without explicit human input, that is a bug.

### Oracle proposals use only validated citation IDs
`deliberate.ts` passes `verdict.citation_validation.valid_ids` as `evidence_cited` when calling `oracle.propose()` — not the raw `evidence_cited` array from the Chairman. Hallucinated IDs (cited but not in the evidence pack) are stripped before the proposal is written.

### Preflight runs before every Jury LLM call — do not remove it
`jury/evaluate.ts` calls `runPreflight()` before building the user prompt. The preflight result is injected as the `## Deterministic Preflight` section. This gives the LLM hard facts to reason over rather than discovering them itself. Do not move this call after the LLM invocation.

### Risk classifier determines fan-out counts — do not hardcode them
`deliberate.ts` reads `risk.council_mode` from `classifyRisk()` to set advisor and reviewer counts. Do not hardcode `advisorCount` or `reviewerCount` defaults inside `deliberate.ts` — the risk classifier owns these defaults.

### Query logging is best-effort
`oracle/log.ts` writes to a JSONL file. The `query()` function wraps this in a try/catch that swallows errors silently. This is correct behaviour — a log write failure must never fail a query.

---

## When modifying oracle/query.ts

The retrieval pipeline has two passes:
1. **Vector search** — embed query, retrieve `limit × 3` candidates from the vector store
2. **BM25 re-ranking** — score candidates, enrich query with domain terms from Pass 1, fuse ranks via RRF

RRF constant is `k=60`. Score threshold default is `0.031`. Results below the threshold are dropped entirely — not returned as low-confidence results. If you change the threshold, update the default in `query.ts` and the `QueryOptions` type comment in `shared/types.ts`.

---

## When modifying council/deliberate.ts

The pipeline order is fixed: `frameQuestion → fanOutAdvisors → fanOutReviewers → chairman → oracle.propose()`. Advisors and reviewers each run in parallel internally via `Promise.all`. Do not make the advisor and reviewer phases sequential — that defeats the independence of the panel.

Anonymisation of advisor responses happens inside `fanOutReviewers()` before any reviewer sees them. It must stay there.

The risk classifier runs at the start of `deliberate()` before any LLM calls. It sets advisor/reviewer counts and is logged in the Chronicle proposal's `scope` field. Do not move it.

---

## When modifying jury/preflight.ts

`SENSITIVE_PATTERNS` and the risk rules in `council/risk.ts` are separate but related. Preflight detects patterns for the Jury prompt; the risk classifier uses its own pattern set to determine Council mode. They are intentionally independent — changing one does not update the other. Keep them in sync when adding new sensitive area categories.

The eval suite in `evals/cases/` has `preflight_expects` and `risk_level` assertions. When changing patterns, run `npx vitest run evals/` to verify existing cases still pass.

---

## Safe to change

- `council/personas.ts` — add or adjust personas freely
- `jury/preflight.ts` `SENSITIVE_PATTERNS` — extend with new categories; run evals after
- `council/risk.ts` `RISK_RULES` — add new risk patterns; run evals after
- `models` defaults in `setup.ts` — adjust model names as providers evolve
- BM25 constants (`K1`, `B`) in `oracle/bm25.ts` — tunable, well-commented
- `CANDIDATE_MULTIPLIER` and `RRF_K` in `oracle/query.ts` — tunable retrieval parameters
- `evals/cases/` — add new eval cases freely; they run in CI automatically

## Do not change without strong reason

- The `VectorStore` interface in `oracle/types.ts` — changing it breaks all adapters
- The `ChronicleEntry` type in `shared/types.ts` — changing it breaks stored data
- The Zod schemas in `jury/schema.ts` and `council/chairman.ts` — these are the output contracts
- The `OracleClient` interface in `shared/types.ts` — Jury and Council depend on it
- The confidence recomputation in `jury/evaluate.ts` — it makes confidence calibrated and deterministic
