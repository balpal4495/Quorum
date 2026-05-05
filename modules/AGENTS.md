# modules/ — Agent Instructions

Supplements the root `AGENTS.md` / `copilot-instructions.md` with module-specific internals.
When working inside this folder, follow these rules in addition to the root guidelines.

---

## File ownership

### Oracle
| File | Owns |
|---|---|
| `oracle/query.ts` | Two-pass retrieval (vector → BM25 → RRF fusion). Score threshold. Query log. |
| `oracle/bm25.ts` | BM25 scoring algorithm. Domain term extraction for query enrichment. |
| `oracle/propose.ts` | `propose()` + `commit()`. The human-gated write path. Do not add auto-commit logic here. |
| `oracle/log.ts` | Best-effort JSONL query log writer. Must never throw to callers. |
| `oracle/adapters/lance-db.ts` | LanceDB `VectorStore` implementation. Swappable — do not couple oracle internals to this. |
| `oracle/adapters/xenova-embedder.ts` | Local ONNX embedder. Swappable — do not couple oracle internals to this. |

### Jury
| File | Owns |
|---|---|
| `jury/schema.ts` | Zod schema for structured LLM output. Source of truth for `JuryOutput` shape. |
| `jury/evaluate.ts` | Four-dimension evaluation. **`council_brief` is always overridden from confidence here — do not remove this enforcement.** |

### Council
| File | Owns |
|---|---|
| `council/personas.ts` | Default advisor personas. Safe to extend. Do not remove existing personas without good reason. |
| `council/frame.ts` | Sets deliberation tone from `council_brief`. Challenge vs pressure-test framing lives here. |
| `council/advisors.ts` | Parallel advisor fan-out. Advisors must cite Oracle entry IDs — enforced in the prompt. |
| `council/reviewers.ts` | Anonymisation of advisor responses + parallel reviewer fan-out. Anonymisation must happen before reviewers see responses. |
| `council/chairman.ts` | Verdict synthesis + Zod validation. Throws on bad output — do not add fallbacks. |
| `council/deliberate.ts` | Full pipeline orchestration. Calls `oracle.propose()` at the end — never `oracle.commit()`. |

---

## Extension points

**Swap the vector store** — implement `VectorStore` from `oracle/types.ts` and pass it to `createOracleClient()` or `setup()`.

**Swap the embedder** — pass `embedder: yourFn` to `setup()`. Must return a consistent-dimension float array.

**Add advisor personas** — extend `DEFAULT_PERSONAS` in `council/personas.ts`, or pass a custom personas array directly to `fanOutAdvisors()`.

**Use different models per step** — pass `models` to `setup()` or `council.deliberate()` deps. Cheaper models for advisors, stronger for chairman is the intended pattern.

---

## Invariants — do not break these

- `oracle.commit()` is never called without explicit human input. `deliberate()` calls `propose()` only.
- `jury/evaluate.ts` always computes `council_brief` from `confidence` after parsing — never trusts the LLM value.
- `chairman.ts` and `jury/evaluate.ts` throw on schema validation failure. Do not add try/catch that swallows these errors.
- Query logging in `oracle/log.ts` is always best-effort — callers must not fail because of a log write error.
- `VectorStore` and `embedder` are always injected — never imported directly inside Oracle logic.

---

## Tests

```bash
npx vitest run modules/
```

Tests live in `__tests__/` inside each module folder. Use `vi.fn()` for LLM providers and vector stores — never call a real LLM in tests.
