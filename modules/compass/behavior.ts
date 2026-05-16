import { randomUUID } from "crypto"
import type {
  ProductBehavior, ProductBehaviorGap, ProductBehaviorContradiction, BehaviorMap,
  BehaviorMapInput, ProductSourceFinding, CompassEvidenceRef,
} from "./types"

// ── Deterministic behaviour mapping from source findings ─────────────────────

export function mapBehaviorsFromFindings(
  findings: ProductSourceFinding[],
  input: BehaviorMapInput = {},
): BehaviorMap {
  const behaviors: ProductBehavior[] = []
  const gaps: ProductBehaviorGap[] = []
  const contradictions: ProductBehaviorContradiction[] = []

  // Group CLI commands into behaviours
  const cliFindings = findings.filter(f => f.kind === "cli")
  for (const f of cliFindings) {
    behaviors.push({
      id: `behavior-cli-${f.id}`,
      area: inferArea(f),
      name: f.title,
      description: f.summary,
      current_behavior: f.summary,
      evidence: [findingToRef(f)],
      basis: ["implemented"],
      confidence: f.confidence,
    })
  }

  // Extract documented user flows from docs findings
  const docsFindings = findings.filter(f => f.kind === "docs" && f.tags.includes("cli"))
  for (const f of docsFindings) {
    // Only add if not already covered by a CLI finding
    const alreadyPresent = behaviors.some(b =>
      b.current_behavior.toLowerCase().includes(extractCommand(f.summary).toLowerCase()) &&
      extractCommand(f.summary).length > 3,
    )
    if (!alreadyPresent && extractCommand(f.summary)) {
      behaviors.push({
        id: `behavior-docs-${f.id}`,
        area: inferArea(f),
        name: `Documented: ${f.title}`,
        description: f.summary,
        current_behavior: f.summary,
        evidence: [findingToRef(f)],
        basis: ["documented"],
        confidence: f.confidence * 0.9,
      })
    }
  }

  // Cross-reference: documented claims without implementation
  const docsHeadings = findings.filter(f => f.kind === "docs" && !f.tags.includes("cli"))
  const implementedAreas = new Set(behaviors.map(b => b.area))

  // Detect gaps: central product promises with no CLI surface
  const EXPECTED_AREAS = ["onboarding", "chronicle", "advisor", "review"]
  for (const expected of EXPECTED_AREAS) {
    const hasBehavior = behaviors.some(b => b.area === expected || b.name.toLowerCase().includes(expected))
    if (!hasBehavior) {
      const docRef = docsHeadings.find(f => f.summary.toLowerCase().includes(expected))
      gaps.push({
        id: `gap-${expected}`,
        area: expected,
        gap: `No first-class CLI command found for '${expected}'.`,
        why_it_matters: `'${expected}' appears in product docs but has no dedicated CLI surface.`,
        evidence: docRef ? [findingToRef(docRef)] : [],
        confidence: 0.7,
      })
    }
  }

  // Gap: no product-direction module (Compass itself)
  const hasCompass = behaviors.some(b => b.name.toLowerCase().includes("compass"))
  if (!hasCompass) {
    gaps.push({
      id: "gap-product-direction",
      area: "product direction",
      gap: "No product behaviour mapping or direction module currently exists.",
      why_it_matters: "Quorum helps agents avoid repeating engineering mistakes, but has no module to help avoid repeating product-direction mistakes.",
      evidence: [],
      confidence: 0.93,
    })
  }

  // Filter by area if provided
  const filteredBehaviors = input.area
    ? behaviors.filter(b =>
        b.area.toLowerCase().includes(input.area!.toLowerCase()) ||
        b.name.toLowerCase().includes(input.area!.toLowerCase()),
      )
    : behaviors

  const overallConfidence = filteredBehaviors.length === 0
    ? 0.5
    : filteredBehaviors.reduce((s, b) => s + b.confidence, 0) / filteredBehaviors.length

  return {
    generated_at: new Date().toISOString(),
    area: input.area,
    behaviors: filteredBehaviors,
    gaps: input.area
      ? gaps.filter(g => g.area.toLowerCase().includes(input.area!.toLowerCase()))
      : gaps,
    contradictions,
    confidence: Math.round(overallConfidence * 100) / 100,
  }
}

// ── Extract documented behaviors for LLM context ─────────────────────────────

export function summarizeBehaviorMap(map: BehaviorMap): string {
  const lines: string[] = []

  if (map.behaviors.length > 0) {
    lines.push("## Current behaviours")
    for (const b of map.behaviors.slice(0, 20)) {
      lines.push(`  ✓ ${b.current_behavior.slice(0, 100)}`)
    }
  }

  if (map.gaps.length > 0) {
    lines.push("\n## Gaps")
    for (const g of map.gaps) {
      lines.push(`  ? ${g.gap}`)
    }
  }

  return lines.join("\n")
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findingToRef(f: ProductSourceFinding): CompassEvidenceRef {
  return {
    id: f.id,
    kind: f.kind,
    source: f.source,
    path: f.path,
    summary: f.summary,
    confidence: f.confidence,
  }
}

function inferArea(f: ProductSourceFinding): string {
  if (f.tags.includes("onboarding") || f.tags.includes("init")) return "onboarding"
  if (f.tags.includes("chronicle") || f.tags.includes("commit") || f.tags.includes("proposal")) return "chronicle review"
  if (f.tags.includes("advisor")) return "memory retrieval"
  if (f.tags.includes("sentinel")) return "coverage"
  if (f.tags.includes("compass")) return "product direction"
  if (f.tags.includes("auth")) return "auth"
  if (f.tags.includes("cli")) return "cli"
  return "general"
}

function extractCommand(text: string): string {
  const match = text.match(/`(quorum [^`]+)`/)
  return match?.[1] ?? ""
}
