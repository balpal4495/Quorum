import type { OracleClient } from "../shared/types.js"
import type {
  CompassProposalInput, CompassProposalResult,
  CompassOutcomeInput, CompassOutcomeResultPayload,
  ProductPathway, ProductBet, ProductPathwayPhase,
} from "./types.js"

/**
 * Stage a Compass-generated artifact as a Chronicle proposal.
 *
 * Writes to .chronicle/proposals/ ONLY via oracle.propose().
 * Never calls oracle.commit(). Human must approve.
 */
export async function stageProposal(
  input: CompassProposalInput,
  oracle: OracleClient,
): Promise<CompassProposalResult> {
  const payload = input.payload as ProductPathway | ProductBet

  const decision = buildDecision(input)
  const key_insight = decision.slice(0, 200)

  const entry = {
    key_insight,
    decision,
    schema_version: 2 as const,
    topic: buildTopic(input),
    scope: buildScope(input),
    affected_areas: buildAffectedAreas(input),
    status: "open" as const,
    confidence: "confidence" in payload ? payload.confidence : 0.7,
    source_module: "compass",
    evidence_cited: [],
    alternatives_considered: "assumptions" in payload ? [] : [],
    rejected_reason: [],
    validation_plan: buildValidationPlan(input),
    review_after: reviewAfterDate(),
  }

  const result = await oracle.propose(entry)

  return {
    proposal_id: result.proposalId,
    message: `Staged Chronicle proposal ${result.proposalId.slice(0, 8)} — run 'quorum commit --list' to review.`,
  }
}

/**
 * Stage an outcome update for a prior product bet or pathway.
 * Creates a new proposal that supersedes the original entry.
 */
export async function stageOutcome(
  input: CompassOutcomeInput,
  oracle: OracleClient,
): Promise<CompassOutcomeResultPayload> {
  const resultLabel: Record<string, string> = {
    "validated": "has been validated",
    "partially-validated": "has been partially validated",
    "invalidated": "has been invalidated",
    "unclear": "outcome is unclear — insufficient signal",
    "superseded": "has been superseded by a newer approach",
  }

  const label = resultLabel[input.result] ?? input.result
  const decision = `Product bet/pathway ${input.entry_id.slice(0, 8)} ${label}.${input.note ? " " + input.note : ""}`

  const entry = {
    key_insight: decision.slice(0, 200),
    decision,
    schema_version: 2 as const,
    topic: `product/outcome/${input.entry_id.slice(0, 8)}`,
    scope: ["product", "compass", "outcome"],
    affected_areas: [],
    status: "validated" as const,
    confidence: input.result === "validated" ? 0.9
      : input.result === "partially-validated" ? 0.7
      : input.result === "invalidated" ? 0.6
      : 0.5,
    source_module: "compass",
    evidence_cited: [input.entry_id],
    alternatives_considered: [],
    rejected_reason: [],
    validation_plan: [],
    post_merge_result: (input.result === "validated" ? "successful"
      : input.result === "invalidated" ? "rolled-back"
      : input.result === "partially-validated" ? "partial"
      : undefined) as "successful" | "bug" | "partial" | "rolled-back" | undefined,
  }

  const result = await oracle.propose(entry)
  return {
    proposal_id: result.proposalId,
    message: `Staged outcome proposal ${result.proposalId.slice(0, 8)} — run 'quorum commit --list' to review.`,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildDecision(input: CompassProposalInput): string {
  const p = input.payload as ProductPathway | ProductBet
  if (input.artifact_kind === "product_pathway" && "smallest_useful_version" in p) {
    return `Compass identified '${(p as ProductPathway).title}' as a product pathway: ${(p as ProductPathway).smallest_useful_version}`
  }
  if (input.artifact_kind === "product_bet" && "thesis" in p) {
    return `Product bet: ${(p as ProductBet).thesis}`
  }
  if ("title" in p) {
    return `Compass ${input.artifact_kind.replace("_", " ")}: ${(p as { title: string }).title}`
  }
  return `Compass generated ${input.artifact_kind} artifact.`
}

function buildTopic(input: CompassProposalInput): string {
  const p = input.payload
  if ("title" in p) return `product/${input.artifact_kind.replace("product_", "")}/${slugify((p as { title: string }).title)}`
  return `product/${input.artifact_kind}`
}

function buildScope(input: CompassProposalInput): string[] {
  const base = ["product", "compass", input.artifact_kind.replace("product_", "")]
  const p = input.payload
  if ("goal" in p && (p as ProductPathway).goal) base.push(slugify((p as ProductPathway).goal).slice(0, 20))
  return base
}

function buildAffectedAreas(input: CompassProposalInput): string[] {
  const p = input.payload
  if ("phases" in p) {
    return (p as ProductPathway).phases
      .flatMap((ph: ProductPathwayPhase) => ph.dependencies)
      .filter(Boolean)
      .slice(0, 5)
  }
  return []
}

function buildValidationPlan(input: CompassProposalInput): string[] {
  const p = input.payload
  if ("validation_signals" in p) return (p as ProductBet).validation_signals.slice(0, 3)
  if ("suggested_next_step" in p) return [(p as ProductPathway).suggested_next_step]
  return []
}

function reviewAfterDate(): string {
  const d = new Date()
  d.setDate(d.getDate() + 45)
  return d.toISOString().slice(0, 10)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)
}
