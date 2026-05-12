import { z } from "zod"
import type { LLMProvider, OracleResult } from "../shared/types"
import { entryText } from "../shared/types"
import type { AdvisorResponse } from "./advisors"
import type { ReviewerResponse } from "./reviewers"
import type { CouncilOutput } from "./types"

const ChairmanOutputSchema = z.object({
  satisfied: z.boolean(),
  verdict: z.string().min(1),
  challenges: z.array(z.string()),
  evidence_cited: z.array(z.string()),
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

const CHAIRMAN_SYSTEM_PROMPT = [
  "You are the Council Chairman. You synthesise the final verdict from all advisor and reviewer inputs.",
  "",
  "Your verdict must:",
  "1. Be grounded in Oracle evidence — cite specific entry IDs for every material conclusion",
  "2. Summarise what was challenged and what held up under scrutiny",
  "3. State a clear recommendation",
  "4. List every Oracle entry ID that materially influenced the verdict in evidence_cited",
  "",
  "satisfied = true  → design holds up, can proceed to the human gate",
  "satisfied = false → fundamental flaw, unresolved gap, or design needs rework",
  "",
  "Return ONLY valid JSON — no markdown fences, no explanation:",
  JSON.stringify({
    satisfied: "<boolean>",
    verdict: "<string ≤400 words — clear synthesis>",
    challenges: ["<string — each challenge raised>"],
    evidence_cited: ["<Oracle entry ID>"],
    recommendation: "proceed | redesign | investigate-more",
  }),
].join("\n")

/**
 * Chairman synthesises the verdict from all advisor and reviewer inputs.
 * Every material conclusion must cite specific Oracle entry IDs.
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

  return result.data
}
