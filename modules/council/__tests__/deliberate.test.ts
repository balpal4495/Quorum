import { describe, it, expect, vi } from "vitest"
import { deliberate } from "../deliberate"
import type { CouncilInput, CouncilDeps } from "../types"
import type { OracleResult, OracleClient } from "../../shared/types"
import type { JuryOutput } from "../../jury/types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvidence(id: string): OracleResult {
  return {
    id,
    key_insight: `Finding ${id}: the pattern works at scale`,
    affected_areas: ["api"],
    status: "validated",
    confidence: 0.8,
    source_module: "detective",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
    score: 0.6,
  }
}

const mockJuryOutput: JuryOutput = {
  confidence: 0.75,
  assessment: "Evidence broadly supports this approach with one unresolved gap.",
  gaps: ["No data on token refresh handling in this codebase"],
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
  challenges: ["Refresh token storage strategy not yet validated in this codebase"],
  evidence_cited: ["e1", "e2"],
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

  it("populates challenges and evidence_cited arrays", async () => {
    const deps = makeDeps()
    const result = await deliberate(baseInput, deps)
    expect(Array.isArray(result.challenges)).toBe(true)
    expect(Array.isArray(result.evidence_cited)).toBe(true)
  })

  it("calls oracle.propose once with source_module = council", async () => {
    const deps = makeDeps()
    await deliberate(baseInput, deps)
    expect(deps.oracle.propose).toHaveBeenCalledOnce()
    const proposedEntry = (deps.oracle.propose as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(proposedEntry.source_module).toBe("council")
  })

  it("copies evidence_cited from chairman verdict into the Oracle proposal", async () => {
    const deps = makeDeps()
    await deliberate(baseInput, deps)
    const proposedEntry = (deps.oracle.propose as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(proposedEntry.evidence_cited).toEqual(["e1", "e2"])
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
    // All advisor/reviewer/frame calls return plain text — only chairman parses JSON
    let callCount = 0
    const deps: CouncilDeps = {
      llm: vi.fn().mockImplementation(async () => {
        callCount++
        // The last call is the chairman — return invalid JSON
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
    // frame call uses frame model
    expect(calls[0][1]).toBe("gpt-4o-mini")
    // chairman call (last) uses chairman model
    expect(calls[calls.length - 1][1]).toBe("gpt-4o")
  })

  it("routes satisfied=false correctly in the output", async () => {
    const unsatisfiedJson = JSON.stringify({
      satisfied: false,
      verdict: "The design has fundamental gaps that must be resolved first.",
      challenges: ["No evidence for token storage strategy"],
      evidence_cited: ["e1"],
      recommendation: "investigate-more",
    })
    const deps = makeDeps(unsatisfiedJson)
    const result = await deliberate(baseInput, deps)
    expect(result.satisfied).toBe(false)
    expect(result.recommendation).toBe("investigate-more")
  })
})
