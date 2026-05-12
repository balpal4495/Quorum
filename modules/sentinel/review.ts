import { promises as fs } from "fs"
import path from "path"
import type { ChronicleEntry } from "../shared/types"
import { coverage as runCoverage } from "./coverage"

function extractModule(filePath: string): string {
  const normalised = filePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const stripped = normalised.replace(/^modules\//, "")
  const parts = stripped.split("/")
  return parts.length === 1 ? "(root)" : parts[0]
}

function mermaidSafe(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, "_")
}

function riskClass(pct: number): "high" | "medium" | "good" {
  if (pct === 0) return "high"
  if (pct < 50) return "medium"
  return "good"
}

function riskLabel(pct: number): string {
  if (pct === 0) return "high"
  if (pct < 50) return "medium"
  return "low"
}

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

async function readCommittedEntries(chronicleDir: string): Promise<ChronicleEntry[]> {
  const committedDir = path.join(chronicleDir, "committed")
  let files: string[]
  try {
    files = await fs.readdir(committedDir)
  } catch {
    return []
  }
  const entries: ChronicleEntry[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(committedDir, file), "utf8")
      entries.push(JSON.parse(raw) as ChronicleEntry)
    } catch {
      // skip malformed
    }
  }
  return entries
}

type ModuleStat = {
  name: string
  totalFiles: number
  coveredFiles: number
  entryIds: string[]
  changedFiles: number
  percentage: number
}

/**
 * Generate a PR-level Chronicle coverage map as a markdown string ready to
 * post as a PR comment.
 *
 * Produces three zones:
 *   1. Coverage table — all modules with coverage %, entry count, file count,
 *      PR delta, and risk. Changed modules are bolded.
 *   2. Heatmap diagram — Chronicle → modules, nodes coloured by risk level,
 *      labels show coverage % and change count in one visual.
 *   3. Chronicle context — entries for touched modules only.
 *
 * Deterministic — no LLM required. Pass changedFiles from `git diff --name-only`.
 */
export async function reviewContext(
  changedFiles: string[],
  chronicleDir: string,
  codebasePath: string,
): Promise<string> {
  const filtered = changedFiles.filter(f => f.trim().length > 0)
  if (filtered.length === 0) return "<!-- sentinel: no changed files -->"

  const [report, allEntries] = await Promise.all([
    runCoverage(chronicleDir, codebasePath),
    readCommittedEntries(chronicleDir),
  ])

  // Count changed files per module
  const changedByModule = new Map<string, number>()
  for (const file of filtered) {
    const mod = extractModule(file)
    changedByModule.set(mod, (changedByModule.get(mod) ?? 0) + 1)
  }

  // Build per-module stats from coverage report
  const moduleStats = new Map<string, ModuleStat>()
  for (const f of report.coverageByFile) {
    const mod = extractModule(f.file)
    const stat = moduleStats.get(mod) ?? {
      name: mod, totalFiles: 0, coveredFiles: 0,
      entryIds: [], changedFiles: changedByModule.get(mod) ?? 0, percentage: 0,
    }
    stat.totalFiles++
    if (f.covered) {
      stat.coveredFiles++
      for (const id of f.entryIds) {
        if (!stat.entryIds.includes(id)) stat.entryIds.push(id)
      }
    }
    moduleStats.set(mod, stat)
  }

  // Include modules only referenced by changedFiles but not in codebase scan
  for (const [mod, count] of changedByModule) {
    if (!moduleStats.has(mod)) {
      moduleStats.set(mod, {
        name: mod, totalFiles: count, coveredFiles: 0,
        entryIds: [], changedFiles: count, percentage: 0,
      })
    }
  }

  for (const stat of moduleStats.values()) {
    stat.percentage = stat.totalFiles === 0
      ? 0
      : Math.round((stat.coveredFiles / stat.totalFiles) * 100)
  }

  const allModules = [...moduleStats.values()].sort((a, b) =>
    a.name === "(root)" ? 1 : b.name === "(root)" ? -1 : a.name.localeCompare(b.name),
  )
  const touchedModules = allModules.filter(m => m.changedFiles > 0)

  const lines: string[] = []
  const week = isoWeekKey(new Date())

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`## Sentinel — Chronicle Coverage Map — ${week}`)
  lines.push("")

  // ── Coverage table ────────────────────────────────────────────────────────
  lines.push("| Module | Coverage | Entries | Files | PR Changes | Risk |")
  lines.push("|--------|----------|---------|-------|------------|------|")
  for (const stat of allModules) {
    const name = stat.changedFiles > 0 ? `**${stat.name}/**` : `${stat.name}/`
    const pct = `${stat.percentage}%`
    const changed = stat.changedFiles > 0 ? `**${stat.changedFiles} files**` : "—"
    lines.push(
      `| ${name} | ${pct} | ${stat.entryIds.length} | ${stat.totalFiles} | ${changed} | ${riskLabel(stat.percentage)} |`,
    )
  }
  lines.push("")

  // ── Heatmap diagram ───────────────────────────────────────────────────────
  lines.push("```mermaid")
  lines.push("flowchart TD")
  lines.push("    classDef high fill:#fca5a5,stroke:#dc2626")
  lines.push("    classDef medium fill:#fde68a,stroke:#d97706")
  lines.push("    classDef good fill:#bbf7d0,stroke:#16a34a")
  lines.push("    Chronicle[(Chronicle)]")
  for (const stat of allModules) {
    const nodeId = mermaidSafe(stat.name)
    const changed = stat.changedFiles > 0 ? ` — ${stat.changedFiles} changed` : ""
    const label = `${stat.name} — ${stat.percentage}%${changed}`
    const cls = riskClass(stat.percentage)
    lines.push(`    Chronicle --> ${nodeId}["${label}"]:::${cls}`)
  }
  lines.push("```")
  lines.push("")

  // ── Chronicle context for touched modules ─────────────────────────────────
  const touchedWithEntries = touchedModules.filter(m => m.entryIds.length > 0)
  if (touchedWithEntries.length > 0) {
    lines.push("### Chronicle context for changed modules")
    lines.push("")
    for (const stat of touchedWithEntries) {
      lines.push(`**${stat.name}/**`)
      const relevant = allEntries.filter(e => stat.entryIds.includes(e.id))
      for (const entry of relevant) {
        lines.push(`- \`[${entry.id.slice(0, 8)}]\` ${entry.key_insight}`)
        lines.push(`  *${entry.status} — confidence ${entry.confidence.toFixed(2)}*`)
      }
      lines.push("")
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push("---")
  lines.push("*Risk: high = 0% coverage, medium = 1-49%, low = 50%+*")

  return lines.join("\n")
}
