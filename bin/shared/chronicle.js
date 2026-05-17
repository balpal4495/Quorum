import { promises as fs } from "fs"
import path from "path"

/**
 * Walk up from startDir looking for a .chronicle/ directory.
 * Returns the .chronicle path if found, null otherwise.
 */
export async function findChronicleDir(startDir = process.cwd()) {
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, ".chronicle")
    try {
      const stat = await fs.stat(candidate)
      if (stat.isDirectory()) return candidate
    } catch { /* keep walking */ }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Read all proposal JSON files from .chronicle/proposals/.
 * Returns array of { proposalId, ...entry } objects.
 */
export async function readProposals(chronicleDir) {
  const dir = path.join(chronicleDir, "proposals")
  let files
  try { files = await fs.readdir(dir) } catch { return [] }
  const results = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8")
      results.push({ proposalId: file.replace(".json", ""), ...JSON.parse(raw) })
    } catch { /* skip malformed */ }
  }
  return results
}

/**
 * Read all committed Chronicle entries from .chronicle/committed/.
 * Returns ChronicleEntry array sorted newest-first.
 */
export async function readCommitted(chronicleDir) {
  const dir = path.join(chronicleDir, "committed")
  let files
  try { files = await fs.readdir(dir) } catch { return [] }
  const results = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8")
      results.push(JSON.parse(raw))
    } catch { /* skip malformed */ }
  }
  return results.sort((a, b) => b.timestamp?.localeCompare(a.timestamp ?? "") ?? 0)
}

/**
 * Read all evidence records from .chronicle/evidence/.
 * Returns array sorted newest-first by ingested_at.
 */
export async function readEvidence(chronicleDir) {
  const dir = path.join(chronicleDir, "evidence")
  let files
  try { files = await fs.readdir(dir) } catch { return [] }
  const results = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8")
      results.push(JSON.parse(raw))
    } catch { /* skip malformed */ }
  }
  return results.sort((a, b) =>
    (b.ingested_at ?? "").localeCompare(a.ingested_at ?? ""))
}

/**
 * Read all source records from .chronicle/sources/.
 * Returns array sorted newest-first by ingested_at.
 */
export async function readSources(chronicleDir) {
  const dir = path.join(chronicleDir, "sources")
  let files
  try { files = await fs.readdir(dir) } catch { return [] }
  const results = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(dir, file), "utf8")
      results.push(JSON.parse(raw))
    } catch { /* skip malformed */ }
  }
  return results.sort((a, b) =>
    (b.ingested_at ?? "").localeCompare(a.ingested_at ?? ""))
}

/** entryText mirrors the shared/types.ts entryText helper. */
export function entryText(entry) {
  return `${entry.key_insight}. ${entry.decision ?? ""}`.trim().replace(/\.\.$/, ".")
}

/** Rebuild .chronicle/SUMMARY.md from all committed entries. */
export async function updateSummary(chronicleDir) {
  const SUMMARY_WEEKS = 12
  const DIRECTIVE =
    "<!-- Chronicle Summary v1 — temporal orientation for agents. " +
    "Use for sequence context; query Oracle by entry ID for full reasoning. -->"

  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    const day = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - day)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
  }

  function workRefLabel(entry) {
    if (!entry.work_ref) return "__none__"
    const { type, ref } = entry.work_ref
    return ref ? `[${type} ${ref}]` : `[${type}]`
  }

  function renderEntry(entry) {
    const areas = entry.affected_areas.join(", ")
    const id = entry.id.slice(0, 8)
    return `- **[${id}]** ${areas} — \`${entry.status}\` (${entry.confidence.toFixed(2)}) — ${entryText(entry)}`
  }

  const entries = await readCommitted(chronicleDir)
  if (entries.length === 0) return

  const byWeek = new Map()
  for (const entry of entries) {
    const week = isoWeekKey(new Date(entry.timestamp))
    const bucket = byWeek.get(week) ?? []
    bucket.push(entry)
    byWeek.set(week, bucket)
  }

  const weeks = [...byWeek.keys()].sort().reverse().slice(0, SUMMARY_WEEKS)
  const lines = [DIRECTIVE, ""]

  for (const week of weeks) {
    lines.push(`## Week ${week}`, "")
    const weekEntries = byWeek.get(week)
    const byWork = new Map()
    for (const entry of weekEntries) {
      const key = workRefLabel(entry)
      const bucket = byWork.get(key) ?? []
      bucket.push(entry)
      byWork.set(key, bucket)
    }
    const workKeys = [...byWork.keys()].sort((a, b) =>
      a === "__none__" ? 1 : b === "__none__" ? -1 : a.localeCompare(b))
    for (const key of workKeys) {
      lines.push(key === "__none__"
        ? `### (no work context — query Oracle by entry ID for details)`
        : `### ${key}`)
      for (const entry of byWork.get(key)) lines.push(renderEntry(entry))
      lines.push("")
    }
  }

  await fs.writeFile(path.join(chronicleDir, "SUMMARY.md"), lines.join("\n"), "utf8")
}
