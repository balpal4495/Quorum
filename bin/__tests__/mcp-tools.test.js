import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { randomUUID } from "crypto"

import {
  findRelevant,
  toolQuery,
  toolBrief,
  toolStage,
  toolPending,
  toolCoverage,
  toolGrowth,
  toolHelp,
  toolAdvisor,
  toolCheck,
  toolCompass,
  commitProposal,
  deleteProposal,
} from "../mcp/tools.js"

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "quorum-mcp-tools-"))
}

async function rmrf(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

/** Create a minimal chronicle layout under `root` with the given entries + proposals. */
async function makeChronicle(root, { entries = [], proposals = [] } = {}) {
  const dir = path.join(root, ".chronicle")
  const committedDir = path.join(dir, "committed")
  const proposalsDir = path.join(dir, "proposals")
  await fs.mkdir(committedDir, { recursive: true })
  await fs.mkdir(proposalsDir, { recursive: true })

  for (const entry of entries) {
    const id = entry.id ?? randomUUID()
    await fs.writeFile(
      path.join(committedDir, `${id}.json`),
      JSON.stringify({ schema_version: 2, id, timestamp: new Date().toISOString(), ...entry }),
      "utf8"
    )
  }

  const proposalIds = []
  for (const proposal of proposals) {
    const id = proposal.proposalId ?? randomUUID()
    proposalIds.push(id)
    await fs.writeFile(
      path.join(proposalsDir, `${id}.json`),
      JSON.stringify({ schema_version: 2, ...proposal }),
      "utf8"
    )
  }

  return { dir, proposalIds }
}

// ── findRelevant ──────────────────────────────────────────────────────────────

describe("findRelevant", () => {
  const entries = [
    { topic: "retry logic", key_insight: "exponential backoff is preferred", decision: "use exponential backoff for retries", affected_areas: ["modules/oracle"] },
    { topic: "LLM validation", key_insight: "jury validates every design", decision: "jury scores across four dimensions", affected_areas: ["modules/jury"] },
    { topic: "CLI structure", key_insight: "each command lives in its own file", decision: "split commands into bin/commands/", affected_areas: ["bin/commands"] },
    { topic: "unrelated stuff", key_insight: "zzz nothing here", decision: "no overlap", affected_areas: [] },
  ]

  it("returns entries matching the query, highest score first", () => {
    const results = findRelevant(entries, "retry exponential backoff")
    expect(results[0].topic).toBe("retry logic")
  })

  it("filters out entries with zero overlap", () => {
    const results = findRelevant(entries, "retry")
    expect(results.every(e => e.topic !== "unrelated stuff")).toBe(true)
  })

  it("respects the limit parameter", () => {
    const results = findRelevant(entries, "design modules", 2)
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it("returns empty array when nothing matches", () => {
    const results = findRelevant(entries, "xyzzy nonexistent token")
    expect(results).toHaveLength(0)
  })

  it("matches tokens in affected_areas", () => {
    const results = findRelevant(entries, "oracle")
    expect(results.some(e => e.topic === "retry logic")).toBe(true)
  })
})

// ── toolChronicleQuery ────────────────────────────────────────────────────────

describe("toolQuery", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("throws when topic is missing", async () => {
    await makeChronicle(tmpDir)
    await expect(toolQuery({ projectRoot: tmpDir })).rejects.toThrow("topic is required")
  })

  it("throws when no .chronicle directory exists", async () => {
    await expect(
      toolQuery({ topic: "anything", projectRoot: tmpDir })
    ).rejects.toThrow("No .chronicle/ found")
  })

  it("returns matching entries", async () => {
    await makeChronicle(tmpDir, {
      entries: [
        { topic: "caching strategy", decision: "use Redis for caching", key_insight: "Redis caching chosen" },
        { topic: "auth flow", decision: "JWT tokens with RS256", key_insight: "JWT RS256" },
      ],
    })

    const result = await toolQuery({ topic: "Redis caching", projectRoot: tmpDir })

    expect(result.query).toBe("Redis caching")
    expect(result.entries.some(e => e.topic === "caching strategy")).toBe(true)
    expect(result.count).toBeGreaterThan(0)
  })

  it("returns count 0 when no entries match", async () => {
    await makeChronicle(tmpDir, {
      entries: [{ topic: "auth", decision: "JWT", key_insight: "JWT" }],
    })
    const result = await toolQuery({ topic: "xyzzy nonexistent", projectRoot: tmpDir })
    expect(result.count).toBe(0)
    expect(result.entries).toHaveLength(0)
  })
})

// ── toolChronicleBrief ────────────────────────────────────────────────────────

describe("toolBrief", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("returns total and byStatus counts", async () => {
    await makeChronicle(tmpDir, {
      entries: [
        { topic: "a", decision: "d", status: "validated", confidence: 0.9 },
        { topic: "b", decision: "d", status: "validated", confidence: 0.8 },
        { topic: "c", decision: "d", status: "open",      confidence: 0.5 },
        { topic: "d", decision: "d", status: "refuted",   confidence: 0.3 },
      ],
    })

    const result = await toolBrief({ projectRoot: tmpDir })

    expect(result.total).toBe(4)
    expect(result.byStatus.validated).toBe(2)
    expect(result.byStatus.open).toBe(1)
    expect(result.byStatus.refuted).toBe(1)
  })

  it("returns empty result on empty chronicle", async () => {
    await makeChronicle(tmpDir)
    const result = await toolBrief({ projectRoot: tmpDir })
    expect(result.total).toBe(0)
    expect(result.entries).toHaveLength(0)
  })

  it("entry summaries include expected fields", async () => {
    await makeChronicle(tmpDir, {
      entries: [{ topic: "db indexing", decision: "add composite index", key_insight: "composite index", status: "validated", confidence: 0.95, affected_areas: ["db/"] }],
    })

    const result = await toolBrief({ projectRoot: tmpDir })
    const entry  = result.entries[0]

    expect(entry).toHaveProperty("topic", "db indexing")
    expect(entry).toHaveProperty("status", "validated")
    expect(entry).toHaveProperty("confidence", 0.95)
    expect(entry.id).toHaveLength(8)
  })
})

// ── toolChroniclePropose ──────────────────────────────────────────────────────

describe("toolStage", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("throws when entry is missing", async () => {
    await makeChronicle(tmpDir)
    await expect(toolStage({ projectRoot: tmpDir })).rejects.toThrow("entry object is required")
  })

  it("throws when topic is missing", async () => {
    await makeChronicle(tmpDir)
    await expect(
      toolStage({ entry: { decision: "d" }, projectRoot: tmpDir })
    ).rejects.toThrow("entry.topic is required")
  })

  it("writes a proposal file and returns a proposalId", async () => {
    await makeChronicle(tmpDir)
    const result = await toolStage({
      entry: { topic: "new design", decision: "go with option A" },
      projectRoot: tmpDir,
    })

    expect(result).toHaveProperty("proposalId")
    expect(result).toHaveProperty("topic", "new design")

    const proposalPath = path.join(tmpDir, ".chronicle", "proposals", `${result.proposalId}.json`)
    const written = JSON.parse(await fs.readFile(proposalPath, "utf8"))
    expect(written.topic).toBe("new design")
    expect(written.decision).toBe("go with option A")
    expect(written.schema_version).toBe(2)
  })

  it("applies defaults for optional fields", async () => {
    await makeChronicle(tmpDir)
    const { proposalId } = await toolStage({
      entry: { topic: "minimal", decision: "keep it simple" },
      projectRoot: tmpDir,
    })

    const written = JSON.parse(
      await fs.readFile(path.join(tmpDir, ".chronicle", "proposals", `${proposalId}.json`), "utf8")
    )
    expect(written.status).toBe("open")
    expect(written.confidence).toBe(0.7)
    expect(written.source_module).toBe("mcp")
    expect(Array.isArray(written.affected_areas)).toBe(true)
  })
})

// ── toolChroniclePending ──────────────────────────────────────────────────────

describe("toolPending", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("returns 0 proposals on empty proposals dir", async () => {
    await makeChronicle(tmpDir)
    const result = await toolPending({ projectRoot: tmpDir })
    expect(result.count).toBe(0)
    expect(result.proposals).toHaveLength(0)
  })

  it("lists pending proposals with summary fields", async () => {
    await makeChronicle(tmpDir, {
      proposals: [
        { topic: "proposal A", decision: "do A", status: "open", confidence: 0.8, affected_areas: ["src/"] },
        { topic: "proposal B", decision: "do B", status: "open", confidence: 0.6, affected_areas: [] },
      ],
    })

    const result = await toolPending({ projectRoot: tmpDir })

    expect(result.count).toBe(2)
    expect(result.proposals.every(p => p.topic)).toBe(true)
    expect(result.proposals.every(p => "confidence" in p)).toBe(true)
  })
})

// ── toolSentinelCoverage ──────────────────────────────────────────────────────

describe("toolCoverage", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("returns 0% when no source files exist", async () => {
    await makeChronicle(tmpDir)
    const result = await toolCoverage({ projectRoot: tmpDir })
    expect(result.percentage).toBe(0)
    expect(result.totalFiles).toBe(0)
  })

  it("marks a file as covered when it appears in affected_areas", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "main.ts"), "export const x = 1", "utf8")

    await makeChronicle(tmpDir, {
      entries: [
        { topic: "main module", decision: "entry point", key_insight: "entry", affected_areas: ["src/main.ts"] },
      ],
    })

    const result = await toolCoverage({ projectRoot: tmpDir })
    const mainFile = result.coverageByFile.find(f => f.file === "src/main.ts")

    expect(mainFile).toBeDefined()
    expect(mainFile.covered).toBe(true)
    expect(mainFile.entryIds.length).toBeGreaterThan(0)
  })

  it("marks a file as uncovered when absent from all affected_areas", async () => {
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "forgotten.ts"), "export const y = 2", "utf8")
    await makeChronicle(tmpDir)

    const result = await toolCoverage({ projectRoot: tmpDir })
    const file = result.coverageByFile.find(f => f.file === "src/forgotten.ts")

    expect(file.covered).toBe(false)
    expect(file.entryIds).toHaveLength(0)
  })

  it("excludes test files and ignored directories from coverage counts", async () => {
    await fs.mkdir(path.join(tmpDir, "src", "__tests__"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "__tests__", "main.test.ts"), "", "utf8")
    await fs.mkdir(path.join(tmpDir, "dist"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "dist", "main.js"), "", "utf8")
    await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })
    await fs.writeFile(path.join(tmpDir, "src", "util.ts"), "export const z = 3", "utf8")
    await makeChronicle(tmpDir)

    const result = await toolCoverage({ projectRoot: tmpDir })
    const files = result.coverageByFile.map(f => f.file)

    expect(files).not.toContain(path.join("src", "__tests__", "main.test.ts").replace(/\\/g, "/"))
    expect(files).not.toContain(path.join("dist", "main.js").replace(/\\/g, "/"))
    expect(files).toContain("src/util.ts")
  })
})

// ── commitProposal ────────────────────────────────────────────────────────────

describe("commitProposal", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("moves proposal from proposals/ to committed/ and returns id + topic", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [{ topic: "test topic", decision: "use this approach for all new work", affected_areas: ["src/index.ts"] }],
    })

    const result = await commitProposal(proposalIds[0], dir)

    expect(result).toHaveProperty("topic", "test topic")
    expect(result).toHaveProperty("id")

    // proposal file removed
    const remaining = await fs.readdir(path.join(dir, "proposals"))
    expect(remaining.filter(f => f !== ".gitkeep")).toHaveLength(0)

    // committed file exists
    const committed = await fs.readdir(path.join(dir, "committed"))
    expect(committed.some(f => f.endsWith(".json"))).toBe(true)
  })

  it("throws when proposal not found", async () => {
    const { dir } = await makeChronicle(tmpDir)
    await expect(commitProposal("nonexistent-id", dir)).rejects.toThrow("Proposal not found")
  })

  it("committed entry has a fresh id and timestamp", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [{ topic: "timestamped", decision: "validate timestamps on every commit", affected_areas: ["src/index.ts"] }],
    })

    const { id } = await commitProposal(proposalIds[0], dir)

    const files = await fs.readdir(path.join(dir, "committed"))
    const committed = JSON.parse(
      await fs.readFile(path.join(dir, "committed", files[0]), "utf8")
    )

    expect(committed.id).toBe(id)
    expect(committed.timestamp).toBeTruthy()
    expect(new Date(committed.timestamp).getFullYear()).toBeGreaterThanOrEqual(2024)
  })
})

// ── deleteProposal ────────────────────────────────────────────────────────────

describe("deleteProposal", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("deletes the proposal file and returns the id", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [{ topic: "to delete", decision: "reject" }],
    })

    const result = await deleteProposal(proposalIds[0], dir)
    expect(result.deleted).toBe(proposalIds[0])

    const remaining = await fs.readdir(path.join(dir, "proposals"))
    expect(remaining.filter(f => f !== ".gitkeep")).toHaveLength(0)
  })

  it("throws when proposal does not exist", async () => {
    const { dir } = await makeChronicle(tmpDir)
    await expect(deleteProposal("does-not-exist", dir)).rejects.toThrow("Proposal not found")
  })
})

// ── toolGrowth ────────────────────────────────────────────────────────────────

describe("toolGrowth", () => {
  let tmpDir

  beforeEach(async () => { tmpDir = await makeTmp() })
  afterEach(async ()  => { await rmrf(tmpDir) })

  it("returns health=0 on empty chronicle", async () => {
    await makeChronicle(tmpDir)
    const result = await toolGrowth({ projectRoot: tmpDir })
    expect(result.health).toBe(0)
    expect(result.entries.total).toBe(0)
    expect(result.proposals.pending).toBe(0)
  })

  it("returns health 100 for all-validated entries with no pending proposals", async () => {
    await makeChronicle(tmpDir, {
      entries: [
        { topic: "a", decision: "d", status: "validated", confidence: 0.9 },
        { topic: "b", decision: "d", status: "validated", confidence: 0.95 },
      ],
    })
    const result = await toolGrowth({ projectRoot: tmpDir })
    expect(result.health).toBe(100)
    expect(result.entries.byStatus.validated).toBe(2)
    expect(result.entries.avgConfidence).toBeGreaterThan(0)
  })

  it("penalises refuted entries and pending proposals in health score", async () => {
    await makeChronicle(tmpDir, {
      entries: [
        { topic: "a", decision: "d", status: "validated", confidence: 0.9 },
        { topic: "b", decision: "d", status: "refuted",   confidence: 0.2 },
      ],
      proposals: [{ topic: "pending", decision: "p" }],
    })
    const result = await toolGrowth({ projectRoot: tmpDir })
    expect(result.health).toBeLessThan(100)
  })

  it("includes a hint string", async () => {
    await makeChronicle(tmpDir)
    const result = await toolGrowth({ projectRoot: tmpDir })
    expect(typeof result.hint).toBe("string")
    expect(result.hint.length).toBeGreaterThan(0)
  })
})

// ── toolHelp ──────────────────────────────────────────────────────────────────

describe("toolHelp", () => {
  it("returns content for topic=index", async () => {
    const result = await toolHelp({ topic: "index" })
    expect(result.topic).toBe("index")
    expect(typeof result.content).toBe("string")
    expect(result.content.length).toBeGreaterThan(0)
  })

  it("returns content for a known section (oracle)", async () => {
    const result = await toolHelp({ topic: "oracle" })
    expect(result.topic).toBe("oracle")
    expect(typeof result.content).toBe("string")
  })

  it("returns helpful fallback for unknown topic", async () => {
    const result = await toolHelp({ topic: "xyzzy-nonexistent-section" })
    expect(result.content).toMatch(/No section found|quorum_help/i)
  })

  it("defaults to index when called with no topic", async () => {
    const result = await toolHelp({})
    expect(result.topic).toBe("index")
  })
})

// ── LLM-powered tools (no-llm fallback when no provider configured) ───────────

describe("toolAdvisor", () => {
  it("throws when question is missing", async () => {
    await expect(toolAdvisor({})).rejects.toThrow("question is required")
  })

  it("returns status=no-llm with a message when no provider is set", async () => {
    const result = await toolAdvisor({ question: "what was decided about retries?" })
    expect(result.status).toBe("no-llm")
    expect(result.message).toMatch(/quorum advisor/i)
  })
})

describe("toolCheck", () => {
  it("throws when neither outcome nor design is provided", async () => {
    await expect(toolCheck({})).rejects.toThrow("outcome or design is required")
  })

  it("returns preflight and risk when called with outcome and design", async () => {
    const result = await toolCheck({ outcome: "ship safely", design: "use feature flags" })
    expect(result).toHaveProperty("preflight")
    expect(result).toHaveProperty("risk")
  })
})

describe("toolCompass", () => {
  it("returns status=no-llm with a message when no provider is set", async () => {
    const result = await toolCompass({ subcommand: "brief" })
    expect(result.status).toBe("no-llm")
    expect(result.message).toMatch(/quorum compass/i)
  })
})

