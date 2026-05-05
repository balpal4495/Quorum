import type { OracleResult, QueryOptions } from "../shared/types"
import type { OracleDeps } from "./types"
import { bm25Score, extractDomainTerms } from "./bm25"
import { appendQueryLog } from "./log"

const DEFAULT_LIMIT = 10
const DEFAULT_SCORE_THRESHOLD = 0.031
const RRF_K = 60
/** Retrieve this many vector candidates before BM25 re-ranking. */
const CANDIDATE_MULTIPLIER = 3

/**
 * Reciprocal Rank Fusion score.
 * score = Σ 1 / (k + rank_i) summed across all rank lists.
 * k = 60 (standard constant).
 */
function rrfScore(ranks: number[]): number {
  return ranks.reduce((sum, rank) => sum + 1 / (RRF_K + rank), 0)
}

/**
 * Two-pass retrieval with Reciprocal Rank Fusion.
 *
 * Pass 1 — vector similarity:
 *   Embed the query, retrieve top (limit × CANDIDATE_MULTIPLIER) candidates.
 *
 * Pass 2 — BM25 re-ranking with query enrichment:
 *   Extract domain terms from Pass 1 key insights, enrich the query,
 *   score candidates with BM25, fuse ranks via RRF.
 *
 * Results below scoreThreshold are dropped entirely.
 * All queries are appended to .chronicle/query-log.jsonl.
 */
export async function query(
  text: string,
  options: QueryOptions = {},
  deps: OracleDeps,
): Promise<OracleResult[]> {
  const {
    statusFilter,
    limit = DEFAULT_LIMIT,
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
  } = options

  const startTime = Date.now()

  // ── Pass 1: vector similarity ──────────────────────────────────────────────
  const queryVector = await deps.embedder(text)
  const candidateLimit = limit * CANDIDATE_MULTIPLIER
  let candidates = await deps.vectorStore.search(queryVector, candidateLimit)

  // Status filter applied before BM25 to avoid scoring irrelevant entries
  if (statusFilter && statusFilter.length > 0) {
    candidates = candidates.filter(c => statusFilter.includes(c.entry.status))
  }

  if (candidates.length === 0) {
    await tryLogQuery(text, [], startTime, deps)
    return []
  }

  // ── Pass 2: BM25 re-ranking with query enrichment ─────────────────────────
  const topInsights = candidates
    .slice(0, Math.min(5, candidates.length))
    .map(c => c.entry.key_insight)
  const domainTerms = extractDomainTerms(topInsights)
  const enrichedQuery =
    domainTerms.length > 0 ? `${text} ${domainTerms.join(" ")}` : text

  const documents = candidates.map(c =>
    [c.entry.key_insight, ...c.entry.affected_areas].join(" "),
  )
  const bm25Scores = bm25Score(enrichedQuery, documents)

  // Build BM25 rank lookup (index → rank)
  const bm25RankOf: number[] = new Array(candidates.length)
  bm25Scores
    .map((score, i) => ({ i, score }))
    .sort((a, b) => b.score - a.score)
    .forEach(({ i }, rank) => {
      bm25RankOf[i] = rank
    })

  // ── RRF fusion ─────────────────────────────────────────────────────────────
  const fused: OracleResult[] = candidates.map((candidate, vectorRank) => ({
    ...candidate.entry,
    score: rrfScore([vectorRank, bm25RankOf[vectorRank]]),
  }))

  fused.sort((a, b) => b.score - a.score)

  const results = fused
    .filter(r => r.score >= scoreThreshold)
    .slice(0, limit)

  await tryLogQuery(text, results, startTime, deps)
  return results
}

async function tryLogQuery(
  text: string,
  results: OracleResult[],
  startTime: number,
  deps: OracleDeps,
): Promise<void> {
  try {
    await appendQueryLog(
      {
        query: text,
        results: results.map(r => ({ id: r.id, score: r.score, status: r.status })),
        resultCount: results.length,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      deps.chronicleDir ?? ".chronicle",
    )
  } catch {
    // Query logging is best-effort — never fail a query because of a log write failure
  }
}
