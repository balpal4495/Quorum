import { promises as fs } from "fs"
import path from "path"
import type { ChronicleEntry } from "../shared/types.js"
import { entryText } from "../shared/types.js"

const SUMMARY_WEEKS = 12
const DIRECTIVE =
  "<!-- Chronicle Summary v1 — temporal orientation for agents. " +
  "Use for sequence context; query Oracle by entry ID for full reasoning. -->"

/**
 * Returns the ISO week string (YYYY-Www) for a given date.
 * Uses the ISO 8601 definition: week 1 is the week containing the first Thursday.
 */
function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`
}

function workRefLabel(entry: ChronicleEntry): string {
  if (!entry.work_ref) return "__none__"
  const { type, ref } = entry.work_ref
  return ref ? `[${type} ${ref}]` : `[${type}]`
}

function renderEntry(entry: ChronicleEntry): string {
  const areas = entry.affected_areas.join(", ")
  const id = entry.id.slice(0, 8)
  return `- **[${id}]** ${areas} — \`${entry.status}\` (${entry.confidence.toFixed(2)}) — ${entryText(entry)}`
}

/**
 * Rebuild .chronicle/SUMMARY.md from all committed entries.
 *
 * Groups entries by ISO week (most-recent first), then by work_ref within
 * each week. Shows the last SUMMARY_WEEKS weeks; older entries are omitted
 * (still fully queryable via Oracle).
 *
 * Called by commit() as a best-effort side-effect — never throws.
 */
export async function updateSummary(chronicleDir: string): Promise<void> {
  const committedDir = path.join(chronicleDir, "committed")

  let files: string[]
  try {
    files = await fs.readdir(committedDir)
  } catch {
    return
  }

  const entries: ChronicleEntry[] = []
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(committedDir, file), "utf8")
      entries.push(JSON.parse(raw) as ChronicleEntry)
    } catch {
      // Skip malformed entries
    }
  }

  if (entries.length === 0) return

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  // Group by ISO week
  const byWeek = new Map<string, ChronicleEntry[]>()
  for (const entry of entries) {
    const week = isoWeekKey(new Date(entry.timestamp))
    const bucket = byWeek.get(week) ?? []
    bucket.push(entry)
    byWeek.set(week, bucket)
  }

  const weeks = [...byWeek.keys()].sort().reverse().slice(0, SUMMARY_WEEKS)

  const lines: string[] = [DIRECTIVE, ""]

  for (const week of weeks) {
    lines.push(`## Week ${week}`, "")

    // Group entries within week by work_ref label
    const weekEntries = byWeek.get(week)!
    const byWork = new Map<string, ChronicleEntry[]>()
    for (const entry of weekEntries) {
      const key = workRefLabel(entry)
      const bucket = byWork.get(key) ?? []
      bucket.push(entry)
      byWork.set(key, bucket)
    }

    // Labelled work groups first, then ungrouped
    const workKeys = [...byWork.keys()].sort((a, b) =>
      a === "__none__" ? 1 : b === "__none__" ? -1 : a.localeCompare(b),
    )

    for (const key of workKeys) {
      if (key === "__none__") {
        lines.push(`### (no work context — query Oracle by entry ID for details)`)
      } else {
        lines.push(`### ${key}`)
      }
      for (const entry of byWork.get(key)!) {
        lines.push(renderEntry(entry))
      }
      lines.push("")
    }
  }

  const summaryPath = path.join(chronicleDir, "SUMMARY.md")
  await fs.writeFile(summaryPath, lines.join("\n"), "utf8")
}
