/**
 * Eval runner for Quorum Jury + Council.
 *
 * Each case in evals/cases/ defines a proposal and what the system should produce.
 * The runner validates:
 *   - Jury confidence is within expected bounds
 *   - Preflight detects the expected signals
 *   - Risk classifier assigns the expected level
 *   - Council recommendation matches (when an LLM provider is available)
 *
 * Jury + preflight run without any LLM (deterministic).
 * Council assertions are skipped if no LLM provider is injected.
 *
 * Usage:
 *   npx vitest run evals/
 *
 * Or run against a real LLM:
 *   EVAL_LLM=openai npx vitest run evals/
 */

import { promises as fs } from "fs"
import path from "path"
import type { OracleResult, LLMProvider } from "../modules/shared/types"
import { runPreflight } from "../modules/jury/preflight"
import { classifyRisk } from "../modules/council/risk"

export interface EvalCase {
  id: string
  description: string
  outcome: string
  design: string
  oracle_evidence: OracleResult[]
  expected: {
    jury_min_confidence?: number
    jury_max_confidence?: number
    council_recommendation?: "proceed" | "redesign" | "investigate-more"
    must_flag?: string[]
    must_not_flag?: string[]
    must_cite?: string[]
    risk_level?: string
    preflight_expects?: {
      touches_sensitive_area?: boolean
      sensitive_areas_include?: string[]
      rollback_mentioned?: boolean
      test_strategy_mentioned?: boolean
      chronicle_conflicts?: string[]
    }
  }
}

export interface EvalResult {
  caseId: string
  description: string
  passed: boolean
  failures: string[]
  preflight: ReturnType<typeof runPreflight>
  risk: ReturnType<typeof classifyRisk>
  juryOutput?: unknown
  councilOutput?: unknown
  durationMs: number
}

export async function loadCases(casesDir?: string): Promise<EvalCase[]> {
  const dir = casesDir ?? path.join(__dirname, "cases")
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".json"))
  const cases = await Promise.all(
    files.map(async f => {
      const raw = await fs.readFile(path.join(dir, f), "utf8")
      return JSON.parse(raw) as EvalCase
    }),
  )
  return cases
}

export async function runCase(
  evalCase: EvalCase,
  llm?: LLMProvider,
): Promise<EvalResult> {
  const start = Date.now()
  const failures: string[] = []

  const { outcome, design, oracle_evidence: evidence, expected } = evalCase

  // ── Deterministic checks (no LLM) ──────────────────────────────────────────

  const preflight = runPreflight(outcome, design, evidence)
  const risk = classifyRisk(outcome, design, evidence)

  // Risk level
  if (expected.risk_level && risk.level !== expected.risk_level) {
    failures.push(
      `risk_level: expected "${expected.risk_level}", got "${risk.level}" (reasons: ${risk.reasons.join(", ")})`,
    )
  }

  // Preflight assertions
  const pf = expected.preflight_expects
  if (pf) {
    if (pf.touches_sensitive_area !== undefined && preflight.touches_sensitive_area !== pf.touches_sensitive_area) {
      failures.push(`preflight.touches_sensitive_area: expected ${pf.touches_sensitive_area}, got ${preflight.touches_sensitive_area}`)
    }
    if (pf.rollback_mentioned !== undefined && preflight.rollback_mentioned !== pf.rollback_mentioned) {
      failures.push(`preflight.rollback_mentioned: expected ${pf.rollback_mentioned}, got ${preflight.rollback_mentioned}`)
    }
    if (pf.test_strategy_mentioned !== undefined && preflight.test_strategy_mentioned !== pf.test_strategy_mentioned) {
      failures.push(`preflight.test_strategy_mentioned: expected ${pf.test_strategy_mentioned}, got ${preflight.test_strategy_mentioned}`)
    }
    if (pf.chronicle_conflicts) {
      for (const id of pf.chronicle_conflicts) {
        if (!preflight.chronicle_conflicts.includes(id)) {
          failures.push(`preflight.chronicle_conflicts: expected "${id}" to be flagged`)
        }
      }
    }
    if (pf.sensitive_areas_include) {
      for (const area of pf.sensitive_areas_include) {
        if (!preflight.sensitive_areas.includes(area)) {
          failures.push(`preflight.sensitive_areas: expected "${area}" to be detected`)
        }
      }
    }
  }

  let juryOutput: unknown
  let councilOutput: unknown

  // ── LLM-dependent checks (skipped if no provider) ──────────────────────────

  if (llm) {
    const { evaluate } = await import("../modules/jury/evaluate")
    try {
      juryOutput = await evaluate({ outcome, design, evidence }, { llm })
      const jury = juryOutput as { confidence: number; recommendation: string; assessment: string; gaps: string[] }

      if (expected.jury_min_confidence !== undefined && jury.confidence < expected.jury_min_confidence) {
        failures.push(`jury.confidence: expected ≥ ${expected.jury_min_confidence}, got ${jury.confidence}`)
      }
      if (expected.jury_max_confidence !== undefined && jury.confidence > expected.jury_max_confidence) {
        failures.push(`jury.confidence: expected ≤ ${expected.jury_max_confidence}, got ${jury.confidence}`)
      }
    } catch (err) {
      failures.push(`jury threw: ${String(err)}`)
    }

    if (expected.council_recommendation && juryOutput) {
      const { deliberate } = await import("../modules/council/deliberate")
      const mockOracle = {
        query: async () => [],
        propose: async () => ({ proposalId: "eval-proposal" }),
        commit: async () => { throw new Error("commit not available in eval") },
      }
      try {
        councilOutput = await deliberate(
          { outcome, design, evidence, jury_output: juryOutput as never },
          { llm, oracle: mockOracle, advisorCount: 2, reviewerCount: 2 },
        )
        const council = councilOutput as { recommendation: string; verdict: string; blockers: Array<{ issue: string }>; evidence_cited: string[] }

        if (council.recommendation !== expected.council_recommendation) {
          failures.push(
            `council.recommendation: expected "${expected.council_recommendation}", got "${council.recommendation}"`,
          )
        }

        const verdictText = [
          council.verdict,
          ...council.blockers.map(b => b.issue),
        ].join(" ").toLowerCase()

        if (expected.must_flag) {
          for (const term of expected.must_flag) {
            if (!verdictText.includes(term.toLowerCase())) {
              failures.push(`council must_flag: "${term}" not mentioned in verdict or blockers`)
            }
          }
        }
        if (expected.must_not_flag) {
          for (const term of expected.must_not_flag) {
            if (verdictText.includes(term.toLowerCase())) {
              failures.push(`council must_not_flag: "${term}" was mentioned but should not be`)
            }
          }
        }
        if (expected.must_cite) {
          for (const id of expected.must_cite) {
            if (!council.evidence_cited.includes(id)) {
              failures.push(`council must_cite: entry ID "${id}" not in evidence_cited`)
            }
          }
        }
      } catch (err) {
        failures.push(`council threw: ${String(err)}`)
      }
    }
  }

  return {
    caseId: evalCase.id,
    description: evalCase.description,
    passed: failures.length === 0,
    failures,
    preflight,
    risk,
    juryOutput,
    councilOutput,
    durationMs: Date.now() - start,
  }
}

export function printEvalSummary(results: EvalResult[]): void {
  const passed = results.filter(r => r.passed).length
  const total = results.length
  console.log(`\n${"─".repeat(60)}`)
  console.log(`Eval results: ${passed}/${total} passed`)
  console.log("─".repeat(60))
  for (const r of results) {
    const icon = r.passed ? "✓" : "✗"
    console.log(`${icon} ${r.caseId} (${r.durationMs}ms)`)
    if (!r.passed) {
      for (const f of r.failures) {
        console.log(`    → ${f}`)
      }
    }
  }
  console.log("─".repeat(60))
}
