import type { ProductScoreBreakdown } from "./types"

/**
 * Compute a directional product score from raw dimension values.
 *
 * Each dimension is 0–1. Penalty dimensions reduce the total.
 * Final score is clamped to 0–100.
 *
 * Interpretation:
 *   85–100  Very strong; build or spec next
 *   70–84   Strong; pursue a small test
 *   55–69   Plausible; investigate more
 *   40–54   Weak; defer unless strategic
 *   0–39    Avoid for now
 */
export function computeScore(dims: Omit<ProductScoreBreakdown, "total">): ProductScoreBreakdown {
  const raw =
    dims.strategic_fit         * 20 +
    dims.user_problem_clarity  * 15 +
    dims.evidence_strength     * 20 +
    dims.leverage              * 10 +
    dims.feasibility           * 15 +
    dims.time_to_signal        * 10 +
    dims.reversibility         * 10 -
    dims.complexity_penalty    * 10 -
    dims.dependency_penalty    *  8 -
    dims.contradiction_penalty * 15 -
    dims.evidence_gap_penalty  * 12

  const total = Math.max(0, Math.min(100, Math.round(raw)))
  return { ...dims, total }
}

export function scoreToRecommendation(
  total: number,
): "pursue" | "pursue-small-test" | "investigate-more" | "defer" | "avoid" {
  if (total >= 85) return "pursue"
  if (total >= 70) return "pursue-small-test"
  if (total >= 55) return "investigate-more"
  if (total >= 40) return "defer"
  return "avoid"
}

export function scoreToLabel(total: number): string {
  if (total >= 85) return "Very strong"
  if (total >= 70) return "Strong"
  if (total >= 55) return "Plausible"
  if (total >= 40) return "Weak"
  return "Avoid"
}

/**
 * Build a human-readable explanation for a score.
 */
export function explainScore(scores: ProductScoreBreakdown): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = []
  const weaknesses: string[] = []

  if (scores.strategic_fit >= 0.7) strengths.push("Strong strategic fit with current product direction")
  if (scores.evidence_strength >= 0.7) strengths.push("Well-supported by Chronicle or code evidence")
  if (scores.feasibility >= 0.7) strengths.push("Technically feasible given current architecture")
  if (scores.reversibility >= 0.7) strengths.push("Highly reversible — easy to change course")
  if (scores.leverage >= 0.7) strengths.push("High leverage — small build unlocks significant value")
  if (scores.time_to_signal >= 0.7) strengths.push("Fast time-to-signal — team learns quickly")
  if (scores.user_problem_clarity >= 0.7) strengths.push("Clear user problem and target")

  if (scores.evidence_strength < 0.4) weaknesses.push("Weak evidence — mostly inference or assumption")
  if (scores.evidence_gap_penalty > 0.5) weaknesses.push("Significant evidence gaps — needs more investigation")
  if (scores.contradiction_penalty > 0.3) weaknesses.push("May conflict with prior Chronicle decisions")
  if (scores.dependency_penalty > 0.4) weaknesses.push("High dependency burden — external services or platform work required")
  if (scores.complexity_penalty > 0.4) weaknesses.push("Adds significant complexity — UI, infrastructure, or support burden")
  if (scores.time_to_signal < 0.4) weaknesses.push("Long time-to-signal — hard to validate quickly")
  if (scores.strategic_fit < 0.4) weaknesses.push("Weak strategic fit with current product direction")
  if (scores.user_problem_clarity < 0.4) weaknesses.push("User problem or target not yet clearly defined")

  return { strengths, weaknesses }
}
