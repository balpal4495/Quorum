import type { OracleResult, LLMProvider, OracleClient } from "../shared/types"
import type { JuryOutput } from "../jury/types"

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

export interface CouncilOutput {
  satisfied: boolean
  /** Chairman synthesis — every material conclusion cites Oracle entry IDs. */
  verdict: string
  /** What was challenged or could not be validated. */
  challenges: string[]
  /** Oracle entry IDs referenced in the verdict. */
  evidence_cited: string[]
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
