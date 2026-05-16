import { promises as fs, Dirent } from "fs"
import path from "path"
import type { ChronicleEntry, CoverageReport, FileCoverage } from "../shared/types.js"

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".chronicle", "coverage", "__tests__"])
const TEST_SUFFIXES = [".test.ts", ".spec.ts", ".test.js", ".spec.js"]

async function walkFiles(
  dir: string,
  extensions: string[],
  excludeTestFiles: boolean,
): Promise<string[]> {
  const results: string[] = []

  async function recurse(current: string): Promise<void> {
    let entries: Dirent<string>[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true, encoding: "utf8" })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await recurse(path.join(current, entry.name))
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        if (excludeTestFiles && TEST_SUFFIXES.some(s => entry.name.endsWith(s))) continue
        results.push(path.join(current, entry.name))
      }
    }
  }

  await recurse(dir)
  return results
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

function isCovered(relativePath: string, entries: ChronicleEntry[]): { covered: boolean; entryIds: string[] } {
  const matched: string[] = []
  const normalised = relativePath.replace(/\\/g, "/")
  for (const entry of entries) {
    const hits = entry.affected_areas.some(area => {
      const normArea = area.replace(/\\/g, "/")
      return normalised.includes(normArea) || normArea.includes(normalised)
    })
    if (hits) matched.push(entry.id)
  }
  return { covered: matched.length > 0, entryIds: matched }
}

/**
 * Scan the codebase and report which files have Chronicle entries referencing
 * them in affected_areas and which do not.
 *
 * Matching is substring-based — "oracle/propose.ts" in affected_areas covers
 * "modules/oracle/propose.ts" in the codebase. Treat percentage as directional
 * signal, not a precision metric.
 */
export async function coverage(
  chronicleDir: string,
  codebasePath: string,
  options: { extensions?: string[]; excludeTestFiles?: boolean } = {},
): Promise<CoverageReport> {
  const extensions = options.extensions ?? [".ts"]
  const excludeTestFiles = options.excludeTestFiles ?? true
  const [entries, files] = await Promise.all([
    readCommittedEntries(chronicleDir),
    walkFiles(codebasePath, extensions, excludeTestFiles),
  ])

  const coverageByFile: FileCoverage[] = files.map(absolute => {
    const relative = path.relative(codebasePath, absolute).replace(/\\/g, "/")
    const { covered, entryIds } = isCovered(relative, entries)
    return { file: relative, covered, entryIds }
  })

  const covered = coverageByFile.filter(f => f.covered)
  const uncovered = coverageByFile.filter(f => !f.covered)

  return {
    totalFiles: files.length,
    coveredFiles: covered.length,
    uncoveredFiles: uncovered.map(f => f.file),
    coverageByFile,
    percentage: files.length === 0 ? 0 : Math.round((covered.length / files.length) * 100),
  }
}
