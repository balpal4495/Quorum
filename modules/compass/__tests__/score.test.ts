import { describe, it, expect } from "vitest"
import { computeScore, scoreToRecommendation, scoreToLabel, explainScore } from "../score"
import type { ProductScoreBreakdown } from "../types"

function dims(overrides: Partial<Omit<ProductScoreBreakdown, "total">> = {}) {
  return {
    strategic_fit: 0.8,
    user_problem_clarity: 0.8,
    evidence_strength: 0.8,
    leverage: 0.7,
    feasibility: 0.8,
    time_to_signal: 0.8,
    reversibility: 0.9,
    complexity_penalty: 0.1,
    dependency_penalty: 0.1,
    contradiction_penalty: 0.0,
    evidence_gap_penalty: 0.1,
    ...overrides,
  }
}

describe("computeScore", () => {
  it("produces a score with total field", () => {
    const s = computeScore(dims())
    expect(s).toHaveProperty("total")
    expect(typeof s.total).toBe("number")
  })

  it("clamps score to 0–100", () => {
    const low = computeScore(dims({
      strategic_fit: 0, user_problem_clarity: 0, evidence_strength: 0,
      leverage: 0, feasibility: 0, time_to_signal: 0, reversibility: 0,
      complexity_penalty: 1, dependency_penalty: 1, contradiction_penalty: 1, evidence_gap_penalty: 1,
    }))
    expect(low.total).toBeGreaterThanOrEqual(0)

    const high = computeScore(dims({
      strategic_fit: 1, user_problem_clarity: 1, evidence_strength: 1,
      leverage: 1, feasibility: 1, time_to_signal: 1, reversibility: 1,
      complexity_penalty: 0, dependency_penalty: 0, contradiction_penalty: 0, evidence_gap_penalty: 0,
    }))
    expect(high.total).toBeLessThanOrEqual(100)
  })

  it("high evidence scores high", () => {
    const strong = computeScore(dims({ evidence_strength: 1.0, evidence_gap_penalty: 0 }))
    const weak   = computeScore(dims({ evidence_strength: 0.1, evidence_gap_penalty: 0.8 }))
    expect(strong.total).toBeGreaterThan(weak.total)
  })

  it("Chronicle contradiction penalty reduces score", () => {
    const base    = computeScore(dims({ contradiction_penalty: 0 }))
    const conflict = computeScore(dims({ contradiction_penalty: 1 }))
    expect(base.total).toBeGreaterThan(conflict.total)
  })

  it("passes through all original dimension values", () => {
    const input = dims()
    const out = computeScore(input)
    expect(out.strategic_fit).toBe(input.strategic_fit)
    expect(out.feasibility).toBe(input.feasibility)
  })
})

describe("scoreToRecommendation", () => {
  const cases: [number, string][] = [
    [90, "pursue"],
    [75, "pursue-small-test"],
    [60, "investigate-more"],
    [45, "defer"],
    [20, "avoid"],
  ]
  it.each(cases)("score %i → %s", (score, rec) => {
    expect(scoreToRecommendation(score)).toBe(rec)
  })
})

describe("scoreToLabel", () => {
  it("returns human-readable label", () => {
    expect(scoreToLabel(90)).toContain("strong")
    expect(scoreToLabel(30)).toContain("Avoid")
  })
})

describe("explainScore", () => {
  it("returns strengths and weaknesses arrays", () => {
    const { strengths, weaknesses } = explainScore(computeScore(dims()))
    expect(Array.isArray(strengths)).toBe(true)
    expect(Array.isArray(weaknesses)).toBe(true)
  })

  it("low evidence produces a weakness", () => {
    const { weaknesses } = explainScore(computeScore(dims({ evidence_strength: 0.1, evidence_gap_penalty: 0.9 })))
    const text = weaknesses.join(" ").toLowerCase()
    expect(text).toMatch(/evidence/i)
  })

  it("high reversibility produces a strength", () => {
    const { strengths } = explainScore(computeScore(dims({ reversibility: 1 })))
    expect(strengths.some(s => s.toLowerCase().includes("reversible"))).toBe(true)
  })
})
