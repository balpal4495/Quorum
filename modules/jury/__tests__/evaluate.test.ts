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
  }
}

function makeValidResponse(confidence: number): string {
  const council_brief = confidence < 0.6 ? "challenge" : "pressure-test"
  return JSON.stringify({
    confidence,
    assessment: "Evidence broadly supports the design approach.",
    gaps: ["No data on error handling patterns in this codebase"],
    council_brief,
    recommendation: "proceed",
  })
}

const baseInput: JuryInput = {
  outcome: "Add authentication to the API",
  design: "Use JWT with RS256, short-lived access tokens, and refresh token rotation",
  evidence: [makeEvidence("e1"), makeEvidence("e2", "refuted")],
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("jury/evaluate", () => {
  it("returns a valid JuryOutput for a high-confidence LLM response", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(0.85)),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.confidence).toBe(0.85)
    expect(result.council_brief).toBe("pressure-test")
    expect(result.recommendation).toBe("proceed")
    expect(Array.isArray(result.gaps)).toBe(true)
    expect(typeof result.assessment).toBe("string")
  })

  it("returns council_brief = challenge when confidence < 0.6", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(0.45)),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.council_brief).toBe("challenge")
  })

  it("overrides council_brief from confidence regardless of what LLM returns", async () => {
    // LLM returns wrong council_brief value — evaluate() must correct it
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(
        JSON.stringify({
          confidence: 0.3,
          assessment: "Weak evidence.",
          gaps: [],
          council_brief: "pressure-test", // wrong — should be "challenge"
          recommendation: "investigate-more",
        }),
      ),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.council_brief).toBe("challenge")
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
        "```json\n" + makeValidResponse(0.7) + "\n```",
      ),
    }
    const result = await evaluate(baseInput, deps)
    expect(result.confidence).toBe(0.7)
  })

  it("passes the model override to the LLM provider", async () => {
    const llm = vi.fn().mockResolvedValue(makeValidResponse(0.7))
    const deps: JuryDeps = { llm, model: "gpt-4o" }
    await evaluate(baseInput, deps)
    expect(llm).toHaveBeenCalledWith(expect.any(Array), "gpt-4o")
  })

  it("handles empty evidence gracefully", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(makeValidResponse(0.3)),
    }
    const result = await evaluate({ ...baseInput, evidence: [] }, deps)
    expect(result).toBeDefined()
    expect(result.confidence).toBe(0.3)
  })

  it("clamps confidence to [0, 1] via Zod schema", async () => {
    const deps: JuryDeps = {
      llm: vi.fn().mockResolvedValue(
        JSON.stringify({
          confidence: 1.5, // out of range
          assessment: "Too high.",
          gaps: [],
          council_brief: "pressure-test",
          recommendation: "proceed",
        }),
      ),
    }
    await expect(evaluate(baseInput, deps)).rejects.toThrow("schema validation")
  })
})
