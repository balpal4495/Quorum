import type { OracleClient, OracleResult } from "../../shared/types"
import type { CompassEvidenceRef, ProductBearing, ProductSource, ProductSourceFinding } from "../types"
import { randomUUID } from "crypto"

// ── Bearings from Chronicle ───────────────────────────────────────────────────

export async function collectBearings(
  oracle: OracleClient,
  area?: string,
): Promise<ProductBearing[]> {
  const queries = [
    area ?? "product direction goals decisions",
    "rejected approaches refuted alternatives",
    "constraints scope out-of-scope",
  ]

  const seen = new Set<string>()
  const bearings: ProductBearing[] = []

  for (const q of queries) {
    let results: OracleResult[]
    try { results = await oracle.query(q, { limit: 8 }) } catch { continue }

    for (const entry of results) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)

      const text = entry.decision ?? entry.key_insight
      bearings.push({
        id: `bearing-${entry.id.slice(0, 8)}`,
        title: entry.topic ?? text.slice(0, 60),
        summary: text,
        area: entry.scope?.[0],
        evidence: [
          {
            id: randomUUID().slice(0, 8),
            kind: "chronicle",
            source: ".chronicle/committed",
            entry_id: entry.id,
            summary: text,
            confidence: entry.confidence,
          },
        ],
        confidence: entry.confidence,
      })
    }
  }

  return bearings
}

// ── Terrain from source scanners ──────────────────────────────────────────────

export interface TerrainResult {
  findings: ProductSourceFinding[]
  evidenceRefs: CompassEvidenceRef[]
}

export async function collectTerrain(
  sources: ProductSource[],
  rootDir: string,
  area?: string,
): Promise<TerrainResult> {
  const allFindings: ProductSourceFinding[] = []

  for (const source of sources) {
    const found = await source.scan({ rootDir, area })
    allFindings.push(...found)
  }

  const evidenceRefs: CompassEvidenceRef[] = allFindings.map(f => ({
    id: f.id,
    kind: f.kind,
    source: f.source,
    path: f.path,
    line: f.line,
    summary: f.summary,
    confidence: f.confidence,
  }))

  return { findings: allFindings, evidenceRefs }
}

// ── Format helpers for LLM prompts ───────────────────────────────────────────

export function formatBearingsForPrompt(bearings: ProductBearing[]): string {
  if (bearings.length === 0) return "No Chronicle entries found."
  return bearings
    .map(b => `[${b.id}] (confidence: ${b.confidence.toFixed(2)}) ${b.summary}`)
    .join("\n")
}

export function formatTerrainForPrompt(findings: ProductSourceFinding[], limit = 40): string {
  if (findings.length === 0) return "No product behaviour found in sources."

  // Group by kind
  const groups: Record<string, ProductSourceFinding[]> = {}
  for (const f of findings.slice(0, limit)) {
    groups[f.kind] = groups[f.kind] ?? []
    groups[f.kind].push(f)
  }

  return Object.entries(groups)
    .map(([kind, items]) => {
      const lines = items.slice(0, 10).map(i => `  - ${i.title}: ${i.summary.slice(0, 100)}`)
      return `${kind.toUpperCase()}:\n${lines.join("\n")}`
    })
    .join("\n\n")
}
