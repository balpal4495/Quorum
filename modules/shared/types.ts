/**
 * Shared types used across Oracle, Jury, and Council modules.
 * These are the only types that cross module boundaries.
 */

export type Message = {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * Injectable LLM provider. Accepts a message array and optional model override.
 * Returns the assistant response as a string.
 *
 * The modules never hardcode a provider — wire this at the application level.
 */
export type LLMProvider = (messages: Message[], model?: string) => Promise<string>

/**
 * Links a Chronicle entry to the unit of work that triggered it.
 * Gives agents the "why now" context that key_insight alone cannot convey.
 */
export type WorkRef = {
  type: "bug" | "story" | "epic" | "pr" | "spike"
  /** Ticket number, PR reference, or branch name. e.g. "PROJ-123", "PR #4" */
  ref?: string
}

/**
 * A durable knowledge record stored in Chronicle.
 * This is the canonical unit of institutional memory.
 */
export type ChronicleEntry = {
  id: string
  /** The core finding or decision, in one clear sentence. */
  key_insight: string
  /** Parts of the codebase or system this entry applies to. */
  affected_areas: string[]
  status: "validated" | "refuted" | "open"
  /** 0–1. How strongly this was confirmed at write time. */
  confidence: number
  /** Which module produced this entry (detective, council, executor, etc.). */
  source_module: string
  /** IDs of Chronicle entries this decision was based on. */
  evidence_cited: string[]
  /** What actually happened when this was acted on. Added post-execution by Scribe. */
  outcome?: string
  /** The unit of work that triggered this entry. Used to build SUMMARY.md temporal context. */
  work_ref?: WorkRef
  timestamp: string
}

/**
 * A Chronicle entry enriched with its retrieval score and relevance tier.
 * Returned by Oracle.query().
 *
 * Tiers indicate relevance within the result set:
 *   primary    — top ~30%: directly answers the query, should be foregrounded
 *   supporting — middle ~40%: contextually relevant, useful but not central
 *   background — bottom ~30%: loosely related, de-emphasise but do not hide
 */
export type OracleResult = ChronicleEntry & {
  score: number
  tier: "primary" | "supporting" | "background"
}

/**
 * Returned by oracle.propose() when a high-similarity entry already exists.
 * The human gate should surface this before approving the commit.
 */
export type SimilarityWarning = {
  entry: ChronicleEntry
  score: number
  /** potential-duplicate: near-identical insight. potential-supersession: likely a correction. */
  warning: "potential-duplicate" | "potential-supersession"
}

export type QueryOptions = {
  statusFilter?: Array<"validated" | "refuted" | "open">
  /** Maximum results to return. Default: 10. */
  limit?: number
  /**
   * Minimum RRF score to include a result.
   * Results below this threshold are dropped entirely — better to return nothing than noise.
   * Default: 0.031.
   */
  scoreThreshold?: number
}

/**
 * The public interface any module uses to interact with Chronicle.
 * Inject this into Jury and Council — do not couple them to Oracle internals.
 */
export interface OracleClient {
  query: (text: string, options?: QueryOptions) => Promise<OracleResult[]>
  propose: (
    entry: Omit<ChronicleEntry, "id" | "timestamp">,
  ) => Promise<{ proposalId: string; similarity?: SimilarityWarning }>
  /** Called after human approval. Indexes the proposal into Chronicle. */
  commit: (proposalId: string) => Promise<ChronicleEntry>
}
