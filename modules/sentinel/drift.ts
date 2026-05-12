import { promises as fs } from "fs"
import path from "path"
import type { ChronicleEntry, DriftFlag, DriftReport, LLMProvider } from "../shared/types"

const FILE_CONTENT_LIMIT = 3000

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

async function resolveLocalFiles(areas: string[], codebasePath: string): Promise<string[]> {
  const resolved: string[] = []
  for (const area of areas) {
    // Try as a direct relative path first
    const candidate = path.join(codebasePath, area)
    try {
      await fs.access(candidate)
      resolved.push(candidate)
      continue
    } catch {
      // not a direct path — try substring search
    }
    // Walk up to two levels to find files whose relative path contains the area string
    try {
      const all = await fs.readdir(codebasePath, { recursive: true } as Parameters<typeof fs.readdir>[1])
      for (const f of all as string[]) {
        const normalised = f.replace(/\\/g, "/")
        if (normalised.includes(area.replace(/\\/g, "/")) && normalised.endsWith(".ts")) {
          resolved.push(path.join(codebasePath, f))
          break
        }
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(resolved)]
}

async function evaluateDrift(
  entry: ChronicleEntry,
  files: Array<{ filePath: string; content: string }>,
  llm: LLMProvider,
): Promise<DriftFlag> {
  const fileSection = files
    .map(f => `### ${path.basename(f.filePath)}\n\`\`\`\n${f.content.slice(0, FILE_CONTENT_LIMIT)}\n\`\`\``)
    .join("\n\n")

  const response = await llm([
    {
      role: "system",
      content:
        "You are a code reviewer checking whether a documented insight still accurately describes the current source code. " +
        "Reply with a JSON object only — no markdown, no explanation outside the object.",
    },
    {
      role: "user",
      content:
        `Documented insight:\n"${entry.key_insight}"\n\n` +
        `Current source:\n${fileSection}\n\n` +
        `Does this insight still accurately describe the code above?\n` +
        `{"stillValid": boolean, "confidence": number, "reasoning": "one sentence"}`,
    },
  ])

  try {
    const match = response.match(/\{[\s\S]*?\}/)
    if (!match) throw new Error("no JSON")
    const parsed = JSON.parse(match[0]) as { stillValid?: unknown; confidence?: unknown; reasoning?: unknown }
    return {
      entryId: entry.id,
      keyInsight: entry.key_insight,
      affectedFiles: files.map(f => f.filePath),
      stillValid: Boolean(parsed.stillValid),
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "no reasoning provided",
    }
  } catch {
    // Parse failure → conservative: flag for human review
    return {
      entryId: entry.id,
      keyInsight: entry.key_insight,
      affectedFiles: files.map(f => f.filePath),
      stillValid: false,
      confidence: 0,
      reasoning: "LLM response could not be parsed — manual review recommended",
    }
  }
}

/**
 * For each Chronicle entry whose affected_areas resolves to at least one local
 * source file, ask the LLM whether the key_insight still accurately describes
 * the current code.
 *
 * Output is strictly advisory — entries are never updated autonomously.
 * Entries where no affected_areas value resolves to a local file are skipped
 * (e.g. entries about external tools, workflows, or conceptual areas).
 */
export async function detectDrift(
  chronicleDir: string,
  codebasePath: string,
  llm: LLMProvider,
): Promise<DriftReport> {
  const entries = await readCommittedEntries(chronicleDir)

  const flags: DriftFlag[] = []
  const confirmed: DriftFlag[] = []
  const skipped: string[] = []

  for (const entry of entries) {
    const localPaths = await resolveLocalFiles(entry.affected_areas, codebasePath)
    if (localPaths.length === 0) {
      skipped.push(entry.id)
      continue
    }

    const files: Array<{ filePath: string; content: string }> = []
    for (const p of localPaths) {
      try {
        const content = await fs.readFile(p, "utf8")
        files.push({ filePath: p, content })
      } catch {
        // file unreadable — skip this path
      }
    }

    if (files.length === 0) {
      skipped.push(entry.id)
      continue
    }

    const result = await evaluateDrift(entry, files, llm)
    if (result.stillValid) {
      confirmed.push(result)
    } else {
      flags.push(result)
    }
  }

  return { checkedAt: new Date().toISOString(), flags, confirmed, skipped }
}
