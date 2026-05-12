import type { ChronicleEntry, OracleResult, QueryOptions } from "../shared/types"
import { entryText } from "../shared/types"
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
    .map(c => entryText(c.entry))
  const domainTerms = extractDomainTerms(topInsights)
  const enrichedQuery =
    domainTerms.length > 0 ? `${text} ${domainTerms.join(" ")}` : text

  const documents = candidates.map(c =>
    [entryText(c.entry), ...c.entry.affected_areas, ...(c.entry.scope ?? [])].join(" "),
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
  const fused: Array<ChronicleEntry & { score: number }> = candidates.map(
    (candidate, vectorRank) => ({
      ...candidate.entry,
      score: rrfScore([vectorRank, bm25RankOf[vectorRank]]),
    }),
  )

  fused.sort((a, b) => b.score - a.score)

  const filtered = fused
    .filter(r => r.score >= scoreThreshold)
    .slice(0, limit)

  const results = assignTiers(filtered)

  await tryLogQuery(text, results, startTime, deps)
  return results
}

/**
 * Assign relevance tiers within the result set using relative rank.
 * Top ~30% → primary, next ~40% → supporting, remainder → background.
 * Thresholds are relative so they self-calibrate as Chronicle grows.
 */
function assignTiers(
  results: Array<ChronicleEntry & { score: number }>,
): OracleResult[] {
  const n = results.length
  if (n === 0) return []
  const primaryCount = Math.max(1, Math.ceil(n * 0.3))
  const supportingCount = Math.max(1, Math.ceil(n * 0.4))
  return results.map((r, i) => ({
    ...r,
    tier:
      i < primaryCount ? "primary"
      : i < primaryCount + supportingCount ? "supporting"
      : "background",
  }))
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
