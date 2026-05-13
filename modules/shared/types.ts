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
 *
 * Schema versions:
 *   v1 (no schema_version field): key_insight is the primary text field.
 *   v2 (schema_version: 2): decision is the primary text field; key_insight is a copy
 *       of decision written for backwards compatibility. Always use entryText() to read.
 */
export type ChronicleEntry = {
  id: string

  // ── v1 fields (required — always present) ───────────────────────────────
  /** The core finding or decision, in one clear sentence. v2: copy of decision. */
  key_insight: string
  /** File paths or system areas this entry applies to. Used by Sentinel for file matching. */
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

  // ── outcome tracking fields (optional — filled in post-execution) ────────────
  /** Steps that must pass to confirm this decision was correct. */
  validation_plan?: string[]
  /** ISO date after which this entry should be re-evaluated for drift. */
  review_after?: string
  /** What actually happened after the decision was acted on in production. */
  post_merge_result?: "successful" | "bug" | "partial" | "rolled-back"

  // ── v2 fields (optional — absent on legacy entries) ──────────────────────
  /** 2 = decision record format. Absent = v1 legacy entry. */
  schema_version?: 2
  /** Short label for this decision. e.g. "auth/session strategy" */
  topic?: string
  /** The decision itself — the primary text field in v2. Use entryText() to read. */
  decision?: string
  /** Domain/category tags. Additive — does NOT replace affected_areas. e.g. ["auth", "sessions"] */
  scope?: string[]
  /** Approaches that were considered but not chosen. */
  alternatives_considered?: string[]
  /** Why the alternatives were rejected. */
  rejected_reason?: string[]
  /** ID of the Chronicle entry this supersedes. */
  supersedes?: string | null
  /** ID of the Chronicle entry that superseded this one. */
  superseded_by?: string | null
}

/**
 * Return the primary text for a Chronicle entry regardless of schema version.
 * v2 entries use decision; v1 entries use key_insight.
 * All callsites that render or embed entry text must use this function.
 *
 * Accepts any object with key_insight and optional decision — works for both
 * full ChronicleEntry and Omit<ChronicleEntry, "id" | "timestamp"> from propose().
 */
export function entryText(entry: { key_insight: string; decision?: string }): string {
  return entry.decision ?? entry.key_insight
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

// ── Sentinel types ────────────────────────────────────────────────────────────

/** Per-file result from sentinel.coverage(). */
export type FileCoverage = {
  file: string
  covered: boolean
  /** IDs of Chronicle entries that reference this file in affected_areas. */
  entryIds: string[]
}

/** Returned by sentinel.coverage(). */
export type CoverageReport = {
  totalFiles: number
  coveredFiles: number
  uncoveredFiles: string[]
  coverageByFile: FileCoverage[]
  /** Integer 0–100. Treat as directional signal, not a precision metric. */
  percentage: number
}

/**
 * Advisory result for a single Chronicle entry from sentinel.detectDrift().
 * Never auto-updates an entry — human reviews the flag and decides.
 */
export type DriftFlag = {
  entryId: string
  keyInsight: string
  affectedFiles: string[]
  stillValid: boolean
  /** 0–1 confidence in the LLM's verdict. Low confidence = needs closer human review. */
  confidence: number
  reasoning: string
}

/** Returned by sentinel.detectDrift(). */
export type DriftReport = {
  checkedAt: string
  /** Entries the LLM judged as no longer accurate — review and consider updating status. */
  flags: DriftFlag[]
  /** Entries the LLM judged as still current. */
  confirmed: DriftFlag[]
  /** Entry IDs skipped because no affected_areas value resolved to a local file. */
  skipped: string[]
}

// ── Oracle client ─────────────────────────────────────────────────────────────

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
