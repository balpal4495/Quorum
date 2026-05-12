import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { coverage } from "../coverage"
import type { ChronicleEntry } from "../../shared/types"

function makeEntry(id: string, areas: string[]): ChronicleEntry {
  return {
    id,
    key_insight: `Insight for ${id}`,
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

async function writeFile(dir: string, relativePath: string): Promise<void> {
  const full = path.join(dir, relativePath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, `// ${relativePath}`, "utf8")
}

describe("sentinel/coverage", () => {
  let tmpDir: string
  let chronicleDir: string
  let codebaseDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-coverage-"))
    chronicleDir = path.join(tmpDir, ".chronicle")
    codebaseDir = path.join(tmpDir, "src")
    await fs.mkdir(codebaseDir, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns zero coverage when no entries exist", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.coveredFiles).toBe(0)
    expect(report.uncoveredFiles).toHaveLength(1)
    expect(report.percentage).toBe(0)
  })

  it("returns zero coverage when no source files exist", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.totalFiles).toBe(0)
    expect(report.percentage).toBe(0)
  })

  it("marks a file as covered when an entry's affected_areas is a substring of its path", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.coveredFiles).toBe(1)
    expect(report.uncoveredFiles).toHaveLength(0)
    expect(report.percentage).toBe(100)
  })

  it("marks a file as uncovered when no entry references it", async () => {
    await writeFile(codebaseDir, "oracle/query.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.coveredFiles).toBe(0)
    expect(report.uncoveredFiles).toContain("oracle/query.ts")
  })

  it("includes matching entry IDs in coverageByFile", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("entry-abc", ["oracle/propose.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    const result = report.coverageByFile.find(f => f.file === "oracle/propose.ts")
    expect(result?.entryIds).toContain("entry-abc")
  })

  it("counts multiple entries covering the same file", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeEntry(chronicleDir, makeEntry("e2", ["oracle/propose.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    const result = report.coverageByFile.find(f => f.file === "oracle/propose.ts")
    expect(result?.entryIds).toHaveLength(2)
  })

  it("reports mixed coverage correctly", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeFile(codebaseDir, "oracle/query.ts")
    await writeFile(codebaseDir, "jury/evaluate.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    await writeEntry(chronicleDir, makeEntry("e2", ["jury/evaluate.ts"]))
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.coveredFiles).toBe(2)
    expect(report.uncoveredFiles).toContain("oracle/query.ts")
    expect(report.percentage).toBe(67)
  })

  it("ignores non-.ts files by default", async () => {
    await writeFile(codebaseDir, "README.md")
    await writeFile(codebaseDir, "oracle/propose.ts")
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.totalFiles).toBe(1)
  })

  it("respects custom extensions option", async () => {
    await writeFile(codebaseDir, "README.md")
    await writeFile(codebaseDir, "oracle/propose.ts")
    const report = await coverage(chronicleDir, codebaseDir, { extensions: [".md"] })
    expect(report.totalFiles).toBe(1)
    expect(report.coverageByFile[0].file).toBe("README.md")
  })

  it("skips node_modules and .chronicle directories", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeFile(path.join(codebaseDir, "node_modules"), "some-lib/index.ts")
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.totalFiles).toBe(1)
  })

  it("handles area as a module prefix covering multiple files", async () => {
    await writeFile(codebaseDir, "oracle/propose.ts")
    await writeFile(codebaseDir, "oracle/query.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle"]))
    const report = await coverage(chronicleDir, codebaseDir)
    expect(report.coveredFiles).toBe(2)
  })
})
