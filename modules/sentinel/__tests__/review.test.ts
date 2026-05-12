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

describe("sentinel/reviewContext", () => {
  let tmpDir: string
  let chronicleDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sentinel-review-"))
    chronicleDir = path.join(tmpDir, ".chronicle")
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("returns a placeholder comment when no files are changed", async () => {
    const result = await reviewContext([], chronicleDir)
    expect(result).toContain("sentinel")
    expect(result).toContain("no changed files")
  })

  it("returns a placeholder comment when changed files are all whitespace", async () => {
    const result = await reviewContext(["  ", ""], chronicleDir)
    expect(result).toContain("no changed files")
  })

  it("includes the sentinel header", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    expect(result).toContain("Sentinel — PR Knowledge Map")
  })

  it("includes a mermaid diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    expect(result).toContain("```mermaid")
    expect(result).toContain("flowchart LR")
    expect(result).toContain("This PR")
  })

  it("shows uncovered module in the diagram when no Chronicle entry exists", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    expect(result).toContain("oracle")
    expect(result).toContain("no entries")
  })

  it("shows covered module with entry count in the diagram", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    expect(result).toContain("oracle")
    expect(result).toContain("1 entry")
  })

  it("groups multiple files from the same module under one module node", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle"]))
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/oracle/query.ts",
    ], chronicleDir)
    const oracleMatches = result.match(/oracle/g) ?? []
    // oracle should appear but as one module group, not two separate nodes
    const diagramSection = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    const nodeLines = diagramSection.split("\n").filter(l => l.includes("oracle"))
    expect(nodeLines).toHaveLength(1)
  })

  it("surfaces Chronicle entries in the 'what Chronicle knows' section", async () => {
    await writeEntry(chronicleDir, makeEntry("abcd1234-0000-0000-0000-000000000000", ["oracle/propose.ts"], {
      key_insight: "schema constraints enforce quality at write time",
      status: "validated",
      confidence: 0.9,
    }))
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    expect(result).toContain("What Chronicle knows")
    expect(result).toContain("[abcd1234]")
    expect(result).toContain("schema constraints enforce quality at write time")
    expect(result).toContain("validated")
    expect(result).toContain("0.90")
  })

  it("surfaces the 'where the path goes dark' section for uncovered modules", async () => {
    const result = await reviewContext(["modules/council/deliberate.ts"], chronicleDir)
    expect(result).toContain("Where the path goes dark")
    expect(result).toContain("council")
    expect(result).toContain("Consider proposing an entry")
  })

  it("shows both zones when some modules are covered and some are not", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle/propose.ts"]))
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/council/deliberate.ts",
    ], chronicleDir)
    expect(result).toContain("What Chronicle knows")
    expect(result).toContain("Where the path goes dark")
  })

  it("shows only covered section when all modules have entries", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle"]))
    await writeEntry(chronicleDir, makeEntry("e2", ["council"]))
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/council/deliberate.ts",
    ], chronicleDir)
    expect(result).toContain("What Chronicle knows")
    expect(result).not.toContain("Where the path goes dark")
  })

  it("shows only dark section when no modules have entries", async () => {
    const result = await reviewContext([
      "modules/council/deliberate.ts",
      "modules/jury/evaluate.ts",
    ], chronicleDir)
    expect(result).not.toContain("What Chronicle knows")
    expect(result).toContain("Where the path goes dark")
  })

  it("extracts module correctly from modules/ prefix", async () => {
    const result = await reviewContext(["modules/jury/evaluate.ts"], chronicleDir)
    expect(result).toContain("jury")
    // module name should be extracted without the modules/ prefix
    expect(result).not.toContain("modules/jury")
  })

  it("extracts module correctly without modules/ prefix", async () => {
    const result = await reviewContext(["oracle/propose.ts"], chronicleDir)
    expect(result).toContain("oracle")
  })

  it("handles root-level files without crashing", async () => {
    const result = await reviewContext(["README.md", "package.json"], chronicleDir)
    expect(result).toContain("Sentinel")
    expect(result).toContain("(root)")
  })

  it("includes the coverage summary line", async () => {
    await writeEntry(chronicleDir, makeEntry("e1", ["oracle"]))
    const result = await reviewContext([
      "modules/oracle/propose.ts",
      "modules/council/deliberate.ts",
    ], chronicleDir)
    expect(result).toContain("1 of 2 modules")
  })

  it("does not include \\n escapes in the mermaid diagram", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    expect(diagram).not.toContain("\\n")
  })

  it("mermaid node IDs contain no special characters", async () => {
    const result = await reviewContext(["modules/oracle/propose.ts"], chronicleDir)
    const diagram = result.split("```mermaid")[1]?.split("```")[0] ?? ""
    const nodeLines = diagram.split("\n").filter(l => l.includes("-->"))
    for (const line of nodeLines) {
      const nodeId = line.match(/-->\s+(\w+)\[/)?.[1]
      if (nodeId) expect(nodeId).toMatch(/^[a-zA-Z0-9_]+$/)
    }
  })
})
