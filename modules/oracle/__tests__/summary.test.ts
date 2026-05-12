import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { updateSummary } from "../summary"
import type { ChronicleEntry } from "../../shared/types"

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(
  id: string,
  overrides: Partial<ChronicleEntry> = {},
): ChronicleEntry {
  return {
    id,
    key_insight: `Insight for ${id}`,
    affected_areas: ["api"],
    status: "validated",
    confidence: 0.8,
    source_module: "test",
    evidence_cited: [],
    timestamp: new Date("2026-05-12T10:00:00.000Z").toISOString(),
    ...overrides,
  }
}

async function writeEntry(dir: string, entry: ChronicleEntry): Promise<void> {
  const committedDir = path.join(dir, "committed")
  await fs.mkdir(committedDir, { recursive: true })
  await fs.writeFile(
    path.join(committedDir, `${entry.id}.json`),
    JSON.stringify(entry, null, 2),
    "utf8",
  )
}

async function readSummary(dir: string): Promise<string> {
  return fs.readFile(path.join(dir, "SUMMARY.md"), "utf8")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("oracle/summary", () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-summary-test-"))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it("does nothing when committed/ directory does not exist", async () => {
    await expect(updateSummary(tmpDir)).resolves.toBeUndefined()
    const exists = await fs.access(path.join(tmpDir, "SUMMARY.md")).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })

  it("does nothing when committed/ directory is empty", async () => {
    await fs.mkdir(path.join(tmpDir, "committed"), { recursive: true })
    await updateSummary(tmpDir)
    const exists = await fs.access(path.join(tmpDir, "SUMMARY.md")).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })

  it("creates SUMMARY.md when entries exist", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1"))
    await updateSummary(tmpDir)
    const exists = await fs.access(path.join(tmpDir, "SUMMARY.md")).then(() => true).catch(() => false)
    expect(exists).toBe(true)
  })

  it("includes the directive header", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1"))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("Chronicle Summary v1")
    expect(summary).toContain("temporal orientation for agents")
    expect(summary).toContain("query Oracle by entry ID")
  })

  it("groups entries under their ISO week", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1", { timestamp: "2026-05-12T10:00:00.000Z" }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("## Week 2026-W20")
  })

  it("includes entry id prefix, areas, status, confidence, and key_insight", async () => {
    await writeEntry(tmpDir, makeEntry("abcd1234-0000-0000-0000-000000000000", {
      key_insight: "Constructor injection eliminated all database mocks",
      affected_areas: ["services", "api"],
      status: "validated",
      confidence: 0.9,
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("[abcd1234]")
    expect(summary).toContain("services, api")
    expect(summary).toContain("`validated`")
    expect(summary).toContain("(0.90)")
    expect(summary).toContain("Constructor injection eliminated all database mocks")
  })

  it("shows work_ref label when present", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1", {
      work_ref: { type: "pr", ref: "PR #4" },
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("### [pr PR #4]")
  })

  it("shows work_ref type without ref when ref is absent", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1", {
      work_ref: { type: "spike" },
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("### [spike]")
  })

  it("shows no-work-context section for entries without work_ref", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1"))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("(no work context — query Oracle by entry ID for details)")
  })

  it("groups entries by work_ref within the same week", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1", {
      work_ref: { type: "bug", ref: "PROJ-100" },
      timestamp: "2026-05-12T10:00:00.000Z",
    }))
    await writeEntry(tmpDir, makeEntry("entry-2", {
      work_ref: { type: "bug", ref: "PROJ-100" },
      timestamp: "2026-05-12T11:00:00.000Z",
    }))
    await writeEntry(tmpDir, makeEntry("entry-3", {
      work_ref: { type: "pr", ref: "PR #5" },
      timestamp: "2026-05-12T12:00:00.000Z",
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("### [bug PROJ-100]")
    expect(summary).toContain("### [pr PR #5]")
    const bugIdx = summary.indexOf("[bug PROJ-100]")
    const entry1Idx = summary.indexOf("[entry-1]".slice(0, 9))
    const entry2Idx = summary.indexOf("[entry-2]".slice(0, 9))
    // Both entries appear after their shared work_ref heading
    expect(entry1Idx).toBeGreaterThan(bugIdx)
    expect(entry2Idx).toBeGreaterThan(bugIdx)
  })

  it("labelled work groups appear before ungrouped entries", async () => {
    await writeEntry(tmpDir, makeEntry("entry-no-ref"))
    await writeEntry(tmpDir, makeEntry("entry-with-ref", {
      work_ref: { type: "story", ref: "PROJ-42" },
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    const labelledIdx = summary.indexOf("### [story PROJ-42]")
    const ungroupedIdx = summary.indexOf("(no work context")
    expect(labelledIdx).toBeLessThan(ungroupedIdx)
  })

  it("most recent week appears first", async () => {
    await writeEntry(tmpDir, makeEntry("old", { timestamp: "2026-01-05T00:00:00.000Z" }))
    await writeEntry(tmpDir, makeEntry("recent", { timestamp: "2026-05-12T00:00:00.000Z" }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    const w02idx = summary.indexOf("2026-W02")
    const w20idx = summary.indexOf("2026-W20")
    expect(w20idx).toBeLessThan(w02idx)
  })

  it("excludes entries older than 12 weeks from SUMMARY.md", async () => {
    // 2026-05-12 is W20. 12 weeks back = W08 (2026-02-23). W07 and earlier are excluded.
    await writeEntry(tmpDir, makeEntry("old", { timestamp: "2026-01-05T00:00:00.000Z" })) // W01
    await writeEntry(tmpDir, makeEntry("recent", { timestamp: "2026-05-12T00:00:00.000Z" })) // W20
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("2026-W20")
    expect(summary).not.toContain("2026-W01")
  })

  it("skips malformed JSON files without throwing", async () => {
    const committedDir = path.join(tmpDir, "committed")
    await fs.mkdir(committedDir, { recursive: true })
    await fs.writeFile(path.join(committedDir, "bad.json"), "not-json", "utf8")
    await writeEntry(tmpDir, makeEntry("good-entry"))
    await expect(updateSummary(tmpDir)).resolves.toBeUndefined()
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("good-entry".slice(0, 8))
  })

  it("overwrites SUMMARY.md on subsequent calls", async () => {
    await writeEntry(tmpDir, makeEntry("entry-1"))
    await updateSummary(tmpDir)
    await writeEntry(tmpDir, makeEntry("entry-2", {
      work_ref: { type: "pr", ref: "PR #9" },
    }))
    await updateSummary(tmpDir)
    const summary = await readSummary(tmpDir)
    expect(summary).toContain("[pr PR #9]")
  })
})
