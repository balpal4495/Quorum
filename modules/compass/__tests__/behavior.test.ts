import { describe, it, expect } from "vitest"
import { mapBehaviorsFromFindings, summarizeBehaviorMap } from "../behavior"
import type { ProductSourceFinding } from "../types"

function makeFinding(overrides: Partial<ProductSourceFinding> = {}): ProductSourceFinding {
  return {
    id: `f-${Math.random().toString(36).slice(2, 8)}`,
    kind: "cli",
    source: "bin/commands",
    path: "bin/commands/init.js",
    title: "init",
    summary: "quorum init — scaffold Chronicle into a project",
    tags: ["init", "onboarding"],
    confidence: 0.9,
    ...overrides,
  }
}

describe("mapBehaviorsFromFindings", () => {
  it("maps CLI findings into behaviours", () => {
    const findings: ProductSourceFinding[] = [
      makeFinding({ id: "f-init", title: "init", summary: "quorum init sets up chronicle", tags: ["init", "onboarding"] }),
      makeFinding({ id: "f-commit", title: "commit", summary: "quorum commit approves a proposal", tags: ["commit", "chronicle"] }),
    ]
    const map = mapBehaviorsFromFindings(findings)
    expect(map.behaviors.length).toBeGreaterThanOrEqual(2)
    expect(map.behaviors.every(b => b.confidence > 0)).toBe(true)
  })

  it("returns a BehaviorMap with confidence and generated_at", () => {
    const map = mapBehaviorsFromFindings([makeFinding()])
    expect(map.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(typeof map.confidence).toBe("number")
    expect(map.confidence).toBeGreaterThan(0)
    expect(map.confidence).toBeLessThanOrEqual(1)
  })

  it("filters by area when area input provided", () => {
    const findings: ProductSourceFinding[] = [
      makeFinding({ id: "f-advisor", title: "advisor", summary: "advisor brief", tags: ["advisor"] }),
      makeFinding({ id: "f-init", title: "init", summary: "quorum init setup", tags: ["init", "onboarding"] }),
    ]
    const map = mapBehaviorsFromFindings(findings, { area: "advisor" })
    // All returned behaviors should relate to advisor
    expect(map.behaviors.every(b => b.area.includes("advisor") || b.name.toLowerCase().includes("advisor"))).toBe(true)
  })

  it("detects gaps for undocumented expected areas", () => {
    // Empty findings → all expected areas should appear as gaps
    const map = mapBehaviorsFromFindings([])
    expect(map.gaps.length).toBeGreaterThan(0)
    expect(map.gaps[0]).toHaveProperty("gap")
    expect(map.gaps[0]).toHaveProperty("why_it_matters")
    expect(map.gaps[0]).toHaveProperty("confidence")
  })

  it("always includes product-direction gap when no compass behaviour present", () => {
    const map = mapBehaviorsFromFindings([])
    const compassGap = map.gaps.find(g => g.id === "gap-product-direction")
    expect(compassGap).toBeDefined()
    expect(compassGap!.confidence).toBeGreaterThan(0.5)
  })

  it("each behavior has an evidence array with at least one entry", () => {
    const map = mapBehaviorsFromFindings([makeFinding()])
    expect(map.behaviors.every(b => Array.isArray(b.evidence) && b.evidence.length > 0)).toBe(true)
  })
})

describe("summarizeBehaviorMap", () => {
  it("returns a non-empty string", () => {
    const map = mapBehaviorsFromFindings([makeFinding()])
    const summary = summarizeBehaviorMap(map)
    expect(typeof summary).toBe("string")
    expect(summary.length).toBeGreaterThan(0)
  })

  it("includes gaps when present", () => {
    const map = mapBehaviorsFromFindings([])
    const summary = summarizeBehaviorMap(map)
    expect(summary).toContain("Gaps")
  })
})
