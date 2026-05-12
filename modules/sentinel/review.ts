import { promises as fs } from "fs"
import path from "path"
import type { ChronicleEntry } from "../shared/types"

function extractModule(filePath: string): string {
  const normalised = filePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const stripped = normalised.replace(/^modules\//, "")
  const parts = stripped.split("/")
  return parts.length === 1 ? "(root)" : parts[0]
}

function mermaidSafe(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, "_")
}

function isRelevant(entry: ChronicleEntry, moduleName: string): boolean {
  if (moduleName === "(root)") return false
  return entry.affected_areas.some(area => {
    const norm = area.replace(/\\/g, "/")
    return norm.includes(moduleName) || moduleName.includes(norm)
  })
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

/**
 * Generate a PR-level knowledge map as a markdown string ready to post as a
 * PR comment. Shows the path the PR walks through Chronicle's knowledge:
 *   1. What Chronicle knows about touched modules (context)
 *   2. Where the path goes dark (uncovered modules, framed as invitations)
 *   3. A Mermaid path diagram (renders natively in GitHub PR descriptions)
 *
 * Deterministic — no LLM required. Pass changedFiles from `git diff --name-only`.
 */
export async function reviewContext(
  changedFiles: string[],
  chronicleDir: string,
): Promise<string> {
  const filtered = changedFiles.filter(f => f.trim().length > 0)
  if (filtered.length === 0) return "<!-- sentinel: no changed files -->"

  const entries = await readCommittedEntries(chronicleDir)

  // Group changed files by module
  const moduleFiles = new Map<string, string[]>()
  for (const file of filtered) {
    const mod = extractModule(file)
    const bucket = moduleFiles.get(mod) ?? []
    bucket.push(file)
    moduleFiles.set(mod, bucket)
  }

  const modules = [...moduleFiles.keys()].sort((a, b) =>
    a === "(root)" ? 1 : b === "(root)" ? -1 : a.localeCompare(b),
  )

  // Find relevant Chronicle entries per module
  const moduleEntries = new Map<string, ChronicleEntry[]>()
  for (const mod of modules) {
    moduleEntries.set(mod, entries.filter(e => isRelevant(e, mod)))
  }

  const covered = modules.filter(m => (moduleEntries.get(m)?.length ?? 0) > 0)
  const uncovered = modules.filter(m => (moduleEntries.get(m)?.length ?? 0) === 0)

  const lines: string[] = []

  // ── Header ────────────────────────────────────────────────────────────────
  const coveredCount = covered.length
  const totalModules = modules.length
  lines.push("## Sentinel — PR Knowledge Map")
  lines.push("")
  lines.push(
    `${coveredCount} of ${totalModules} module${totalModules === 1 ? "" : "s"} touched ` +
    `${totalModules === 1 ? "has" : "have"} Chronicle coverage.`,
  )
  lines.push("")

  // ── Mermaid path diagram ──────────────────────────────────────────────────
  lines.push("```mermaid")
  lines.push("flowchart LR")
  lines.push("    PR[This PR]")
  for (const mod of modules) {
    const count = moduleEntries.get(mod)?.length ?? 0
    const nodeId = mermaidSafe(mod)
    const label = count > 0
      ? `${mod} — ${count} ${count === 1 ? "entry" : "entries"}`
      : `${mod} — no entries`
    lines.push(`    PR --> ${nodeId}["${label}"]`)
  }
  lines.push("```")
  lines.push("")

  // ── Zone 1: What Chronicle knows ──────────────────────────────────────────
  if (covered.length > 0) {
    lines.push("### What Chronicle knows about this path")
    lines.push("")
    for (const mod of covered) {
      lines.push(`**${mod}/**`)
      for (const entry of moduleEntries.get(mod)!) {
        const id = entry.id.slice(0, 8)
        const status = entry.status === "validated" ? "validated" :
          entry.status === "refuted" ? "refuted" : "open"
        lines.push(
          `- \`[${id}]\` ${entry.key_insight}`,
        )
        lines.push(
          `  *${status} — confidence ${entry.confidence.toFixed(2)}*`,
        )
      }
      lines.push("")
    }
  }

  // ── Zone 2: Where the path goes dark ──────────────────────────────────────
  if (uncovered.length > 0) {
    lines.push("### Where the path goes dark")
    lines.push("")
    lines.push(
      "These modules have no Chronicle entries. " +
      "Agents working here have no institutional memory to draw on.",
    )
    lines.push("")
    for (const mod of uncovered) {
      const fileCount = moduleFiles.get(mod)!.length
      lines.push(
        `- **${mod}/** — ${fileCount} file${fileCount === 1 ? "" : "s"} changed, ` +
        `no Chronicle coverage. Consider proposing an entry once this lands.`,
      )
    }
    lines.push("")
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push("---")
  lines.push("*Generated by Sentinel — [query Oracle](modules/oracle/) for full reasoning behind each entry*")

  return lines.join("\n")
}
