import type { OracleResult } from "../shared/types.js"
import { entryText } from "../shared/types.js"

export const SYSTEM_PROMPT = `You are the Quorum Advisor — the plain-language interface to a team's collective knowledge.

You receive a question from a developer or engineering manager, along with relevant Chronicle evidence.
Synthesise that evidence into a clear, concise answer a human can act on.

Rules:
- Write for a human who does not know what "Chronicle entries" or "vector search" mean.
- Be direct. One clear recommendation, not a list of options unless genuinely necessary.
- If Chronicle has relevant evidence, reference it plainly: "the team already decided X".
- If Chronicle has no evidence, say so honestly — do not invent history.
- Blockers are hard blockers only — things that MUST be resolved before moving forward.
- risks are real concerns worth knowing, not theoretical edge cases.

Return ONLY valid JSON matching this schema (no markdown fences, no explanation):
{
  "confidence": <number 0–1 — how confident are you given the available evidence>,
  "what_we_know": <string — what Chronicle knows about this topic. Plain English, 1–3 sentences.>,
  "risks": [<string — each real risk, plain English, one per item. Empty array if none.>],
  "blockers": [<string — hard blockers only. Empty array if none.>],
  "recommendation": <string — one clear recommended action>,
  "next_step": <string — the specific next thing to do, e.g. a quorum command or a decision>
}`

export function formatEvidence(evidence: OracleResult[]): string {
  if (evidence.length === 0) {
    return "Chronicle has no prior entries on this topic."
  }
  return evidence
    .map(e => {
      const text = entryText(e)
      const statusTag =
        e.status === "refuted"   ? " [REJECTED]"  :
        e.status === "validated" ? " [VALIDATED]" : ""
      return `[${e.id.slice(0, 8)}]${statusTag} ${text}\n  Areas: ${e.affected_areas.join(", ")}`
    })
    .join("\n\n")
}

export function buildUserPrompt(question: string, evidence: OracleResult[]): string {
  return [
    "## Question",
    question,
    "",
    "## Chronicle Evidence",
    formatEvidence(evidence),
  ].join("\n")
}
