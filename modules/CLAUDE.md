# modules/ — Claude Instructions

Supplements the root-level instructions. Read this when working inside the `modules/` folder.

---

## What these modules are

Three portable TypeScript modules — Oracle, Jury, Council — that form the knowledge and reasoning layer of an agentic workflow. They are designed to be dropped into any Node.js codebase.

The entry point for a host application is `setup.ts`. Everything else is internal.

---

## Key design decisions to preserve

### Dependency injection throughout
No module imports a specific LLM provider, vector store, or embedder. All external dependencies are passed in as function arguments or via a deps object. If you add a new capability, follow this pattern — do not hardcode providers.

### council_brief is computed, not trusted
In `jury/evaluate.ts`, the `council_brief` field in the LLM response is **always overridden** based on the numeric `confidence` value after parsing. The LLM is not trusted to compute this correctly. Do not remove this override.

### Throw on bad LLM output — never default to passing
Both `jury/evaluate.ts` and `council/chairman.ts` throw if the LLM returns non-JSON or output that fails Zod validation. This is intentional. A silently passing Jury score is worse than an error. Do not add fallbacks or defaults.

### oracle.commit() is a human gate
`council/deliberate.ts` calls `oracle.propose()` at the end of every deliberation. It never calls `oracle.commit()`. If you see a code path that calls `oracle.commit()` without explicit human input, that is a bug.

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

---

## Safe to change

- `council/personas.ts` — add or adjust personas freely
- `models` defaults in `setup.ts` — adjust model names as providers evolve
- BM25 constants (`K1`, `B`) in `oracle/bm25.ts` — tunable, well-commented
- `CANDIDATE_MULTIPLIER` and `RRF_K` in `oracle/query.ts` — tunable retrieval parameters

## Do not change without strong reason

- The `VectorStore` interface in `oracle/types.ts` — changing it breaks all adapters
- The `ChronicleEntry` type in `shared/types.ts` — changing it breaks stored data
- The Zod schemas in `jury/schema.ts` and `council/chairman.ts` — these are the output contracts
- The `OracleClient` interface in `shared/types.ts` — Jury and Council depend on it
