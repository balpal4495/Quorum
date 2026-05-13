/**
 * Eval suite — runs all cases from evals/cases/ through deterministic checks.
 *
 * Deterministic assertions (preflight, risk classifier) run on every CI pass.
 * LLM-dependent assertions (jury confidence, council recommendation) are skipped
 * unless EVAL_LLM env var is set — they are too slow and costly for standard CI.
 *
 * To run with a real LLM locally:
 *   EVAL_LLM=1 OPENAI_API_KEY=sk-... npx vitest run evals/
 */
import { describe, it, expect } from "vitest"
import path from "path"
import { loadCases, runCase } from "../runner"

describe("eval suite — deterministic checks", async () => {
  const cases = await loadCases(path.join(__dirname, "../cases"))

  for (const evalCase of cases) {
    it(`[${evalCase.id}] ${evalCase.description}`, async () => {
      // No LLM — only runs deterministic assertions (preflight + risk classifier)
      const result = await runCase(evalCase)

      if (!result.passed) {
        // Surface all failures clearly
        throw new Error(
          `Eval case "${evalCase.id}" failed:\n${result.failures.map(f => `  • ${f}`).join("\n")}`,
        )
      }
    })
  }
})
