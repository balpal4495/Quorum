import { coverage } from "./coverage.js"
import { detectDrift } from "./drift.js"
import type { LLMProvider } from "../shared/types.js"

export interface SentinelAssertOptions {
  chronicleDir?: string
  codebasePath?: string
  /** When provided, drift detection runs. When absent, drift tests are skipped. */
  llm?: LLMProvider
  extensions?: string[]
  /**
   * Chronicle coverage must reach this percentage for the CI test to pass.
   * Default 0 = report gaps as advisory output without failing the build.
   * Raise this as the project matures (e.g. 50 for an established codebase).
   */
  minCoveragePercent?: number
}

/**
 * Returns a set of named assertions designed to be called inside a Vitest
 * describe block. Coverage assertions are deterministic and always run.
 * Drift assertions skip gracefully when no LLM is provided.
 *
 * @example
 * import { describe } from "vitest"
 * import { sentinelAssertions } from "../modules/sentinel/assert.js"
 *
 * const assertions = sentinelAssertions({ chronicleDir: ".chronicle", codebasePath: "modules" })
 * describe("sentinel", () => { assertions.forEach(a => a()) })
 */
export function sentinelAssertions(options: SentinelAssertOptions = {}): Array<() => void> {
  const {
    chronicleDir = ".chronicle",
    codebasePath = ".",
    llm,
    extensions,
    minCoveragePercent = 0,
  } = options

  // Import vitest lazily so this file is usable outside of a test context too
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { it, expect, describe: _describe } = require("vitest") as typeof import("vitest")

  const assertions: Array<() => void> = []

  // ── Coverage (deterministic, always run) ──────────────────────────────────
  assertions.push(() => {
    const label = minCoveragePercent > 0
      ? `coverage: Chronicle coverage ≥ ${minCoveragePercent}%`
      : "coverage: Chronicle coverage report [advisory]"
    it(label, async () => {
      const report = await coverage(chronicleDir, codebasePath, { extensions })
      if (report.uncoveredFiles.length > 0) {
        const list = report.uncoveredFiles.slice(0, 10).join("\n  ")
        const msg = `${report.uncoveredFiles.length} source file(s) have no Chronicle coverage (${report.percentage}% covered):\n  ${list}`
        if (minCoveragePercent > 0) {
          expect(report.percentage, msg).toBeGreaterThanOrEqual(minCoveragePercent)
        } else {
          // New project or no threshold set — surface gaps without failing the build
          console.info(`[sentinel] ${msg}`)
        }
      }
    })
  })

  assertions.push(() => {
    it("coverage: report is readable and well-formed", async () => {
      const report = await coverage(chronicleDir, codebasePath, { extensions })
      expect(report.totalFiles).toBeGreaterThanOrEqual(0)
      expect(report.percentage).toBeGreaterThanOrEqual(0)
      expect(report.percentage).toBeLessThanOrEqual(100)
    })
  })

  // ── Drift (advisory, skips when no LLM configured) ────────────────────────
  assertions.push(() => {
    it.skipIf(!llm)(
      "drift: no Chronicle entries flagged as potentially stale [advisory]",
      async () => {
        const report = await detectDrift(chronicleDir, codebasePath, llm!)
        if (report.flags.length > 0) {
          const detail = report.flags
            .map(f => `  [${f.entryId.slice(0, 8)}] ${f.keyInsight}\n    → ${f.reasoning}`)
            .join("\n")
          expect(
            report.flags,
            `${report.flags.length} Chronicle entry/entries may have drifted (advisory — review before marking refuted):\n${detail}`,
          ).toHaveLength(0)
        }
      },
    )
  })

  return assertions
}
