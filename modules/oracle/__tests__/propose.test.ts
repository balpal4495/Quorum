import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { propose, commit } from "../propose"
import type { OracleDeps, VectorStore } from "../types"
import type { ChronicleEntry } from "../../shared/types"

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockVectorStore(): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockResolvedValue([]),
  }
}

function makePartialEntry(): Omit<ChronicleEntry, "id" | "timestamp"> {
  return {
    key_insight: "Using dependency injection improves testability in this codebase",
    affected_areas: ["services", "api"],
    status: "open",
    confidence: 0.7,
    source_module: "test",
    evidence_cited: [],
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("oracle/propose + commit", () => {
  let tmpDir: string
  let deps: OracleDeps

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oracle-propose-test-"))
    deps = {
      embedder: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
      vectorStore: mockVectorStore(),
      chronicleDir: tmpDir,
    }
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // ── propose ────────────────────────────────────────────────────────────────

  it("returns a proposalId string", async () => {
    const { proposalId } = await propose(makePartialEntry(), deps)
    expect(typeof proposalId).toBe("string")
    expect(proposalId.length).toBeGreaterThan(0)
  })

  it("writes a JSON file to .chronicle/proposals/<proposalId>.json", async () => {
    const { proposalId } = await propose(makePartialEntry(), deps)
    const proposalPath = path.join(tmpDir, "proposals", `${proposalId}.json`)
    const exists = await fs
      .access(proposalPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(true)
  })

  it("stores the entry fields in the proposal file", async () => {
    const entry = makePartialEntry()
    const { proposalId } = await propose(entry, deps)
    const proposalPath = path.join(tmpDir, "proposals", `${proposalId}.json`)
    const raw = await fs.readFile(proposalPath, "utf8")
    const stored = JSON.parse(raw)
    expect(stored.key_insight).toBe(entry.key_insight)
    expect(stored.status).toBe("open")
    expect(stored.confidence).toBe(0.7)
  })

  it("creates distinct IDs for separate proposals", async () => {
    const { proposalId: id1 } = await propose(makePartialEntry(), deps)
    const { proposalId: id2 } = await propose(makePartialEntry(), deps)
    expect(id1).not.toBe(id2)
  })

  // ── commit ─────────────────────────────────────────────────────────────────

  it("commit returns a ChronicleEntry with id and timestamp", async () => {
    const { proposalId } = await propose(makePartialEntry(), deps)
    const entry = await commit(proposalId, deps)
    expect(typeof entry.id).toBe("string")
    expect(typeof entry.timestamp).toBe("string")
  })

  it("commit calls vectorStore.upsert once", async () => {
    const { proposalId } = await propose(makePartialEntry(), deps)
    await commit(proposalId, deps)
    expect(deps.vectorStore.upsert).toHaveBeenCalledOnce()
  })

  it("commit calls the embedder with key_insight and affected_areas", async () => {
    const entry = makePartialEntry()
    const { proposalId } = await propose(entry, deps)
    await commit(proposalId, deps)
    const embeddingText = [entry.key_insight, ...entry.affected_areas].join(" ")
    expect(deps.embedder).toHaveBeenCalledWith(embeddingText)
  })

  it("commit removes the proposal file after indexing", async () => {
    const { proposalId } = await propose(makePartialEntry(), deps)
    await commit(proposalId, deps)
    const proposalPath = path.join(tmpDir, "proposals", `${proposalId}.json`)
    const exists = await fs
      .access(proposalPath)
      .then(() => true)
      .catch(() => false)
    expect(exists).toBe(false)
  })

  it("commit preserves the original entry fields", async () => {
    const partial = makePartialEntry()
    const { proposalId } = await propose(partial, deps)
    const entry = await commit(proposalId, deps)
    expect(entry.key_insight).toBe(partial.key_insight)
    expect(entry.affected_areas).toEqual(partial.affected_areas)
    expect(entry.status).toBe(partial.status)
  })

  it("commit throws with a clear message if the proposal does not exist", async () => {
    await expect(commit("nonexistent-uuid-1234", deps)).rejects.toThrow(
      "Proposal not found",
    )
  })
})
