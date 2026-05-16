import type { LLMProvider, OracleClient } from "../shared/types.js"
import type { AdvisorOutput } from "../advisor/types.js"

// ── Evidence ──────────────────────────────────────────────────────────────────

export type CompassEvidenceKind =
  | "chronicle"
  | "advisor"
  | "sentinel"
  | "code"
  | "docs"
  | "tests"
  | "config"
  | "cli"
  | "package"
  | "issue"
  | "analytics"
  | "support"
  | "inference"
  | "assumption"
  | "unknown"

export interface CompassEvidenceRef {
  id: string
  kind: CompassEvidenceKind
  source: string
  path?: string
  line?: number
  entry_id?: string
  summary: string
  quote?: string
  confidence: number
}

// ── Source scanner interface ──────────────────────────────────────────────────

export interface ProductSourceFinding {
  id: string
  kind: CompassEvidenceKind
  source: string
  path?: string
  line?: number
  title: string
  summary: string
  raw?: string
  confidence: number
  tags: string[]
}

export interface ProductSourceScanInput {
  rootDir: string
  area?: string
  include?: string[]
  exclude?: string[]
}

export interface ProductSource {
  id: string
  kind: "docs" | "code" | "tests" | "config" | "cli" | "package" | "issue" | "analytics" | "support"
  scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]>
}

// ── Bearings ──────────────────────────────────────────────────────────────────

export interface ProductBearing {
  id: string
  title: string
  summary: string
  area?: string
  evidence: CompassEvidenceRef[]
  confidence: number
}

// ── Terrain / behaviour map ───────────────────────────────────────────────────

export type BehaviorBasis = "documented" | "implemented" | "tested" | "observed" | "inferred"

export interface ProductBehavior {
  id: string
  area: string
  name: string
  description: string
  current_behavior: string
  evidence: CompassEvidenceRef[]
  basis: BehaviorBasis[]
  confidence: number
  notes?: string[]
}

export interface ProductBehaviorGap {
  id: string
  area: string
  gap: string
  why_it_matters: string
  evidence: CompassEvidenceRef[]
  confidence: number
}

export interface ProductBehaviorContradiction {
  id: string
  area: string
  docs_claim: string
  implementation_claim: string
  evidence: CompassEvidenceRef[]
  severity: "low" | "medium" | "high"
}

export interface BehaviorMap {
  generated_at: string
  area?: string
  behaviors: ProductBehavior[]
  gaps: ProductBehaviorGap[]
  contradictions: ProductBehaviorContradiction[]
  confidence: number
}

export interface BehaviorMapInput {
  area?: string
  source?: string
}

export interface BehaviorQuestionInput {
  question: string
  area?: string
  deterministic?: boolean
}

export interface BehaviorAnswer {
  question: string
  what_exists: string[]
  what_appears_missing: string[]
  product_implication: string
  evidence: CompassEvidenceRef[]
  confidence: number
}

// ── Observations ──────────────────────────────────────────────────────────────

export interface ProductObservation {
  id: string
  kind: "product_observation"
  title: string
  observation: string
  area: string
  evidence: CompassEvidenceRef[]
  implications: string[]
  confidence: number
}

// ── Hypotheses ────────────────────────────────────────────────────────────────

export interface ProductHypothesis {
  id: string
  kind: "product_hypothesis"
  title: string
  hypothesis: string
  target_user?: string
  problem?: string
  assumptions: string[]
  validation_signals: string[]
  invalidation_signals: string[]
  evidence: CompassEvidenceRef[]
  confidence: number
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export interface ProductScoreBreakdown {
  strategic_fit: number
  user_problem_clarity: number
  evidence_strength: number
  leverage: number
  feasibility: number
  time_to_signal: number
  reversibility: number
  complexity_penalty: number
  dependency_penalty: number
  contradiction_penalty: number
  evidence_gap_penalty: number
  total: number
}

// ── Opportunities ─────────────────────────────────────────────────────────────

export interface ProductOpportunity {
  id: string
  title: string
  area: string
  why_it_matters: string
  evidence_strength: "strong" | "medium" | "weak" | "inferred"
  suggested_next_step: string
  evidence: CompassEvidenceRef[]
  confidence: number
}

export interface OpportunitiesInput {
  goal?: string
  area?: string
  limit?: number
}

// ── Pathways ──────────────────────────────────────────────────────────────────

export interface ProductPathwayPhase {
  name: string
  outcome: string
  user_value: string
  build_notes?: string[]
  dependencies: string[]
  risks: string[]
}

export interface ProductPathway {
  id: string
  kind: "product_pathway"
  title: string
  goal: string
  target_user?: string
  problem?: string
  current_behaviors: string[]
  opportunity: string
  why_now: string
  smallest_useful_version: string
  phases: ProductPathwayPhase[]
  dependencies: string[]
  risks: string[]
  assumptions: string[]
  open_questions: string[]
  evidence: CompassEvidenceRef[]
  scores: ProductScoreBreakdown
  confidence: number
  time_to_signal: string
  reversibility: "high" | "medium" | "low"
  suggested_next_step: string
}

export interface PathwaysInput {
  goal: string
  horizon?: string
  appetite?: "small" | "medium" | "large"
  area?: string
  limit?: number
}

// ── Bets ──────────────────────────────────────────────────────────────────────

export interface ProductBet {
  id: string
  kind: "product_bet"
  title: string
  thesis: string
  why_now: string
  target_user?: string
  upside: string
  downside: string
  assumptions: string[]
  validation_signals: string[]
  invalidation_signals: string[]
  kill_criteria: string[]
  first_experiment: string
  build_path: string[]
  evidence: CompassEvidenceRef[]
  scores: ProductScoreBreakdown
  confidence: number
  time_to_signal: string
  reversibility: "high" | "medium" | "low"
  appetite: "small" | "medium" | "large"
}

export interface BigBetsInput {
  horizon?: string
  goal?: string
  appetite?: "small" | "medium" | "large"
}

// ── Idea scoring ──────────────────────────────────────────────────────────────

export interface ProductIdeaScore {
  idea: string
  summary: string
  recommendation: "pursue" | "pursue-small-test" | "investigate-more" | "defer" | "avoid"
  scores: ProductScoreBreakdown
  evidence: CompassEvidenceRef[]
  supporting_reasons: string[]
  risks: string[]
  assumptions: string[]
  open_questions: string[]
  suggested_next_step: string
}

export interface ScoreIdeaInput {
  idea: string
  context?: string
}

// ── Product brief ─────────────────────────────────────────────────────────────

export interface ProductBrief {
  title: string
  problem: string
  target_user?: string
  current_behavior: string[]
  product_opportunity: string
  recommended_solution: string
  smallest_useful_version: string
  non_goals: string[]
  user_flow: string[]
  implementation_notes: string[]
  dependencies: string[]
  risks: string[]
  open_questions: string[]
  assumptions: string[]
  validation_signals: string[]
  invalidation_signals: string[]
  evidence: CompassEvidenceRef[]
  suggested_quorum_checks: string[]
}

export interface ProductBriefInput {
  title: string
  pathway_id?: string
  idea?: string
  context?: string
}

// ── Compass brief ─────────────────────────────────────────────────────────────

export interface CompassBrief {
  generated_at: string
  area?: string
  product_direction: string
  known_from_chronicle: string[]
  known_from_behavior: string[]
  inferred: string[]
  assumptions: string[]
  unknowns: string[]
  opportunities: ProductOpportunity[]
  missing_evidence: string[]
  recommended_next_step: string
  confidence: number
}

export interface CompassBriefInput {
  area?: string
}

// ── Proposals ─────────────────────────────────────────────────────────────────

export type CompassArtifactKind =
  | "product_observation"
  | "product_hypothesis"
  | "product_pathway"
  | "product_bet"
  | "product_idea_score"
  | "product_outcome"

export interface CompassProposalInput {
  artifact_kind: CompassArtifactKind
  artifact_id: string
  payload: ProductPathway | ProductBet | ProductObservation | ProductIdeaScore
}

export interface CompassProposalResult {
  proposal_id: string
  message: string
}

// ── Outcomes ──────────────────────────────────────────────────────────────────

export type CompassOutcomeResult =
  | "validated"
  | "partially-validated"
  | "invalidated"
  | "unclear"
  | "superseded"

export interface CompassOutcomeInput {
  entry_id: string
  result: CompassOutcomeResult
  note?: string
}

export interface CompassOutcomeResultPayload {
  proposal_id: string
  message: string
}

// ── Main Compass interface ────────────────────────────────────────────────────

export interface Compass {
  brief(input?: CompassBriefInput): Promise<CompassBrief>
  mapBehaviors(input?: BehaviorMapInput): Promise<BehaviorMap>
  behavior(input: BehaviorQuestionInput): Promise<BehaviorAnswer>
  opportunities(input?: OpportunitiesInput): Promise<ProductOpportunity[]>
  pathways(input: PathwaysInput): Promise<ProductPathway[]>
  bigBets(input: BigBetsInput): Promise<ProductBet[]>
  scoreIdea(input: ScoreIdeaInput): Promise<ProductIdeaScore>
  productBrief(input: ProductBriefInput): Promise<ProductBrief>
  propose(input: CompassProposalInput): Promise<CompassProposalResult>
  outcome(input: CompassOutcomeInput): Promise<CompassOutcomeResultPayload>
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface CreateCompassOptions {
  oracle: OracleClient
  advisor?: {
    ask: (question: string) => Promise<AdvisorOutput>
  }
  /**
   * Required for LLM-backed commands: brief (with synthesis), pathways,
   * bigBets, scoreIdea, productBrief, behavior (non-deterministic).
   * Not required for deterministic mapBehaviors.
   */
  llm?: LLMProvider
  rootDir?: string
  chronicleDir?: string
  sources?: ProductSource[]
  models?: {
    brief?: string
    pathways?: string
    bets?: string
    score?: string
  }
  /**
   * How aggressively to surface low-evidence recommendations.
   * "strict" penalises more. "exploratory" allows weaker evidence through.
   * Default: "balanced"
   */
  minimumEvidence?: "strict" | "balanced" | "exploratory"
}
