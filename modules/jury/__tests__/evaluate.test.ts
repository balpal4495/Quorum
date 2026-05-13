import { describe, it, expect, vi } from "vitest"
import { evaluate } from "../evaluate"
import type { JuryInput, JuryDeps } from "../types"
import type { OracleResult } from "../../shared/types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvidence(
  id: string,
  status: OracleResult["status"] = "validated",
): OracleResult {
  return {
    id,
    key_insight: `Prior finding ${id}: the approach was tested and confirmed`,
    affected_areas: ["services"],
    status,
    confidence: 0.8,
    source_module: "detective",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
    score: 0.7,
    tier: "primary",
  }
}

function makeValidResponse(
  breakdown: { evidence_support: number; feasibility: number; risk: number; completeness: number },
  blockingGaps: string[] = [],
): string {
  const confidence = (breakdown.evidence_support + breakdown.feasibility + breakdown.risk + breakdown.completeness) / 4
  const council_brief = confidence < 0.6 ? "challenge" : "pressure-test"
  const recommendation = confidence >= 0.7 ? "proceed" : confidence >= 0.5 ? "investigate-more" : "redesign"
  return JSON.stringify({
    confidence,
    confidence_breakdown: breakdown,
    assessment: "Evidence broadly supports the design approach.",
    gaps: ["No data on error handling patterns in this codebase"],
    blocking_gaps: blockingGaps,
    council_brief,
    recommendation,
  })
}

const HIGH_CONFIDENCE_BREAKDOWN = { evidence_support: 0.9, feasibility: 0.85, risk: 0.8, completeness: 0.85 }
const LOW_CONFIDENCE_BREAKDOWN  = { evidence_support: 0.3, feasibility: 0.4, risk: 0.5, completeness: 0.4 }

const baseInput: JuryInput = {
  outcome: "Add authentication to the API",
  design: "Use JWT with RS256, short-lived access tokens, and refresh token rotation",
  evidence: [makeEvidence("e1"), makeEvidence("e2", "refuted")],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("jury/evaluate", () => {
  it("returns a valid JuryOutput with confidence_breakdown", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(HIGH_CONFIDENCE_BREAKDOWN)),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.confidence_breakdown).toBeDefined()
    expect(result.confidence_breakdown.evidence_support).toBe(0.9)
    expect(result.confidence_breakdown.feasibility).toBe(0.85)
    expect(result.confidence_breakdown.risk).toBe(0.8)
    expect(result.confidence_breakdown.completeness).toBe(0.85)
    expect(Array.isArray(result.blocking_gaps)).toBe(true)
  })

  it("recomputes confidence as the exact average of breakdown dimensions", async () => {
    const breakdown = { evidence_support: 0.8, feasibility: 0.6, risk: 0.7, completeness: 0.9 }
    const deps: JuryDeps = {
      // LLM returns confidence=0.5 but it should be overridden by the breakdown average
      llm: vi.fn().mockResolvedValue(JSON.stringify({
        confidence: 0.5,
        confidence_breakdown: breakdown,
        assessment: "Test.",
        gaps: [],
        blocking_gaps: [],
        council_brief: "pressure-test",
        recommendation: "proceed",
      })),
    }
    const result = await evaluate(baseInput, deps)
    // average(0.8, 0.6, 0.7, 0.9) = 0.75
    expect(result.confidence).toBe(0.75)
  })

  it("returns council_brief = challenge when recomputed confidence < 0.6", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(LOW_CONFIDENCE_BREAKDOWN)),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.council_brief).toBe("challenge")
    expect(result.confidence).toBeLessThan(0.6)
  })

  it("overrides council_brief from confidence regardless of what LLM returns", async () => {
    const breakdown = { evidence_support: 0.2, feasibility: 0.3, risk: 0.3, completeness: 0.2 }
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(JSON.stringify({
        confidence: 0.25,
        confidence_breakdown: breakdown,
        assessment: "Weak evidence.",
        gaps: [],
        blocking_gaps: [],
        council_brief: "pressure-test", // wrong — should be "challenge"
        recommendation: "investigate-more",
      })),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.council_brief).toBe("challenge")
  })

  it("surfaces blocking_gaps separately from general gaps", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(
        makeValidResponse(LOW_CONFIDENCE_BREAKDOWN, ["No rollback plan for destructive migration"]),
      ),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.blocking_gaps).toContain("No rollback plan for destructive migration")
  })

  it("throws when the LLM returns non-JSON", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue("This is not JSON at all."),
    }
    await expect(evaluate(baseInput, deps)).rejects.toThrow("non-JSON")
  })

  it("throws when the LLM returns JSON that fails schema validation", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(JSON.stringify({ unexpected: true })),
    }
    await expect(evaluate(baseInput, deps)).rejects.toThrow("schema validation")
  })

  it("strips markdown code fences before parsing", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(
        "```json\n" + makeValidResponse(HIGH_CONFIDENCE_BREAKDOWN) + "\n```",
      ),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.confidence).toBeDefined()
  })

  it("passes the model override to the LLM provider", async () => {
    const llm = vi.fn().mockResolvedValue(makeValidResponse(HIGH_CONFIDENCE_BREAKDOWN))
    const deps: JuryDeps = { llm, model: "gpt-4o" }
    await evaluate(baseInput, deps)
    expect(llm).toHaveBeenCalledWith(expect.any(Array), "gpt-4o")
  })

  it("handles empty evidence gracefully", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(LOW_CONFIDENCE_BREAKDOWN)),
    }
    const result = await evaluate({ ...baseInput, evidence: [] }, deps)
    expect(result).toBeDefined()
    expect(result.confidence_breakdown).toBeDefined()
  })

  it("injects preflight results into the LLM prompt", async () => {
    const llm = vi.fn().mockResolvedValue(makeValidResponse(HIGH_CONFIDENCE_BREAKDOWN))
    const authInput: JuryInput = {
      outcome: "Add JWT authentication",
      design: "Use HS256 tokens",
      evidence: [],
    }
    await evaluate(authInput, { llm })
    const promptMessages = llm.mock.calls[0][0] as Array<{ role: string; content: string }>
    const userPrompt = promptMessages.find(m => m.role === "user")?.content ?? ""
    // Preflight section must appear in the prompt
    expect(userPrompt).toContain("Deterministic Preflight")
    // Auth patterns should be detected
    expect(userPrompt).toContain("auth")
  })

  it("throws when confidence_breakdown is missing from LLM response", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(JSON.stringify({
        confidence: 0.7,
        assessment: "Good.",
        gaps: [],
        blocking_gaps: [],
        council_brief: "pressure-test",
        recommendation: "proceed",
        // confidence_breakdown intentionally missing
      })),
    }
    await expect(evaluate(baseInput, deps)).rejects.toThrow("schema validation")
  })
})
