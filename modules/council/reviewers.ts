import type { LLMProvider, OracleResult } from "../shared/types.js"
import { entryText } from "../shared/types.js"
import type { AdvisorResponse } from "./advisors.js"

export interface ReviewerResponse {
  reviewerId: string
  review: string
}

/**
 * Shuffle advisor responses and label them A–Z.
 * Prevents reviewers deferring to confident responses by position or persona name.
 */
function anonymise(responses: AdvisorResponse[]): string {
  const shuffled = [...responses].sort(() => Math.random() - 0.5)
  return shuffled
    .map((r, i) => `## Advisor ${String.fromCharCode(65 + i)}\n${r.response}`)
    .join("\n\n---\n\n")
}

function formatEvidenceSummary(evidence: OracleResult[]): string {
  if (evidence.length === 0) return "No Oracle evidence available."
  return evidence
    .map(e => `[${e.id}] (${e.status}) ${entryText(e)}`)
    .join("\n")
}

const REVIEWER_SYSTEM_PROMPT = [
  "You are a Council reviewer. You evaluate the quality of advisor responses.",
  "",
  "You are NOT deciding whether the design is correct.",
  "You are assessing the reasoning quality of each advisor response:",
  "",
  "1. Does the advisor actually use the Oracle evidence, or reason from general knowledge?",
  "2. Are Oracle entry IDs cited? Do those citations match the evidence provided?",
  "3. Is the response internally consistent?",
  "4. Which responses provide the strongest evidence-backed reasoning?",
  "5. Which responses make unsupported claims?",
  "",
  "Be critical. Evidence quality matters more than conclusion confidence.",
  "Keep your review under 400 words.",
].join("\n")

/**
 * Run all reviewers in parallel.
 * Each reviewer receives the anonymised advisor responses and the original evidence pack.
 * Anonymisation prevents position bias and persona deference.
 */
export async function fanOutReviewers(
  advisorResponses: AdvisorResponse[],
  evidence: OracleResult[],
  reviewerCount: number,
  llm: LLMProvider,
  model?: string,
): Promise<ReviewerResponse[]> {
  const anonymisedResponses = anonymise(advisorResponses)
  const evidenceSummary = formatEvidenceSummary(evidence)

  return Promise.all(
    Array.from({ length: reviewerCount }, async (_, i): Promise<ReviewerResponse> => {
      const userPrompt = [
        "## Advisor Responses (anonymised)",
        anonymisedResponses,
        "",
        "## Oracle Evidence (for cross-referencing citations)",
        evidenceSummary,
        "",
        "Review each advisor response for evidence quality.",
      ].join("\n")

      const review = await llm(
        [
          { role: "system", content: REVIEWER_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        model,
      )

      return { reviewerId: `reviewer-${i + 1}`, review }
    }),
  )
}
