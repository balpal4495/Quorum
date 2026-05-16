import { describe, it, expect, vi, beforeEach } from "vitest"
import { stageProposal, stageOutcome } from "../propose"
import type { CompassProposalInput, CompassOutcomeInput, OracleClient } from "../../shared/types"

function makeOracle(): OracleClient {
  return {
    query: vi.fn().mockResolvedValue([]),
    propose: vi.fn().mockImplementation(async (entry) => ({ proposalId: "test-uuid-12345678-abcd-efgh" })),
    commit: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
    upsert: vi.fn(),
    summary: vi.fn().mockResolvedValue(""),
    log: vi.fn(),
  } as unknown as OracleClient
}

describe("stageProposal", () => {
  let oracle: OracleClient

  beforeEach(() => { oracle = makeOracle() })

  it("calls oracle.propose() — not oracle.commit()", async () => {
    const input: CompassProposalInput = {
      artifact_kind: "product_pathway",
      payload: {
        id: "p1",
        kind: "product_pathway",
        title: "Improve onboarding",
        goal: "faster agent onboarding",
        target_user: "new agents",
        problem: "setup is slow",
        current_behaviors: [],
        opportunity: "gap in docs",
        why_now: "user feedback",
        smallest_useful_version: "one-command onboarding",
        phases: [],
        dependencies: [],
        risks: [],
        assumptions: ["users want faster onboarding"],
        open_questions: [],
        evidence: [],
        scores: { strategic_fit: 0.8, user_problem_clarity: 0.8, evidence_strength: 0.7, leverage: 0.7, feasibility: 0.8, time_to_signal: 0.8, reversibility: 0.9, complexity_penalty: 0.1, dependency_penalty: 0.1, contradiction_penalty: 0, evidence_gap_penalty: 0.1, total: 78 },
        confidence: 0.8,
        time_to_signal: "1 session",
        reversibility: "high",
        suggested_next_step: "quorum compass spec",
      },
    }

    const result = await stageProposal(input, oracle)

    expect(oracle.propose).toHaveBeenCalledOnce()
    expect(oracle.commit).not.toHaveBeenCalled()
    expect(result.proposal_id).toBeDefined()
    expect(result.message).toContain("quorum commit --list")
  })

  it("stages to proposals, not committed dir", async () => {
    const input: CompassProposalInput = {
      artifact_kind: "product_bet",
      payload: {
        id: "b1",
        kind: "product_bet",
        title: "Bet on AI-native workflow",
        thesis: "Teams using AI agents will pay for structured memory before they pay for analytics",
        why_now: "AI coding tools are mainstream",
        target_user: "engineering teams using AI agents",
        upside: "category-defining product",
        downside: "small market now",
        assumptions: ["teams want memory, not chat"],
        validation_signals: ["3 teams pay"],
        invalidation_signals: ["no takers after 10 conversations"],
        kill_criteria: ["no signal in 30 days"],
        first_experiment: "free tier + pitch 10 teams",
        build_path: ["free tier", "paid tier"],
        evidence: [],
        scores: { strategic_fit: 0.9, user_problem_clarity: 0.7, evidence_strength: 0.5, leverage: 0.9, feasibility: 0.7, time_to_signal: 0.6, reversibility: 0.8, complexity_penalty: 0.2, dependency_penalty: 0.1, contradiction_penalty: 0, evidence_gap_penalty: 0.3, total: 72 },
        confidence: 0.75,
        time_to_signal: "30 days",
        reversibility: "high",
        appetite: "medium",
      },
    }

    const result = await stageProposal(input, oracle)
    const proposalArg = (oracle.propose as ReturnType<typeof vi.fn>).mock.calls[0][0]

    // source_module must be compass
    expect(proposalArg.source_module).toBe("compass")
    // status should be "open" for new proposals
    expect(proposalArg.status).toBe("open")
    expect(result.proposal_id).toBeDefined()
  })
})

describe("stageOutcome", () => {
  let oracle: OracleClient

  beforeEach(() => { oracle = makeOracle() })

  it("stages outcome as a validated Chronicle entry", async () => {
    const input: CompassOutcomeInput = {
      entry_id: "abc-def-ghi",
      result: "validated",
      note: "3 teams signed up within 2 weeks",
    }

    const result = await stageOutcome(input, oracle)
    expect(oracle.propose).toHaveBeenCalledOnce()
    expect(oracle.commit).not.toHaveBeenCalled()

    const proposalArg = (oracle.propose as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(proposalArg.source_module).toBe("compass")
    expect(proposalArg.post_merge_result).toBe("successful")
    expect(result.message).toContain("quorum commit --list")
  })

  it("sets post_merge_result correctly for invalidated bets", async () => {
    const input: CompassOutcomeInput = {
      entry_id: "xyz-uvw",
      result: "invalidated",
      note: "no uptake after 30 days",
    }
    await stageOutcome(input, oracle)
    const proposalArg = (oracle.propose as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(proposalArg.post_merge_result).toBe("rolled-back")
  })
})
