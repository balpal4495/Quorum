import { randomUUID } from "crypto"
import type {
  ProductBehavior, ProductBehaviorGap, ProductBehaviorContradiction, BehaviorMap,
  BehaviorMapInput, ProductSourceFinding, CompassEvidenceRef,
} from "./types.js"

// ── Deterministic behaviour mapping from source findings ─────────────────────

export function mapBehaviorsFromFindings(
  findings: ProductSourceFinding[],
  input: BehaviorMapInput = {},
): BehaviorMap {
  const behaviors: ProductBehavior[] = []
  const gaps: ProductBehaviorGap[] = []
  const contradictions: ProductBehaviorContradiction[] = []

  // CLI command behaviors
  for (const f of findings.filter(f => f.kind === "cli")) {
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

  // Web route behaviors (code findings with "route" tag)
  for (const f of findings.filter(f => f.kind === "code" && f.tags.includes("route"))) {
    behaviors.push({
      id: `behavior-route-${f.id}`,
      area: inferArea(f),
      name: f.title,
      description: f.summary,
      current_behavior: f.summary,
      evidence: [findingToRef(f)],
      basis: ["implemented"],
      confidence: f.confidence,
    })
  }

  // Documented feature headings (deduplicated, limited to reduce noise)
  const codeNames = new Set(behaviors.map(b => b.name.toLowerCase()))
  for (const f of findings.filter(f => f.kind === "docs").slice(0, 20)) {
    const titleLower = f.title.toLowerCase()
    if ([...codeNames].some(n => n.includes(titleLower.slice(0, 15)) || titleLower.includes(n.slice(0, 15)))) continue
    behaviors.push({
      id: `behavior-docs-${f.id}`,
      area: inferArea(f),
      name: f.title,
      description: f.summary,
      current_behavior: f.summary,
      evidence: [findingToRef(f)],
      basis: ["documented"],
      confidence: f.confidence * 0.7,
    })
    codeNames.add(titleLower)
  }

  // Dynamic gap detection: documented areas with no implemented artifact
  const implementedAreas = new Set(
    behaviors.filter(b => b.basis[0] === "implemented").map(b => b.area),
  )
  const docAreas = behaviors.filter(b => b.basis[0] === "documented").map(b => b.area)
  for (const docArea of new Set(docAreas)) {
    if (!implementedAreas.has(docArea) && docArea !== "general") {
      gaps.push({
        id: `gap-${docArea}`,
        area: docArea,
        gap: `'${docArea}' is documented but no corresponding route, command, or source module was found.`,
        why_it_matters: "May indicate planned-but-unbuilt functionality.",
        evidence: [],
        confidence: 0.6,
      })
    }
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
  // Route findings: derive area from the route path segments
  if (f.tags.includes("route") && f.path) {
    const parts = f.path.split("/").filter(p =>
      p && !p.startsWith("(") && !p.startsWith("[") &&
      !["app", "pages", "src", "route", "page", "index"].includes(p),
    )
    if (parts.length) return parts[0]
  }
  // Domain-specific tags take priority
  const DOMAIN = ["auth", "payments", "database", "onboarding", "api", "llm", "config", "webhook", "middleware", "pii", "deploy"]
  const domain = f.tags.find(t => DOMAIN.includes(t))
  if (domain) return domain
  // First non-infrastructure tag
  const SKIP = new Set(["cli", "command", "code", "source", "directory", "module", "docs", "route", "page", "ui", "package", "identity", "description", "binary", "exports", "dependencies", "testing", "guaranteed-behavior", "workflow", "ci", "test"])
  return f.tags.find(t => !SKIP.has(t) && !t.startsWith("subcommand:")) ?? "general"
}
