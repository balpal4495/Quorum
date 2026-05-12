import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { reviewContext } from "../review"
import type { ChronicleEntry } from "../../shared/types"

function makeEntry(id: string, areas: string[], overrides: Partial<ChronicleEntry> = {}): ChronicleEntry {
  return {
    id,
    key_insight: `Insight for ${id}`,
    affected_areas: areas,
    status: "validated",
    confidence: 0.85,
    source_module: "test",
    evidence_cited: [],
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

async function writeEntry(chronicleDir: string, entry: ChronicleEntry): Promise<void> {
  const dir = path.join(chronicleDir, "committed")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${entry.id}.json`), JSON.stringify(entry), "utf8")
}

async function touchFile(codebasePath: string, relPath: string): Promise<void> {
  const full = path.join(codebasePath, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, "// stub\n", "utf8")
}

describe("sentinel/reviewContext", () => {
  let tmpDir: string
  let chronicleDir: string
  let codebasePath: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-review-"))
    chronicleDir = path.join(tmpDir, ".chronicle")
    codebasePath = path.join(tmpDir, "codebase")
    await fs.mkdir(codebasePath, { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns a placeholder comment when no files are changed", async () => {
    const result = await reviewContext([], chronicleDir, codebasePath)
    expect(result).toContain("sentinel")
    expect(result).toContain("no changed files")
  })

  it("returns a placeholder comment when changed files are all whitespace", async () => {
    const result = await reviewContext(["  ", ""], chronicleDir, codebasePath)
    expect(result).toContain("no changed files")
  })

  it("includes the sentinel header with iso week", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toMatch(/Sentinel — Chronicle Coverage Map — \d{4}-W\d{2}/)
  })

  it("includes a mermaid heatmap diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("```mermaid")
    expect(result).toContain("flowchart TD")
    expect(result).toContain("Chronicle[(Chronicle)]")
  })

  it("includes classDef color declarations in the diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    expect(diagram).toContain("classDef high")
    expect(diagram).toContain("classDef medium")
    expect(diagram).toContain("classDef good")
  })

  it("includes the coverage table with correct columns", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("| Module | Coverage | Entries | Files | PR Changes | Risk |")
  })

  it("shows changed module bolded in the table", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("**oracle/**")
  })

  it("shows uncovered changed module with high risk", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const tableLines = result.split("\n").filter(l => l.includes("|") && l.includes("oracle"))
    expect(tableLines).toHaveLength(1)
    expect(tableLines[0]).toContain("high")
  })

  it("applies high risk class to uncovered module in diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    expect(diagram).toContain(":::high")
  })

  it("shows 100% coverage and good risk when all files are covered", async () => {
    await touchFile(codebasePath, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("100%")
    const tableLines = result.split("\n").filter(l => l.includes("|") && l.includes("oracle"))
    expect(tableLines).toHaveLength(1)
    expect(tableLines[0]).toContain("low")
  })

  it("applies good risk class to fully covered module in diagram", async () => {
    await touchFile(codebasePath, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    expect(diagram).toContain(":::good")
  })

  it("groups multiple files from the same module under one table row", async () => {
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/oracle/query.ts",
    ], chronicleDir, codebasePath)
    const tableLines = result.split("\n").filter(l => l.includes("|") && l.includes("oracle"))
    expect(tableLines).toHaveLength(1)
  })

  it("shows PR change count for changed modules", async () => {
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/oracle/query.ts",
    ], chronicleDir, codebasePath)
    expect(result).toContain("**2 files**")
  })

  it("shows dash for PR changes on untouched modules", async () => {
    await touchFile(codebasePath, "council/deliberate.ts")
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const councilRows = result.split("\n").filter(l => l.includes("|") && l.includes("council"))
    expect(councilRows.some(l => l.includes("—"))).toBe(true)
  })

  it("surfaces Chronicle entries in the context section for touched modules", async () => {
    await touchFile(codebasePath, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("abcd1234-0000-0000-0000-000000000000", ["oracle/propose.ts"], {
      key_insight: "schema constraints enforce quality at write time",
      status: "validated",
      confidence: 0.9,
    }))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("Chronicle context for changed modules")
    expect(result).toContain("[abcd1234]")
    expect(result).toContain("schema constraints enforce quality at write time")
    expect(result).toContain("validated")
    expect(result).toContain("0.90")
  })

  it("omits Chronicle context section when no touched modules have entries", async () => {
    const result = await reviewContext(["modules/council/deliberate.ts"], chronicleDir, codebasePath)
    expect(result).not.toContain("Chronicle context for changed modules")
  })

  it("shows context for covered modules and omits it for uncovered", async () => {
    await touchFile(codebasePath, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/council/deliberate.ts",
    ], chronicleDir, codebasePath)
    expect(result).toContain("Chronicle context for changed modules")
    expect(result).toContain("oracle")
    // council has no entry — should not appear in context section
    const contextSection = result.split("### Chronicle context")[1] ?? ""
    expect(contextSection).not.toContain("council")
  })

  it("extracts module correctly from modules/ prefix", async () => {
    const result = await reviewContext(["modules/jury/evaluate.ts"], chronicleDir, codebasePath)
    expect(result).toContain("jury")
    expect(result).not.toContain("modules/jury")
  })

  it("extracts module correctly without modules/ prefix", async () => {
    const result = await reviewContext(["oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("oracle")
  })

  it("handles root-level files without crashing", async () => {
    const result = await reviewContext(["README.md", "package.json"], chronicleDir, codebasePath)
    expect(result).toContain("Sentinel")
    expect(result).toContain("(root)")
  })

  it("does not include \\n escapes in the mermaid diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    expect(diagram).not.toContain("\\n")
  })

  it("mermaid node IDs contain no special characters", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    const nodeLines = diagram.split("\n").filter(l => l.includes("-->"))
    for (const line of nodeLines) {
      const nodeId = line.match(/-->\s+(\w+)\[/)?.[1]
      if (nodeId) expect(nodeId).toMatch(/^[a-zA-Z0-9_]+$/)
    }
  })

  it("shows bootstrap banner when Chronicle has no entries", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).toContain("Chronicle has no entries yet")
    expect(result).toContain("oracle.propose()")
  })

  it("omits bootstrap banner when Chronicle has at least one entry", async () => {
    await touchFile(codebasePath, "oracle/propose.ts")
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir, codebasePath)
    expect(result).not.toContain("Chronicle has no entries yet")
  })
})
