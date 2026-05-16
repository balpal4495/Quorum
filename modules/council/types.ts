import type { OracleResult, LLMProvider, OracleClient } from "../shared/types.js"
import type { JuryOutput } from "../jury/types.js"

export interface CouncilInput {
  /** What needs to be achieved. */
  outcome: string
  /** Proposed approach from the Designer. */
  design: string
  /** Same evidence pack the Jury received. */
  evidence: OracleResult[]
  /** Jury output — drives the council brief and confidence. */
  jury_output: JuryOutput
}

/** A finding that must be resolved before the design can proceed. */
export interface BlockerItem {
  issue: string
  /** Oracle entry IDs that evidence this blocker. */
  evidence: string[]
  /** What must change in the design to resolve this. */
  required_fix: string
}

/** A finding that should be addressed but does not block proceeding. */
export interface WarningItem {
  issue: string
  suggested_fix?: string
}

/** Validates that cited Oracle IDs actually appeared in the evidence pack. */
export interface CitationValidation {
  /** IDs that were cited and exist in the evidence pack. */
  valid_ids: string[]
  /** IDs that were cited but were NOT in the evidence pack — likely hallucinated. */
  hallucinated_ids: string[]
}

/** How advisors split on their recommendation. Signals disagreement level. */
export interface AdvisorSplit {
  proceed: number
  redesign: number
  "investigate-more": number
}

export interface CouncilOutput {
  satisfied: boolean
  /** Chairman synthesis — every material conclusion cites Oracle entry IDs. */
  verdict: string
  /**
   * Findings that MUST be resolved before the design proceeds.
   * Each blocker names the issue, the Oracle evidence behind it, and the required fix.
   */
  blockers: BlockerItem[]
  /**
   * Findings that SHOULD be addressed but don't block execution.
   */
  warnings: WarningItem[]
  /** Flat list of all issues raised — backwards compatible with existing consumers. */
  challenges: string[]
  /** Oracle entry IDs referenced in the verdict. */
  evidence_cited: string[]
  /** Validation of whether cited IDs exist in the evidence pack. */
  citation_validation: CitationValidation
  /** How advisors split on recommendation — high disagreement = escalate. */
  advisor_split: AdvisorSplit
  recommendation: "proceed" | "redesign" | "investigate-more"
}

export interface CouncilModels {
  /** Model for the framer step. */
  frame?: string
  /** Model for advisors. High volume — cheaper model appropriate here. */
  advisors?: string
  /** Model for reviewers. Critical analysis — stronger model recommended. */
  reviewers?: string
  /** Model for the chairman. Synthesis — best available model recommended. */
  chairman?: string
}

export interface CouncilDeps {
  llm: LLMProvider
  oracle: OracleClient
  /** Number of advisors to run in parallel. Default: 5. */
  advisorCount?: number
  /** Number of reviewers to run in parallel. Default: 5. */
  reviewerCount?: number
  models?: CouncilModels
}

// ── Risk classifier types ─────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical"

/**
 * Determines which Council mode to use.
 *   skip        → Oracle query only, no LLM validation
 *   jury-only   → Jury scores, Council skipped entirely (low-risk fast path)
 *   lite        → Jury + 1–2 reviewers (no full advisor fan-out)
 *   full        → Full Council (default 5 advisors + 5 reviewers + Chairman)
 */
export type CouncilMode = "skip" | "jury-only" | "lite" | "full"

export interface RiskAssessment {
  level: RiskLevel
  reasons: string[]
  council_mode: CouncilMode
}
