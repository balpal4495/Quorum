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
  timestamp: string
}

/**
 * A Chronicle entry enriched with its retrieval score.
 * Returned by Oracle.query().
 */
export type OracleResult = ChronicleEntry & { score: number }

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
  ) => Promise<{ proposalId: string }>
  /** Called after human approval. Indexes the proposal into Chronicle. */
  commit: (proposalId: string) => Promise<ChronicleEntry>
}
