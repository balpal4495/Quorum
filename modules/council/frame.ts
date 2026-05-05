import type { LLMProvider } from "../shared/types"
import type { CouncilInput } from "./types"

/**
 * Reframe the outcome + design into a clear deliberation brief for the advisor panel.
 * Tone and scope are set by the Jury's council_brief value.
 */
export async function frameQuestion(
  input: CouncilInput,
  llm: LLMProvider,
  model?: string,
): Promise<string> {
  const { outcome, design, jury_output } = input

  const briefInstruction =
    jury_output.council_brief === "challenge"
      ? `The Jury has LOW confidence (score: ${jury_output.confidence.toFixed(2)}). ` +
        "Find what is WRONG with this design. Look for fundamental flaws, not just edge cases."
      : `The Jury has HIGH confidence (score: ${jury_output.confidence.toFixed(2)}). ` +
        "PRESSURE-TEST this design. Assume it is broadly correct — try to break it. " +
        "Find edge cases, scaling failures, and hidden assumptions."

  const systemPrompt = [
    "You are the Council Framer. You write the deliberation brief that a panel of expert advisors will work from.",
    "",
    "Write a clear, precise brief that:",
    "1. States what needs to be achieved (the outcome)",
    "2. States what is being proposed (the design)",
    "3. States the Jury's assessment and the gaps it identified",
    "4. Sets the council directive — challenge or pressure-test",
    "",
    "Keep it under 300 words. Be direct. Advisors must know exactly what to evaluate.",
  ].join("\n")

  const userPrompt = [
    `Outcome: ${outcome}`,
    "",
    `Design: ${design}`,
    "",
    `Jury assessment: ${jury_output.assessment}`,
    `Jury confidence: ${jury_output.confidence.toFixed(2)}`,
    `Jury gaps: ${jury_output.gaps.join("; ") || "none identified"}`,
    "",
    briefInstruction,
  ].join("\n")

  return llm(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    model,
  )
}
