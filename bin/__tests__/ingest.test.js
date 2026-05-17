import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "quorum-ingest-"))
}

async function rmrf(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

async function makeChronicle(root) {
  const chronicleDir = path.join(root, ".chronicle")
  await fs.mkdir(chronicleDir, { recursive: true })
  return chronicleDir
}

async function readJsonDir(dir) {
  let files
  try { files = await fs.readdir(dir) } catch { return [] }
  const results = []
  for (const f of files) {
    if (!f.endsWith(".json")) continue
    results.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")))
  }
  return results
}

// ── parseDurationToGitSince ───────────────────────────────────────────────────

import { parseDurationToGitSince } from "../commands/ingest-git.js"

describe("parseDurationToGitSince", () => {
  it("parses P90D to '90 days ago'", () => {
    expect(parseDurationToGitSince("P90D")).toBe("90 days ago")
  })
  it("parses P30D to '30 days ago'", () => {
    expect(parseDurationToGitSince("P30D")).toBe("30 days ago")
  })
  it("parses P1Y to '365 days ago'", () => {
    expect(parseDurationToGitSince("P1Y")).toBe("365 days ago")
  })
  it("parses P6M to '180 days ago'", () => {
    expect(parseDurationToGitSince("P6M")).toBe("180 days ago")
  })
  it("parses P1Y6M to '545 days ago'", () => {
    expect(parseDurationToGitSince("P1Y6M")).toBe("545 days ago")
  })
  it("falls back to '90 days ago' for invalid input", () => {
    expect(parseDurationToGitSince("not-valid")).toBe("90 days ago")
    expect(parseDurationToGitSince("")).toBe("90 days ago")
    expect(parseDurationToGitSince("P")).toBe("90 days ago")
  })
})

// ── ingest command ────────────────────────────────────────────────────────────

import { run as runIngest } from "../commands/ingest.js"
import { findChronicleDir, readEvidence, readSources } from "../shared/chronicle.js"

describe("quorum ingest", () => {
  let tmpDir, chronicleDir, origCwd

  beforeEach(async () => {
    tmpDir = await makeTmpDir()
    chronicleDir = await makeChronicle(tmpDir)
    origCwd = process.cwd()
    process.chdir(tmpDir)
  })

  afterEach(async () => {
    process.chdir(origCwd)
    await rmrf(tmpDir)
  })

  it("ingests a single text file — writes source + evidence records", async () => {
    const file = path.join(tmpDir, "README.md")
    await fs.writeFile(file, "# My Project\n\nAn example project.")

    await runIngest(["README.md"])

    const sources  = await readSources(chronicleDir)
    const evidence = await readEvidence(chronicleDir)

    expect(sources).toHaveLength(1)
    expect(sources[0].type).toBe("file")
    expect(sources[0].ref).toBe("README.md")
    expect(sources[0].content_hash).toMatch(/^sha256:/)

    expect(evidence).toHaveLength(1)
    expect(evidence[0].source_quality).toBe("metadata-derived")
    expect(evidence[0].needs_human_summary).toBe(true)
    expect(evidence[0].confidence).toBe(0.4)
    expect(evidence[0].status).toBe("open")
    expect(evidence[0].source_module).toBe("ingest")
    expect(evidence[0].affected_areas).toContain("README.md")
  })

  it("skips unchanged files on second ingest (content-hash dedup)", async () => {
    const file = path.join(tmpDir, "notes.md")
    await fs.writeFile(file, "# Notes\nSome content.")

    await runIngest(["notes.md"])
    await runIngest(["notes.md"])

    const sources  = await readSources(chronicleDir)
    const evidence = await readEvidence(chronicleDir)
    expect(sources).toHaveLength(1)
    expect(evidence).toHaveLength(1)
  })

  it("writes proposals when --propose flag is set", async () => {
    const file = path.join(tmpDir, "design.md")
    await fs.writeFile(file, "# Design\nDecision records go here.")

    await runIngest(["design.md", "--propose"])

    const proposals = await readJsonDir(path.join(chronicleDir, "proposals"))
    expect(proposals).toHaveLength(1)
    expect(proposals[0].source_quality).toBe("metadata-derived")
    expect(proposals[0].confidence).toBe(0.4)
    expect(proposals[0].needs_human_summary).toBe(true)
    // proposal must NOT contain id or ingested_at (stripped before writing)
    expect(proposals[0].id).toBeUndefined()
    expect(proposals[0].ingested_at).toBeUndefined()
  })

  it("does not write proposals without --propose", async () => {
    const file = path.join(tmpDir, "spec.md")
    await fs.writeFile(file, "# Spec")

    await runIngest(["spec.md"])

    const proposalDir = path.join(chronicleDir, "proposals")
    const files = await fs.readdir(proposalDir).catch(() => [])
    expect(files.filter(f => f.endsWith(".json"))).toHaveLength(0)
  })

  it("skips non-text files but writes a source record without content", async () => {
    // Binary-like file with unsupported extension
    const file = path.join(tmpDir, "icon.png")
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await runIngest(["icon.png"])

    // Should have skipped writing (no TEXT_EXTS match → null content)
    // The command writes evidence regardless, with a fallback summary
    const sources  = await readSources(chronicleDir)
    const evidence = await readEvidence(chronicleDir)
    // .png not in TEXT_EXTS → content null → evidence summary is fallback
    expect(sources).toHaveLength(1)
    expect(evidence[0].key_insight).toContain("icon.png")
  })

  it("walks directories recursively with --recurse", async () => {
    const subDir = path.join(tmpDir, "docs")
    await fs.mkdir(subDir)
    await fs.writeFile(path.join(subDir, "api.md"), "# API")
    await fs.writeFile(path.join(subDir, "guide.md"), "# Guide")

    await runIngest(["docs", "--recurse"])

    const evidence = await readEvidence(chronicleDir)
    expect(evidence).toHaveLength(2)
  })
})

// ── readEvidence / readSources helpers ───────────────────────────────────────

describe("readEvidence and readSources", () => {
  let tmpDir, chronicleDir

  beforeEach(async () => {
    tmpDir = await makeTmpDir()
    chronicleDir = await makeChronicle(tmpDir)
  })

  afterEach(async () => {
    await rmrf(tmpDir)
  })

  it("readEvidence returns empty array when directory does not exist", async () => {
    const result = await readEvidence(chronicleDir)
    expect(result).toEqual([])
  })

  it("readSources returns empty array when directory does not exist", async () => {
    const result = await readSources(chronicleDir)
    expect(result).toEqual([])
  })

  it("readEvidence reads written evidence records", async () => {
    const dir = path.join(chronicleDir, "evidence")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, "abc123.json"),
      JSON.stringify({ id: "abc123", key_insight: "test", ingested_at: "2026-01-01T00:00:00.000Z" }),
    )
    const result = await readEvidence(chronicleDir)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("abc123")
  })

  it("readEvidence skips malformed JSON files", async () => {
    const dir = path.join(chronicleDir, "evidence")
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, "bad.json"), "not json {{{{")
    await fs.writeFile(
      path.join(dir, "good.json"),
      JSON.stringify({ id: "good", key_insight: "ok", ingested_at: "2026-01-01T00:00:00.000Z" }),
    )
    const result = await readEvidence(chronicleDir)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe("good")
  })
})
