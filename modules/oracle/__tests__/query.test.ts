import { describe, it, expect, vi, beforeEach } from "vitest"
import { query } from "../query"
import type { OracleDeps, VectorStore } from "../types"
import type { ChronicleEntry } from "../../shared/types"

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    timestamp: new Date().toISOString(),
    ...overrides,
  }
}

function mockVectorStore(
  patch: Partial<VectorStore> = {},
): VectorStore {
  return {
    upsert: vi.fn(),
    search: vi.fn().mockResolvedValue([]),
    getAll: vi.fn().mockResolvedValue([]),
    ...patch,
  }
}

function makeDeps(storePatch: Partial<VectorStore> = {}): OracleDeps {
  return {
    embedder: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
    vectorStore: mockVectorStore(storePatch),
    chronicleDir: "/tmp/.chronicle-test-query",
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("oracle/query", () => {
  it("returns empty array when the vector store has no results", async () => {
    const deps = makeDeps()
    const results = await query("test query", {}, deps)
    expect(results).toEqual([])
  })

  it("calls the embedder with the query text", async () => {
    const deps = makeDeps()
    await query("my specific query", {}, deps)
    expect(deps.embedder).toHaveBeenCalledWith("my specific query")
  })

  it("returns results when the vector store has candidates", async () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")]
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue(
        entries.map((entry, i) => ({ entry, score: 1 - i * 0.1 })),
      ),
    })
    const results = await query("test", { scoreThreshold: 0 }, deps)
    expect(results.length).toBe(3)
    expect(results.map(r => r.id)).toContain("a")
  })

  it("drops results below the score threshold", async () => {
    const entries = [makeEntry("a"), makeEntry("b")]
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue(
        entries.map(entry => ({ entry, score: 0.9 })),
      ),
    })
    const results = await query("test", { scoreThreshold: 999 }, deps)
    expect(results).toHaveLength(0)
  })

  it("respects the limit option", async () => {
    const entries = Array.from({ length: 20 }, (_, i) => makeEntry(`id-${i}`))
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue(
        entries.map(entry => ({ entry, score: 0.9 })),
      ),
    })
    const results = await query("test", { limit: 3, scoreThreshold: 0 }, deps)
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it("filters by statusFilter", async () => {
    const entries = [
      makeEntry("a", { status: "validated" }),
      makeEntry("b", { status: "refuted" }),
      makeEntry("c", { status: "open" }),
    ]
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue(
        entries.map(entry => ({ entry, score: 0.9 })),
      ),
    })
    const results = await query(
      "test",
      { statusFilter: ["validated"], scoreThreshold: 0 },
      deps,
    )
    expect(results.every(r => r.status === "validated")).toBe(true)
  })

  it("returns results with a score property", async () => {
    const deps = makeDeps({
      search: vi.fn().mockResolvedValue([
        { entry: makeEntry("x"), score: 0.9 },
      ]),
    })
    const results = await query("test", { scoreThreshold: 0 }, deps)
    expect(typeof results[0].score).toBe("number")
  })

  it("does not throw when query logging fails (best-effort)", async () => {
    // chronicleDir that doesn't exist — log write will fail but query must not
    const deps: OracleDeps = {
      embedder: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
      vectorStore: mockVectorStore({
        search: vi.fn().mockResolvedValue([
          { entry: makeEntry("z"), score: 0.9 },
        ]),
      }),
      chronicleDir: "/this/path/does/not/exist",
    }
    await expect(query("test", { scoreThreshold: 0 }, deps)).resolves.toBeDefined()
  })
})
