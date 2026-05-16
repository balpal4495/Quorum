import { describe, it, expect, vi } from "vitest"
import { deliberate } from "../deliberate"
import type { CouncilInput, CouncilDeps } from "../types"
import type { OracleResult, OracleClient } from "../../shared/types"
import type { JuryOutput } from "../../jury/types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvidence(id: string, status: OracleResult["status"] = "validated"): OracleResult {
  return {
    id,
    key_insight: `Finding ${id}: the pattern works at scale`,
    affected_areas: ["api"],
    status,
    confidence: 0.8,
    source_module: "detective",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
    score: 0.6,
    tier: "primary",
  }
}

const mockJuryOutput: JuryOutput = {
  confidence: 0.75,
  confidence_breakdown: { evidence_support: 0.8, feasibility: 0.7, risk: 0.75, completeness: 0.75 },
  assessment: "Evidence broadly supports this approach with one unresolved gap.",
  gaps: ["No data on token refresh handling in this codebase"],
  blocking_gaps: [],
  council_brief: "pressure-test",
  recommendation: "proceed",
}

const baseInput: CouncilInput = {
  outcome: "Add JWT authentication to the API",
  design: "RS256 tokens, 15-minute expiry, refresh rotation stored in httpOnly cookies",
  evidence: [makeEvidence("e1"), makeEvidence("e2")],
  jury_output: mockJuryOutput,
}

const validChairmanJson = JSON.stringify({
  satisfied: true,
  verdict:
    "The design is sound. Entry [e1] confirms this pattern works at scale. " +
    "The refresh token gap noted by Jury remains unresolved but does not block proceed.",
  blockers: [],
  warnings: [
    { issue: "Refresh token storage strategy not yet validated in this codebase", suggested_fix: "Add an integration test" },
  ],
  evidence_cited: ["e1", "e2"],
  advisor_split: { proceed: 2, redesign: 0, "investigate-more": 0 },
  recommendation: "proceed",
})

function mockOracle(): OracleClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    propose: vi.fn().mockResolvedValue({ proposalId: "test-proposal-id" }),
    commit: vi.fn(),
  }
}

function makeDeps(llmResponse = validChairmanJson): CouncilDeps {
  return {
    llm: vi.fn().mockResolvedValue(llmResponse),
    oracle: mockOracle(),
    advisorCount: 2,
    reviewerCount: 2,
  }
}

// LLM call order with advisorCount=2, reviewerCount=2:
//   1 (frame) + 2 (advisors, parallel) + 2 (reviewers, parallel) + 1 (chairman) = 6

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("council/deliberate", () => {
  it("returns a CouncilOutput with satisfied and verdict", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(result.satisfied).toBe(true)
    expect(typeof result.verdict).toBe("string")
    expect(result.recommendation).toBe("proceed")
  })

  it("returns structured blockers and warnings", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(Array.isArray(result.blockers)).toBe(true)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it("populates challenges as flat backwards-compat array from blockers + warnings", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(Array.isArray(result.challenges)).toBe(true)
    // warnings map to challenges directly; blockers are prefixed with [BLOCKER]
    expect(result.challenges.some(c => c.includes("Refresh token"))).toBe(true)
  })

  it("returns citation_validation with valid and hallucinated IDs", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(result.citation_validation).toBeDefined()
    expect(Array.isArray(result.citation_validation.valid_ids)).toBe(true)
    expect(Array.isArray(result.citation_validation.hallucinated_ids)).toBe(true)
    // e1 and e2 are in the evidence pack — should be valid
    expect(result.citation_validation.valid_ids).toContain("e1")
    expect(result.citation_validation.valid_ids).toContain("e2")
    expect(result.citation_validation.hallucinated_ids).toHaveLength(0)
  })

  it("flags hallucinated citation IDs not in the evidence pack", async () => {
    const jsonWithHallucination = JSON.stringify({
      satisfied: true,
      verdict: "Citing [e1] and [ghost-id] which does not exist.",
      blockers: [],
      warnings: [],
      evidence_cited: ["e1", "ghost-id"],
      advisor_split: { proceed: 2, redesign: 0, "investigate-more": 0 },
      recommendation: "proceed",
    })
    const deps = makeDeps(jsonWithHallucination)
    const result = await deliberate(baseInput, deps)
    expect(result.citation_validation.hallucinated_ids).toContain("ghost-id")
    expect(result.citation_validation.valid_ids).toContain("e1")
  })

  it("returns advisor_split with counts", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(result.advisor_split).toBeDefined()
    expect(typeof result.advisor_split.proceed).toBe("number")
    expect(typeof result.advisor_split.redesign).toBe("number")
    expect(typeof result.advisor_split["investigate-more"]).toBe("number")
  })

  it("calls oracle.propose once with source_module = council", async () => {
    const deps = makeDeps()
    await deliberate(baseInput, deps)
    expect(deps.oracle.propose).toHaveBeenCalledOnce()
    const proposedEntry = (deps.oracle.propose as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(proposedEntry.source_module).toBe("council")
  })

  it("proposes only validated citation IDs (not hallucinated) to Oracle", async () => {
    const jsonWithHallucination = JSON.stringify({
      satisfied: true,
      verdict: "Citing [e1] and [ghost-id].",
      blockers: [],
      warnings: [],
      evidence_cited: ["e1", "ghost-id"],
      advisor_split: { proceed: 2, redesign: 0, "investigate-more": 0 },
      recommendation: "proceed",
    })
    const deps = makeDeps(jsonWithHallucination)
    await deliberate(baseInput, deps)
    const proposed = (deps.oracle.propose as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(proposed.evidence_cited).toContain("e1")
    expect(proposed.evidence_cited).not.toContain("ghost-id")
  })

  it("calls the LLM the correct number of times", async () => {
    const deps = makeDeps()
    await deliberate(baseInput, deps)
    // frame(1) + advisors(2) + reviewers(2) + chairman(1) = 6
    expect((deps.llm as ReturnType<typeof vi.fn>).mock.calls.length).toBe(6)
  })

  it("does not call oracle.commit — human approval is required", async () => {
    const deps = makeDeps()
    await deliberate(baseInput, deps)
    expect(deps.oracle.commit).not.toHaveBeenCalled()
  })

  it("throws when the chairman LLM response is not valid JSON", async () => {
    let callCount = 0
    const deps: CouncilDeps = {
      llm: vi.fn().mockImplementation(async () => {
        callCount++
        return callCount >= 6 ? "not valid json" : "Advisory response text."
      }),
      oracle: mockOracle(),
      advisorCount: 2,
      reviewerCount: 2,
    }
    await expect(deliberate(baseInput, deps)).rejects.toThrow()
  })

  it("uses model overrides when provided", async () => {
    const llm = vi.fn().mockResolvedValue(validChairmanJson)
    const deps: CouncilDeps = {
      llm,
      oracle: mockOracle(),
      advisorCount: 1,
      reviewerCount: 1,
      models: {
        frame: "gpt-4o-mini",
        advisors: "gpt-4o-mini",
        reviewers: "gpt-4o",
        chairman: "gpt-4o",
      },
    }
    await deliberate(baseInput, deps)
    const calls = llm.mock.calls as [unknown[], string | undefined][]
    expect(calls[0][1]).toBe("gpt-4o-mini")
    expect(calls[calls.length - 1][1]).toBe("gpt-4o")
  })

  it("routes satisfied=false with blockers correctly", async () => {
    const unsatisfiedJson = JSON.stringify({
      satisfied: false,
      verdict: "The design has fundamental gaps that must be resolved first.",
      blockers: [
        { issue: "No evidence for token storage strategy", evidence: ["e1"], required_fix: "Document the token storage approach" },
      ],
      warnings: [],
      evidence_cited: ["e1"],
      advisor_split: { proceed: 0, redesign: 1, "investigate-more": 1 },
      recommendation: "investigate-more",
    })
    const deps = makeDeps(unsatisfiedJson)
    const result = await deliberate(baseInput, deps)
    expect(result.satisfied).toBe(false)
    expect(result.recommendation).toBe("investigate-more")
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0].required_fix).toBeDefined()
  })

  it("skips Council entirely for low-risk designs (jury-only fast path)", async () => {
    const llm = vi.fn().mockResolvedValue(validChairmanJson)
    const lowRiskInput: CouncilInput = {
      outcome: "Rename internal helper functions in the reporting module",
      design: "Rename generateCsv to exportCsv. No behaviour change.",
      evidence: [],
      jury_output: mockJuryOutput,
    }
    const deps: CouncilDeps = { llm, oracle: mockOracle() }
    const result = await deliberate(lowRiskInput, deps)
    expect(result.satisfied).toBe(true)
    expect(result.recommendation).toBe("proceed")
    expect(llm.mock.calls.length).toBe(0)
    expect(deps.oracle.propose).not.toHaveBeenCalled()
  })
})
