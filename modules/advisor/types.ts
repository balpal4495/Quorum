import type { OracleResult, LLMProvider } from "../shared/types"

export interface AdvisorInput {
  question: string
  evidence: OracleResult[]
}

export interface AdvisorAnswer {
  confidence: number
  what_we_know: string
  risks: string[]
  blockers: string[]
  recommendation: string
  next_step: string
}

export interface AdvisorOutput extends AdvisorAnswer {
  question: string
  /** Number of retries taken before the answer met the satisfaction threshold. */
  retries: number
}

export interface AdvisorDeps {
  llm: LLMProvider
  model?: string
}
