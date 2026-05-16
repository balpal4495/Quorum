import { z } from "zod"
import type { AdvisorInput, AdvisorOutput, AdvisorAnswer, AdvisorDeps } from "./types"
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt"

const SATISFACTION_THRESHOLD = 0.7
const MAX_RETRIES = 2

const AdvisorAnswerSchema = z.object({
  confidence:     z.number().min(0).max(1),
  what_we_know:   z.string().min(1),
  risks:          z.array(z.string()),
  blockers:       z.array(z.string()),
  recommendation: z.string().min(1),
  next_step:      z.string().min(1),
})

async function callLLM(
  input: AdvisorInput,
  deps: AdvisorDeps,
  attempt: number,
  previous: AdvisorAnswer | null,
): Promise<AdvisorAnswer> {
  const { llm, model } = deps

  let userPrompt = buildUserPrompt(input.question, input.evidence)

  if (attempt > 0 && previous) {
    userPrompt += [
      "",
      `## Previous Answer (attempt ${attempt} — did not meet quality threshold)`,
      `Confidence: ${previous.confidence.toFixed(2)} (need ≥ ${SATISFACTION_THRESHOLD})`,
      previous.blockers.length > 0
        ? `Unresolved blockers: ${previous.blockers.join("; ")}`
        : "",
      "Please produce a more specific and concrete answer.",
    ].filter(Boolean).join("\n")
  }

  const raw = await llm(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userPrompt },
    ],
    model,
  )

  let parsed: unknown
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Advisor: LLM returned non-JSON. Raw (first 300 chars): ${raw.slice(0, 300)}`)
  }

  const result = AdvisorAnswerSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Advisor: LLM output failed validation. Issues: ${JSON.stringify(result.error.issues)}`)
  }

  return result.data
}

/**
 * Ask the Advisor a plain-language question.
 *
 * Internally calls the LLM and validates the answer against a satisfaction
 * threshold (confidence ≥ 0.7, no blockers). Retries up to MAX_RETRIES times
 * with the previous answer included as context. Returns the best answer found
 * within the retry budget regardless of whether the threshold was met.
 *
 * Throws if the LLM returns non-JSON or output that fails schema validation.
 */
export async function ask(input: AdvisorInput, deps: AdvisorDeps): Promise<AdvisorOutput> {
  let last: AdvisorAnswer | null = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const answer = await callLLM(input, deps, attempt, last)
    last = answer

    const satisfied = answer.confidence >= SATISFACTION_THRESHOLD && answer.blockers.length === 0
    if (satisfied || attempt === MAX_RETRIES) {
      return { ...answer, question: input.question, retries: attempt }
    }
  }

  return { ...last!, question: input.question, retries: MAX_RETRIES }
}
