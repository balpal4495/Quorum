import type { OracleResult, LLMProvider } from "../shared/types.js"

export interface JuryInput {
  /** What needs to be achieved. */
  outcome: string
  /** Proposed approach from the Designer. */
  design: string
  /** Evidence retrieved from Oracle. */
  evidence: OracleResult[]
}

/** Per-dimension breakdown of the 0–1 confidence score. */
export interface ConfidenceBreakdown {
  /** Do validated Oracle entries confirm this approach works here? */
  evidence_support: number
  /** Do Oracle entries suggest this is achievable in this codebase? */
  feasibility: number
  /** How well does the design address known failure modes? (1 = fully addressed) */
  risk: number
  /** Does the design cover the full outcome, or only part of it? */
  completeness: number
}

export interface JuryOutput {
  /** 0–1 confidence score. Average of the four breakdown dimensions. */
  confidence: number
  /** Per-dimension breakdown of the confidence score. */
  confidence_breakdown: ConfidenceBreakdown
  /** What the evidence supports or contradicts. */
  assessment: string
  /** Evidence missing from Oracle that would improve confidence. */
  gaps: string[]
  /**
   * Gaps that are hard blockers — must be resolved before Council should proceed.
   * Subset of gaps where the missing information is critical (auth, rollback, data safety).
   */
  blocking_gaps: string[]
  /**
   * Council brief derived from confidence:
   *   < 0.6  → "challenge"      (find what is wrong — broader scope)
   *   ≥ 0.6  → "pressure-test"  (assume correct, try to break it)
   */
  council_brief: "challenge" | "pressure-test"
  recommendation: "proceed" | "investigate-more" | "redesign"
}

export interface JuryDeps {
  llm: LLMProvider
  model?: string
}
