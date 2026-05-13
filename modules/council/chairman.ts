import { z } from "zod"
import type { LLMProvider, OracleResult } from "../shared/types"
import { entryText } from "../shared/types"
import type { AdvisorResponse } from "./advisors"
import type { ReviewerResponse } from "./reviewers"
import type { CouncilOutput, CitationValidation } from "./types"

const BlockerSchema = z.object({
  issue: z.string().min(1),
  evidence: z.array(z.string()),
  required_fix: z.string().min(1),
})

const WarningSchema = z.object({
  issue: z.string().min(1),
  suggested_fix: z.string().optional(),
})

const AdvisorSplitSchema = z.object({
  proceed: z.number().int().min(0),
  redesign: z.number().int().min(0),
  "investigate-more": z.number().int().min(0),
})

const ChairmanOutputSchema = z.object({
  satisfied: z.boolean(),
  verdict: z.string().min(1),
  blockers: z.array(BlockerSchema),
  warnings: z.array(WarningSchema),
  evidence_cited: z.array(z.string()),
  advisor_split: AdvisorSplitSchema,
  recommendation: z.enum(["proceed", "redesign", "investigate-more"]),
})

function formatAdvisors(responses: AdvisorResponse[]): string {
  return responses
    .map(r => `## ${r.persona}\n${r.response}`)
    .join("\n\n---\n\n")
}

function formatReviewers(responses: ReviewerResponse[]): string {
  return responses
    .map(r => `## ${r.reviewerId}\n${r.review}`)
    .join("\n\n---\n\n")
}

function formatEvidence(evidence: OracleResult[]): string {
  if (evidence.length === 0) return "No Oracle evidence."
  return evidence
    .map(
      e =>
        `[${e.id}] (${e.status}, confidence: ${e.confidence.toFixed(2)}) ${entryText(e)}`,
    )
    .join("\n")
}

/**
 * Validate that every ID in evidence_cited actually appeared in the evidence pack.
 * Hallucinated IDs are cited but were never in the evidence sent to Council.
 */
function validateCitations(
  citedIds: string[],
  evidence: OracleResult[],
): CitationValidation {
  const evidenceIds = new Set(evidence.map(e => e.id))
  const valid_ids: string[] = []
  const hallucinated_ids: string[] = []

  for (const id of citedIds) {
    if (evidenceIds.has(id)) {
      valid_ids.push(id)
    } else {
      hallucinated_ids.push(id)
    }
  }

  return { valid_ids, hallucinated_ids }
}

const CHAIRMAN_SYSTEM_PROMPT = [
  "You are the Council Chairman. You synthesise the final verdict from all advisor and reviewer inputs.",
  "",
  "Your output must classify findings by severity:",
  "  blockers — issues that MUST be resolved before the design can proceed",
  "    (e.g. no rollback plan for a destructive migration, repeated a documented failure mode)",
  "  warnings — issues that SHOULD be addressed but do not block execution",
  "    (e.g. no test coverage for an edge case, a preferred pattern not followed)",
  "",
  "For each blocker, cite the Oracle entry IDs that evidence it and state the required fix precisely.",
  "For each warning, a suggested_fix is optional but preferred.",
  "",
  "advisor_split: count how many advisors recommended each option from their responses.",
  "  High split (no clear majority) is a signal of genuine uncertainty — reflect this in your verdict.",
  "",
  "satisfied = true  → no blockers, design can proceed to the human gate",
  "satisfied = false → at least one blocker exists, or the design needs rework",
  "",
  "evidence_cited: list every Oracle entry ID that materially influenced the verdict.",
  "  Only cite IDs that appeared in the Oracle Evidence section below.",
  "  Do not cite IDs from memory or general knowledge.",
  "",
  "Return ONLY valid JSON — no markdown fences, no explanation:",
  JSON.stringify({
    satisfied: "<boolean>",
    verdict: "<string ≤400 words — clear synthesis citing entry IDs>",
    blockers: [{ issue: "<string>", evidence: ["<Oracle entry ID>"], required_fix: "<string>" }],
    warnings: [{ issue: "<string>", suggested_fix: "<string — optional>" }],
    evidence_cited: ["<Oracle entry ID — only IDs present in the evidence pack>"],
    advisor_split: { proceed: "<int>", redesign: "<int>", "investigate-more": "<int>" },
    recommendation: "proceed | redesign | investigate-more",
  }),
].join("\n")

/**
 * Chairman synthesises the verdict from all advisor and reviewer inputs.
 * Classifies findings into blockers and warnings, validates citations,
 * and tracks advisor split to surface genuine disagreement.
 *
 * Throws if the LLM returns non-JSON or output fails schema validation.
 */
export async function chairman(
  advisorResponses: AdvisorResponse[],
  reviewerResponses: ReviewerResponse[],
  evidence: OracleResult[],
  llm: LLMProvider,
  model?: string,
): Promise<CouncilOutput> {
  const userPrompt = [
    "## Advisor Responses",
    formatAdvisors(advisorResponses),
    "",
    "## Reviewer Critiques",
    formatReviewers(reviewerResponses),
    "",
    "## Oracle Evidence",
    formatEvidence(evidence),
  ].join("\n")

  const raw = await llm(
    [
      { role: "system", content: CHAIRMAN_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    model,
  )

  let parsed: unknown
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(
      `Council chairman: LLM returned non-JSON. Raw (first 300 chars): ${raw.slice(0, 300)}`,
    )
  }

  const result = ChairmanOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Council chairman: output failed schema validation. Issues: ${JSON.stringify(result.error.issues)}`,
    )
  }

  const data = result.data

  // Validate citations — flag any IDs cited that weren't in the evidence pack
  const citation_validation = validateCitations(data.evidence_cited, evidence)

  // Derive flat challenges array for backwards compatibility
  const challenges = [
    ...data.blockers.map(b => `[BLOCKER] ${b.issue}`),
    ...data.warnings.map(w => w.issue),
  ]

  return {
    ...data,
    challenges,
    citation_validation,
  }
}
