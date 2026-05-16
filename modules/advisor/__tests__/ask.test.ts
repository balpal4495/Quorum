import { describe, it, expect, vi } from "vitest"
import { ask } from "../ask"
import type { AdvisorInput, AdvisorDeps } from "../types"
import type { OracleResult } from "../../shared/types"

function makeEvidence(id: string): OracleResult {
  return {
    id,
    key_insight: `RS256 JWT is the validated signing approach — HS256 was rejected`,
    affected_areas: ["auth"],
    status: "validated",
    confidence: 0.9,
    source_module: "council",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
    score: 0.8,
    tier: "primary",
  }
}

const highConfidenceAnswer = JSON.stringify({
  confidence: 0.85,
  what_we_know: "The team chose RS256 JWT in March. HS256 was rejected because key rotation was not viable.",
  risks: ["Short token expiry means more refresh operations"],
  blockers: [],
  recommendation: "Use RS256 JWT with 15-minute expiry and httpOnly cookie refresh rotation.",
  next_step: "Run: quorum check --outcome 'add JWT auth' --design 'RS256, 15min expiry'",
})

const lowConfidenceAnswer = JSON.stringify({
  confidence: 0.4,
  what_we_know: "No Chronicle evidence on this topic.",
  risks: ["Approach is undocumented"],
  blockers: ["No prior decision on token strategy recorded"],
  recommendation: "Investigate before proceeding.",
  next_step: "quorum advisor 'what JWT strategy has the team validated?'",
})

const baseInput: AdvisorInput = {
  question: "What happens if we change the auth system?",
  evidence: [makeEvidence("e1")],
}

function makeDeps(response = highConfidenceAnswer): AdvisorDeps {
  return { llm: vi.fn().mockResolvedValue(response) }
}

describe("advisor/ask", () => {
  it("returns an AdvisorOutput with all required fields", async () => {
    const deps = makeDeps()
    const result = await ask(baseInput, deps)
    expect(result.question).toBe(baseInput.question)
    expect(typeof result.confidence).toBe("number")
    expect(typeof result.what_we_know).toBe("string")
    expect(Array.isArray(result.risks)).toBe(true)
    expect(Array.isArray(result.blockers)).toBe(true)
    expect(typeof result.recommendation).toBe("string")
    expect(typeof result.next_step).toBe("string")
    expect(typeof result.retries).toBe("number")
  })

  it("returns on first attempt when confidence >= 0.7 and no blockers", async () => {
    const deps = makeDeps()
    const result = await ask(baseInput, deps)
    expect(result.retries).toBe(0)
    expect(deps.llm).toHaveBeenCalledTimes(1)
  })

  it("retries when confidence is below threshold", async () => {
    let callCount = 0
    const deps: AdvisorDeps = {
      llm: vi.fn().mockImplementation(async () => {
        callCount++
        return callCount >= 2 ? highConfidenceAnswer : lowConfidenceAnswer
      }),
    }
    const result = await ask(baseInput, deps)
    expect(result.retries).toBe(1)
    expect(deps.llm).toHaveBeenCalledTimes(2)
    expect(result.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it("retries when blockers are present even at high confidence", async () => {
    const highConfidenceWithBlockers = JSON.stringify({
      confidence: 0.8,
      what_we_know: "Some evidence exists.",
      risks: [],
      blockers: ["Missing rollback plan"],
      recommendation: "Add rollback plan first.",
      next_step: "Document rollback strategy.",
    })
    let callCount = 0
    const deps: AdvisorDeps = {
      llm: vi.fn().mockImplementation(async () => {
        callCount++
        return callCount >= 2 ? highConfidenceAnswer : highConfidenceWithBlockers
      }),
    }
    const result = await ask(baseInput, deps)
    expect(result.retries).toBe(1)
    expect(result.blockers).toHaveLength(0)
  })

  it("returns best result after max retries even if threshold never met", async () => {
    const deps = makeDeps(lowConfidenceAnswer)
    const result = await ask(baseInput, deps)
    expect(result.retries).toBe(2)
    expect(deps.llm).toHaveBeenCalledTimes(3)
  })

  it("throws on non-JSON LLM response", async () => {
    const deps = makeDeps("not json at all")
    await expect(ask(baseInput, deps)).rejects.toThrow("non-JSON")
  })

  it("throws on schema-invalid LLM response", async () => {
    const deps = makeDeps(JSON.stringify({ confidence: "wrong", what_we_know: 123 }))
    await expect(ask(baseInput, deps)).rejects.toThrow("validation")
  })

  it("passes the question through to output unchanged", async () => {
    const deps = makeDeps()
    const result = await ask({ question: "Is Redis safe for sessions?", evidence: [] }, deps)
    expect(result.question).toBe("Is Redis safe for sessions?")
  })

  it("includes previous answer context in retry prompt", async () => {
    let secondPrompt = ""
    let callCount = 0
    const deps: AdvisorDeps = {
      llm: vi.fn().mockImplementation(async (messages) => {
        callCount++
        if (callCount === 2) secondPrompt = messages[1].content
        return callCount >= 2 ? highConfidenceAnswer : lowConfidenceAnswer
      }),
    }
    await ask(baseInput, deps)
    expect(secondPrompt).toContain("Previous Answer")
    expect(secondPrompt).toContain("0.40")
  })
})
