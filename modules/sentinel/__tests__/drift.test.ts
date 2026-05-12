import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { detectDrift } from "../drift"
import type { ChronicleEntry, LLMProvider } from "../../shared/types"

function makeEntry(id: string, areas: string[], insight = `Insight for ${id}`): ChronicleEntry {
  return {
    id,
    key_insight: insight,
    affected_areas: areas,
    status: "validated",
    confidence: 0.9,
    source_module: "test",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
  }
}

async function writeEntry(chronicleDir: string, entry: ChronicleEntry): Promise<void> {
  const dir = path.join(chronicleDir, "committed")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${entry.id}.json`), JSON.stringify(entry), "utf8")
}

async function writeSourceFile(dir: string, relativePath: string, content = "// source"): Promise<void> {
  const full = path.join(dir, relativePath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, "utf8")
}

function makeLLM(response: object): LLMProvider {
  return vi.fn().mockResolvedValue(JSON.stringify(response))
}

describe("sentinel/drift", () => {
  let tmpDir: string
  let chronicleDir: string
  let codebaseDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-drift-"))
    chronicleDir = path.join(tmpDir, ".chronicle")
    codebaseDir = path.join(tmpDir, "src")
    await fs.mkdir(codebaseDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("skips entries where no affected_areas resolves to a local file", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["docs", "mermaid", "workflow"]))
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "fine" })
    const report = await detectDrift(chronicleDir, codebaseDir, llm)
    expect(report.skipped).toContain("e1")
    expect(llm).not.toHaveBeenCalled()
  })

  it("calls LLM when an entry has a local file match", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeSourceFile(codebaseDir, "oracle/propose.ts", "// propose")
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "still accurate" })
    await detectDrift(chronicleDir, codebaseDir, llm)
    expect(llm).toHaveBeenCalledOnce()
  })

  it("puts LLM-confirmed entries in confirmed list", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeSourceFile(codebaseDir, "oracle/propose.ts")
    const report = await detectDrift(
      chronicleDir, codebaseDir,
      makeLLM({ stillValid: true, confidence: 0.88, reasoning: "still holds" }),
    )
    expect(report.confirmed).toHaveLength(1)
    expect(report.confirmed[0].entryId).toBe("e1")
    expect(report.flags).toHaveLength(0)
  })

  it("puts LLM-flagged entries in flags list", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeSourceFile(codebaseDir, "oracle/propose.ts")
    const report = await detectDrift(
      chronicleDir, codebaseDir,
      makeLLM({ stillValid: false, confidence: 0.8, reasoning: "function was removed" }),
    )
    expect(report.flags).toHaveLength(1)
    expect(report.flags[0].entryId).toBe("e1")
    expect(report.flags[0].reasoning).toBe("function was removed")
    expect(report.confirmed).toHaveLength(0)
  })

  it("clamps confidence to 0–1 range", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeSourceFile(codebaseDir, "oracle/propose.ts")
    const report = await detectDrift(
      chronicleDir, codebaseDir,
      makeLLM({ stillValid: true, confidence: 1.5, reasoning: "fine" }),
    )
    expect(report.confirmed[0].confidence).toBeLessThanOrEqual(1)
  })

  it("conservatively flags when LLM returns unparseable output", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeSourceFile(codebaseDir, "oracle/propose.ts")
    const llm: LLMProvider = vi.fn().mockResolvedValue("not json at all")
    const report = await detectDrift(chronicleDir, codebaseDir, llm)
    expect(report.flags).toHaveLength(1)
    expect(report.flags[0].stillValid).toBe(false)
    expect(report.flags[0].confidence).toBe(0)
    expect(report.flags[0].reasoning).toContain("could not be parsed")
  })

  it("skips entries whose affected files cannot be read", async () => {
    // Entry references a file that doesn't exist on disk
    await writeEntry(chronicleDir, makeEntry("e1", ["ghost/file.ts"]))
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "fine" })
    const report = await detectDrift(chronicleDir, codebaseDir, llm)
    expect(report.skipped).toContain("e1")
    expect(llm).not.toHaveBeenCalled()
  })

  it("handles empty Chronicle gracefully", async () => {
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "fine" })
    const report = await detectDrift(chronicleDir, codebaseDir, llm)
    expect(report.flags).toHaveLength(0)
    expect(report.confirmed).toHaveLength(0)
    expect(report.skipped).toHaveLength(0)
    expect(llm).not.toHaveBeenCalled()
  })

  it("passes key_insight and file content to the LLM prompt", async () => {
    const insight = "validateEntry enforces minimum length on key_insight"
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"], insight))
    await writeSourceFile(codebaseDir, "oracle/propose.ts", "const INSIGHT_MIN_LENGTH = 20")
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "correct" })
    await detectDrift(chronicleDir, codebaseDir, llm)
    const call = (llm as ReturnType<typeof vi.fn>).mock.calls[0]
    const messages = call[0] as Array<{ role: string; content: string }>
    const userMessage = messages.find(m => m.role === "user")?.content ?? ""
    expect(userMessage).toContain(insight)
    expect(userMessage).toContain("INSIGHT_MIN_LENGTH")
  })

  it("sets checkedAt to a valid ISO timestamp", async () => {
    const llm = makeLLM({ stillValid: true, confidence: 0.9, reasoning: "fine" })
    const report = await detectDrift(chronicleDir, codebaseDir, llm)
    expect(() => new Date(report.checkedAt)).not.toThrow()
    expect(new Date(report.checkedAt).getTime()).toBeGreaterThan(0)
  })
})
