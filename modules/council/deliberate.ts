import type { CouncilInput, CouncilOutput, CouncilDeps } from "./types"
import { DEFAULT_PERSONAS } from "./personas"
import { frameQuestion } from "./frame"
import { fanOutAdvisors } from "./advisors"
import { fanOutReviewers } from "./reviewers"
import { chairman } from "./chairman"

const DEFAULT_ADVISOR_COUNT = 5
const DEFAULT_REVIEWER_COUNT = 5

/**
 * Run the Council deliberation pipeline.
 *
 * Pipeline:
 *   1. frameQuestion     — reframe outcome + design into a deliberation brief
 *   2. fanOutAdvisors    — N advisors reason in parallel from Oracle evidence
 *   3. fanOutReviewers   — N reviewers critique anonymised advisor responses in parallel
 *   4. chairman          — synthesises verdict, cites Oracle entry IDs
 *   5. oracle.propose()  — proposes verdict to Chronicle (human approval required to commit)
 *
 * The council_brief from jury_output determines framing tone:
 *   "challenge"      → find what is wrong (Jury confidence < 0.6)
 *   "pressure-test"  → try to break what looks solid (Jury confidence ≥ 0.6)
 *
 * Routing on output:
 *   satisfied: true                           → proceed to human gate → Executor
 *   satisfied: false, recommendation: redesign         → return to Designer
 *   satisfied: false, recommendation: investigate-more → return to Detective with gaps list
 */
export async function deliberate(
  input: CouncilInput,
  deps: CouncilDeps,
): Promise<CouncilOutput> {
  const {
    llm,
    oracle,
    advisorCount = DEFAULT_ADVISOR_COUNT,
    reviewerCount = DEFAULT_REVIEWER_COUNT,
    models = {},
  } = deps

  // Select personas — cycle DEFAULT_PERSONAS if advisorCount > 5
  const personas = Array.from(
    { length: advisorCount },
    (_, i) => DEFAULT_PERSONAS[i % DEFAULT_PERSONAS.length],
  )

  // 1. Frame the deliberation question
  const framedQuestion = await frameQuestion(input, llm, models.frame)

  // 2. Advisors reason in parallel
  const advisorResponses = await fanOutAdvisors(
    framedQuestion,
    input.evidence,
    personas,
    llm,
    models.advisors,
  )

  // 3. Reviewers critique in parallel (advisor responses anonymised inside fanOutReviewers)
  const reviewerResponses = await fanOutReviewers(
    advisorResponses,
    input.evidence,
    reviewerCount,
    llm,
    models.reviewers,
  )

  // 4. Chairman synthesises verdict
  const verdict = await chairman(
    advisorResponses,
    reviewerResponses,
    input.evidence,
    llm,
    models.chairman,
  )

  // 5. Propose verdict to Oracle — human must call oracle.commit() to index it
  // Truncate to 200 chars so it passes propose()'s schema validation.
  const firstSentence = verdict.verdict.split(/[.!?]/)[0]?.trim() ?? ""
  const keyInsight = (firstSentence.length >= 20 ? firstSentence : verdict.verdict)
    .slice(0, 200)

  await oracle.propose({
    key_insight: keyInsight,
    affected_areas: extractAffectedAreas(input.outcome, input.design),
    status: "open",
    confidence: input.jury_output.confidence,
    source_module: "council",
    evidence_cited: verdict.evidence_cited,
  })

  return verdict
}

/**
 * Extract candidate affected areas from the outcome and design text.
 * Looks for capitalised noun phrases as a simple heuristic.
 * The host application may override by post-processing CouncilOutput.
 */
function extractAffectedAreas(outcome: string, design: string): string[] {
  const text = `${outcome} ${design}`
  const phrases = text.match(/\b[A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*\b/g) ?? []
  const unique = [...new Set(phrases)]
  return unique.length > 0 ? unique.slice(0, 5) : ["general"]
}
