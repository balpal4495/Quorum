import type { JuryInput, JuryOutput, JuryDeps } from "./types.js"
import type { OracleResult } from "../shared/types.js"
import { entryText } from "../shared/types.js"
import { JuryOutputSchema } from "./schema.js"
import { runPreflight, formatPreflight } from "./preflight.js"

const CONFIDENCE_THRESHOLD = 0.6

function formatEvidence(evidence: OracleResult[]): string {
  if (evidence.length === 0) {
    return "No Oracle entries found. There is no prior evidence for this codebase on this topic."
  }
  return evidence
    .map(e =>
      [
        `[${e.id}] status=${e.status}  confidence=${e.confidence.toFixed(2)}  score=${e.score.toFixed(3)}`,
        `Insight: ${entryText(e)}`,
        `Areas: ${e.affected_areas.join(", ")}${e.scope ? " | " + e.scope.join(", ") : ""}`,
        e.outcome ? `Outcome: ${e.outcome}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n")
}

const SYSTEM_PROMPT = `You are the Jury — an evidence-based evaluator for agentic development workflows.

Your job is to evaluate a proposed design against Oracle evidence and produce a calibrated confidence score.
You do NOT make decisions. You assess and score. Your output determines the Council's brief.

Score the design across four dimensions, each 0–1:
1. evidence_support  — do validated Oracle entries confirm this approach works in this codebase?
2. feasibility       — do Oracle entries (or their absence) suggest this is achievable?
3. risk              — how well does the design address known failure modes? (1 = fully addressed, 0 = ignored)
4. completeness      — does the design cover the full outcome, or only part of it?

confidence = average of the four scores (you must compute this yourself — do not round or adjust it).

Gaps fall into two categories:
- gaps: any missing evidence that would improve confidence
- blocking_gaps: a SUBSET of gaps that are hard blockers — must be resolved before proceeding
  (examples: no rollback plan for a destructive change, no auth strategy for a security-sensitive feature)

council_brief is determined by confidence only (do not invent a value):
  confidence < 0.6  → council_brief = "challenge"
  confidence ≥ 0.6  → council_brief = "pressure-test"

Return ONLY valid JSON that matches this schema exactly — no markdown fences, no explanation:
{
  "confidence": <number 0–1>,
  "confidence_breakdown": {
    "evidence_support": <number 0–1>,
    "feasibility": <number 0–1>,
    "risk": <number 0–1>,
    "completeness": <number 0–1>
  },
  "assessment": <string — what the evidence supports or contradicts>,
  "gaps": [<string — each missing piece of evidence>],
  "blocking_gaps": [<string — gaps that are hard blockers only>],
  "council_brief": "challenge" | "pressure-test",
  "recommendation": "proceed" | "investigate-more" | "redesign"
}`

/**
 * Evaluate a proposed design against Oracle evidence.
 *
 * Scores across four dimensions (evidence support, feasibility, risk, completeness)
 * and returns a structured JuryOutput. The council_brief is always derived from the
 * confidence score — the LLM value is overridden to ensure deterministic routing.
 *
 * Throws if the LLM returns non-JSON or a response that fails schema validation.
 * Never silently defaults to a passing score.
 */
export async function evaluate(
  input: JuryInput,
  deps: JuryDeps,
): Promise<JuryOutput> {
  const { llm, model } = deps
  const evidenceText = formatEvidence(input.evidence)
  const preflight = runPreflight(input.outcome, input.design, input.evidence)
  const preflightText = formatPreflight(preflight)

  const userPrompt = [
    "## Outcome",
    input.outcome,
    "",
    "## Proposed Design",
    input.design,
    "",
    preflightText,
    "",
    "## Oracle Evidence",
    evidenceText,
  ].join("\n")

  const raw = await llm(
    [
      { role: "system", content: SYSTEM_PROMPT },
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
      `Jury: LLM returned non-JSON response. Raw (first 300 chars): ${raw.slice(0, 300)}`,
    )
  }

  const result = JuryOutputSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Jury: LLM output failed schema validation. Issues: ${JSON.stringify(result.error.issues)}`,
    )
  }

  const output = result.data

  // Recompute confidence as the exact average of breakdown dimensions
  // This makes confidence deterministic and calibrated regardless of what the LLM returned
  const { evidence_support, feasibility, risk, completeness } = output.confidence_breakdown
  output.confidence = Math.round(((evidence_support + feasibility + risk + completeness) / 4) * 100) / 100

  // Enforce council_brief from recomputed confidence — do not trust the LLM to compute this correctly
  output.council_brief =
    output.confidence < CONFIDENCE_THRESHOLD ? "challenge" : "pressure-test"

  return output
}
