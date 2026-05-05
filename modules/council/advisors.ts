import type { LLMProvider, OracleResult } from "../shared/types"
import type { AdvisorPersona } from "./personas"

export interface AdvisorResponse {
  persona: string
  response: string
}

function formatEvidence(evidence: OracleResult[]): string {
  if (evidence.length === 0) {
    return "No Oracle entries are available. Reason from absence of evidence — name what is missing."
  }
  return evidence
    .map(e =>
      `[${e.id}] (${e.status})\n${e.key_insight}\nAreas: ${e.affected_areas.join(", ")}`,
    )
    .join("\n\n")
}

/**
 * Run all advisors in parallel.
 * Each advisor receives the framed question, the Oracle evidence pack,
 * and their persona's system prompt fragment.
 *
 * Advisors MUST cite specific Oracle entry IDs — this is enforced in the prompt.
 */
export async function fanOutAdvisors(
  framedQuestion: string,
  evidence: OracleResult[],
  personas: readonly AdvisorPersona[],
  llm: LLMProvider,
  model?: string,
): Promise<AdvisorResponse[]> {
  const evidenceText = formatEvidence(evidence)

  return Promise.all(
    personas.map(async (persona): Promise<AdvisorResponse> => {
      const systemPrompt = [
        `You are a Council advisor — ${persona.name}.`,
        "",
        persona.systemFragment,
        "",
        "Rules:",
        "- Reason ONLY from the Oracle evidence provided. Do not use general knowledge.",
        "- Cite specific Oracle entry IDs (e.g. [abc-123]) for every claim you make.",
        "- If the evidence is insufficient to support a claim, say so explicitly.",
        "- Keep your response focused and under 400 words.",
      ].join("\n")

      const userPrompt = [
        framedQuestion,
        "",
        "## Oracle Evidence",
        evidenceText,
      ].join("\n")

      const response = await llm(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        model,
      )

      return { persona: persona.name, response }
    }),
  )
}
