import type { OracleResult, LLMProvider } from "../shared/types"

export interface JuryInput {
  /** What needs to be achieved. */
  outcome: string
  /** Proposed approach from the Designer. */
  design: string
  /** Evidence retrieved from Oracle. */
  evidence: OracleResult[]
}

export interface JuryOutput {
  /** 0–1 confidence score. Drives the Council brief. */
  confidence: number
  /** What the evidence supports or contradicts. */
  assessment: string
  /** Evidence missing from Oracle that would improve confidence. */
  gaps: string[]
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
