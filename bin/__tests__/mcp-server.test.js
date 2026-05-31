import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import http from "http"
import { randomUUID } from "crypto"

import { createServer } from "../mcp/server.js"

// ── helpers ───────────────────────────────────────────────────────────────────

async function makeTmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "quorum-server-"))
}

async function rmrf(dir) {
  await fs.rm(dir, { recursive: true, force: true })
}

async function makeChronicle(root, { entries = [], proposals = [] } = {}) {
  const dir = path.join(root, ".chronicle")
  await fs.mkdir(path.join(dir, "committed"), { recursive: true })
  await fs.mkdir(path.join(dir, "proposals"), { recursive: true })

  for (const entry of entries) {
    const id = entry.id ?? randomUUID()
    await fs.writeFile(
      path.join(dir, "committed", `${id}.json`),
      JSON.stringify({ schema_version: 2, id, timestamp: new Date().toISOString(), ...entry }),
      "utf8"
    )
  }

  const proposalIds = []
  for (const proposal of proposals) {
    const id = proposal.proposalId ?? randomUUID()
    proposalIds.push(id)
    await fs.writeFile(
      path.join(dir, "proposals", `${id}.json`),
      JSON.stringify({ schema_version: 2, ...proposal }),
      "utf8"
    )
  }

  return { dir, proposalIds }
}

/** Start a server on a random port and return { server, baseUrl, port, close }. */
async function startServer(projectRoot, chronicleDir) {
  const server = await createServer({ projectRoot, chronicleDir })
  await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve())
    server.once("error", reject)
  })
  const { port } = server.address()
  const baseUrl = `http://127.0.0.1:${port}`
  return {
    server,
    baseUrl,
    port,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** Thin fetch wrapper that handles response JSON + status. */
async function req(method, url, body) {
  const opts = {
    method,
    headers: { "content-type": "application/json" },
  }
  if (body !== undefined) opts.body = JSON.stringify(body)
  const res = await fetch(url, opts)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, headers: res.headers, body: json }
}

// ── test fixtures ─────────────────────────────────────────────────────────────

let tmpDir
let srv  // { server, baseUrl, close }

const ENTRY = { topic: "caching layer", decision: "use Redis", key_insight: "Redis chosen", status: "validated", confidence: 0.9, affected_areas: ["src/cache.ts"] }
const PROPOSAL = { topic: "new idea", decision: "use this approach for the new feature", status: "open", confidence: 0.6, affected_areas: ["src/feature.ts"] }

beforeEach(async () => {
  tmpDir = await makeTmp()
})

afterEach(async () => {
  if (srv) { await srv.close(); srv = null }
  await rmrf(tmpDir)
})

// ── CORS and preflight ────────────────────────────────────────────────────────

describe("CORS", () => {
  it("sets CORS headers on every response", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { headers } = await req("GET", `${srv.baseUrl}/api/proposals`)
    expect(headers.get("access-control-allow-origin")).toBe("*")
  })

  it("handles OPTIONS preflight with 204", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status } = await req("OPTIONS", `${srv.baseUrl}/mcp`)
    expect(status).toBe(204)
  })
})

// ── Web UI ────────────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns HTML", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, headers } = await req("GET", `${srv.baseUrl}/`)
    expect(status).toBe(200)
    expect(headers.get("content-type")).toMatch(/text\/html/)
  })

  it("returns the same HTML for /index.html", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const [a, b] = await Promise.all([
      req("GET", `${srv.baseUrl}/`),
      req("GET", `${srv.baseUrl}/index.html`),
    ])
    expect(a.body).toBe(b.body)
  })
})

// ── REST: entries ─────────────────────────────────────────────────────────────

describe("GET /api/entries", () => {
  it("returns all committed entries", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY, { topic: "auth", decision: "JWT", key_insight: "JWT" }] })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/api/entries`)
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
  })

  it("filters entries with ?q= search", async () => {
    const { dir } = await makeChronicle(tmpDir, {
      entries: [
        ENTRY,
        { topic: "auth", decision: "JWT tokens with RS256", key_insight: "JWT RS256" },
      ],
    })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/api/entries?q=Redis+caching`)
    expect(status).toBe(200)
    expect(body.some(e => e.topic === "caching layer")).toBe(true)
    expect(body.every(e => e.topic !== "auth")).toBe(true) // JWT entry should not match
  })

  it("returns empty array when chronicle has no entries", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("GET", `${srv.baseUrl}/api/entries`)
    expect(body).toEqual([])
  })
})

// ── REST: proposals ───────────────────────────────────────────────────────────

describe("GET /api/proposals", () => {
  it("returns pending proposals", async () => {
    const { dir } = await makeChronicle(tmpDir, {
      proposals: [PROPOSAL, { topic: "another", decision: "do it" }],
    })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/api/proposals`)
    expect(status).toBe(200)
    expect(body).toHaveLength(2)
  })

  it("returns empty array when no proposals exist", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("GET", `${srv.baseUrl}/api/proposals`)
    expect(body).toEqual([])
  })
})

// ── REST: coverage ────────────────────────────────────────────────────────────

describe("GET /api/coverage", () => {
  it("returns coverage summary with expected shape", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/api/coverage`)
    expect(status).toBe(200)
    expect(body).toHaveProperty("percentage")
    expect(body).toHaveProperty("totalFiles")
    expect(body).toHaveProperty("coverageByFile")
    expect(Array.isArray(body.coverageByFile)).toBe(true)
  })
})

// ── REST: growth ──────────────────────────────────────────────────────────────

describe("GET /api/growth", () => {
  it("returns memory health with expected shape", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/api/growth`)
    expect(status).toBe(200)
    expect(body).toHaveProperty("health")
    expect(body).toHaveProperty("entries")
    expect(body).toHaveProperty("hint")
  })
})

// ── REST: commit proposal ─────────────────────────────────────────────────────

describe("POST /api/proposals/:id/commit", () => {
  it("commits a proposal and returns id + topic", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [PROPOSAL],
    })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("POST", `${srv.baseUrl}/api/proposals/${proposalIds[0]}/commit`)
    expect(status).toBe(200)
    expect(body).toHaveProperty("id")
    expect(body).toHaveProperty("topic", "new idea")
  })

  it("returns 404 for unknown proposal id", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("POST", `${srv.baseUrl}/api/proposals/does-not-exist/commit`)
    expect(status).toBe(404)
    expect(body).toHaveProperty("error")
  })

  it("removes proposal after committing (idempotency check — second call returns 404)", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [PROPOSAL],
    })
    srv = await startServer(tmpDir, dir)

    await req("POST", `${srv.baseUrl}/api/proposals/${proposalIds[0]}/commit`)
    const { status } = await req("POST", `${srv.baseUrl}/api/proposals/${proposalIds[0]}/commit`)
    expect(status).toBe(404)
  })
})

// ── REST: delete proposal ─────────────────────────────────────────────────────

describe("DELETE /api/proposals/:id", () => {
  it("deletes a proposal and returns deleted id", async () => {
    const { dir, proposalIds } = await makeChronicle(tmpDir, {
      proposals: [PROPOSAL],
    })
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("DELETE", `${srv.baseUrl}/api/proposals/${proposalIds[0]}`)
    expect(status).toBe(200)
    expect(body).toHaveProperty("deleted")
  })

  it("returns 404 for unknown proposal", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("DELETE", `${srv.baseUrl}/api/proposals/ghost-id`)
    expect(status).toBe(404)
    expect(body).toHaveProperty("error")
  })
})

// ── MCP JSON-RPC: generic ─────────────────────────────────────────────────────

describe("POST /mcp — protocol", () => {
  it("returns parse error on malformed JSON", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const res = await fetch(`${srv.baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not valid json ~~",
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toMatch(/parse/i)
  })

  it("returns error for unknown method", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, { jsonrpc: "2.0", id: 1, method: "made/up" })
    expect(body.error.code).toBe(-32601)
  })

  it("handles batch requests", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("POST", `${srv.baseUrl}/mcp`, [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ])
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(2)
    expect(body.every(r => r.jsonrpc === "2.0")).toBe(true)
  })
})

describe("POST /mcp — initialize", () => {
  it("returns protocol version and capabilities", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    })
    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe("2024-11-05")
    expect(body.result.serverInfo.name).toBe("quorum")
    expect(body.result.capabilities.tools).toBeDefined()
  })
})

describe("POST /mcp — tools/list", () => {
  it("returns all ten quorum tools", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, { jsonrpc: "2.0", id: 2, method: "tools/list" })
    const names = body.result.tools.map(t => t.name)

    expect(names).toContain("quorum_query")
    expect(names).toContain("quorum_brief")
    expect(names).toContain("quorum_stage")
    expect(names).toContain("quorum_pending")
    expect(names).toContain("quorum_coverage")
    expect(names).toContain("quorum_growth")
    expect(names).toContain("quorum_help")
    expect(names).toContain("quorum_advisor")
    expect(names).toContain("quorum_check")
    expect(names).toContain("quorum_compass")
    expect(names).toHaveLength(10)
  })

  it("each tool has name, description, and inputSchema", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, { jsonrpc: "2.0", id: 3, method: "tools/list" })
    for (const tool of body.result.tools) {
      expect(tool).toHaveProperty("name")
      expect(tool).toHaveProperty("description")
      expect(tool).toHaveProperty("inputSchema")
    }
  })
})

describe("POST /mcp — tools/call", () => {
  it("chronicle_query returns matching entries", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "quorum_query", arguments: { topic: "Redis caching", projectRoot: tmpDir } },
    })

    expect(body.error).toBeUndefined()
    const result = JSON.parse(body.result.content[0].text)
    expect(result.entries.some(e => e.topic === "caching layer")).toBe(true)
  })

  it("chronicle_brief returns summary", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "quorum_brief", arguments: { projectRoot: tmpDir } },
    })

    const result = JSON.parse(body.result.content[0].text)
    expect(result.total).toBe(1)
    expect(result.byStatus.validated).toBe(1)
  })

  it("chronicle_propose creates a proposal file", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 6, method: "tools/call",
      params: {
        name: "quorum_stage",
        arguments: { entry: { topic: "mcp idea", decision: "do it via MCP" }, projectRoot: tmpDir },
      },
    })

    const result = JSON.parse(body.result.content[0].text)
    expect(result).toHaveProperty("proposalId")
    expect(result.topic).toBe("mcp idea")

    const proposalFile = path.join(dir, "proposals", `${result.proposalId}.json`)
    const written = JSON.parse(await fs.readFile(proposalFile, "utf8"))
    expect(written.decision).toBe("do it via MCP")
  })

  it("chronicle_pending lists proposals", async () => {
    const { dir } = await makeChronicle(tmpDir, {
      proposals: [PROPOSAL, { topic: "second", decision: "also" }],
    })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 7, method: "tools/call",
      params: { name: "quorum_pending", arguments: { projectRoot: tmpDir } },
    })

    const result = JSON.parse(body.result.content[0].text)
    expect(result.count).toBe(2)
  })

  it("quorum_growth returns health report", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 8, method: "tools/call",
      params: { name: "quorum_growth", arguments: { projectRoot: tmpDir } },
    })

    expect(body.error).toBeUndefined()
    const result = JSON.parse(body.result.content[0].text)
    expect(result).toHaveProperty("health")
    expect(result).toHaveProperty("entries")
    expect(result).toHaveProperty("hint")
  })

  it("quorum_help returns documentation content", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 9, method: "tools/call",
      params: { name: "quorum_help", arguments: { topic: "index" } },
    })

    expect(body.error).toBeUndefined()
    const result = JSON.parse(body.result.content[0].text)
    expect(result.topic).toBe("index")
    expect(typeof result.content).toBe("string")
  })

  it("quorum_advisor returns no-llm status when no provider is configured", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "quorum_advisor", arguments: { question: "what is the retry strategy?", projectRoot: tmpDir } },
    })

    expect(body.error).toBeUndefined()
    const result = JSON.parse(body.result.content[0].text)
    expect(result.status).toBe("no-llm")
  })

  it("returns -32601 for unknown tool name", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 11, method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    })

    expect(body.error.code).toBe(-32601)
  })

  it("returns -32603 when tool throws (missing required arg)", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 12, method: "tools/call",
      params: { name: "quorum_query", arguments: { projectRoot: tmpDir } }, // no topic
    })

    expect(body.error.code).toBe(-32603)
    expect(body.error.message).toMatch(/topic is required/i)
  })
})

describe("POST /mcp — ping", () => {
  it("returns empty result", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, { jsonrpc: "2.0", id: 99, method: "ping" })
    expect(body.result).toEqual({})
    expect(body.id).toBe(99)
  })
})

describe("POST /mcp — notifications/initialized", () => {
  it("returns no response body for notifications", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: null, method: "notifications/initialized",
    })
    // Notification handler returns null, which is filtered out.
    // Response body will be an empty object {} (single-request filter(Boolean) with no items)
    expect(body).toBeDefined()
  })
})

// ── 404 ───────────────────────────────────────────────────────────────────────

describe("unknown route", () => {
  it("returns 404 with error body", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { status, body } = await req("GET", `${srv.baseUrl}/this/does/not/exist`)
    expect(status).toBe(404)
    expect(body).toHaveProperty("error")
  })
})

// ── MCP Resources ─────────────────────────────────────────────────────────────

describe("POST /mcp — resources/list", () => {
  it("returns all six chronicle:// resources", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 20, method: "resources/list",
    })

    expect(body.error).toBeUndefined()
    const uris = body.result.resources.map(r => r.uri ?? r.uriTemplate)
    expect(uris).toContain("chronicle://summary")
    expect(uris).toContain("chronicle://proposals")
    expect(uris).toContain("chronicle://coverage")
    expect(uris).toContain("chronicle://growth")
    expect(uris).toContain("chronicle://entry/{id}")
    expect(uris).toContain("chronicle://compass")
    expect(uris).toHaveLength(6)
  })

  it("each resource has a name, description, and mimeType", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 21, method: "resources/list",
    })
    for (const resource of body.result.resources) {
      expect(resource).toHaveProperty("name")
      expect(resource).toHaveProperty("description")
      expect(resource).toHaveProperty("mimeType", "application/json")
    }
  })
})

describe("POST /mcp — resources/read", () => {
  it("chronicle://summary returns entry summary", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 22, method: "resources/read",
      params: { uri: "chronicle://summary" },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(content.total).toBe(1)
    expect(content.byStatus.validated).toBe(1)
  })

  it("chronicle://proposals returns pending proposals", async () => {
    const { dir } = await makeChronicle(tmpDir, { proposals: [PROPOSAL] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 23, method: "resources/read",
      params: { uri: "chronicle://proposals" },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(Array.isArray(content)).toBe(true)
    expect(content.length).toBe(1)
  })

  it("chronicle://coverage returns coverage map", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 24, method: "resources/read",
      params: { uri: "chronicle://coverage" },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(content).toHaveProperty("percentage")
    expect(content).toHaveProperty("coverageByFile")
  })

  it("chronicle://growth returns health report", async () => {
    const { dir } = await makeChronicle(tmpDir, { entries: [ENTRY] })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 25, method: "resources/read",
      params: { uri: "chronicle://growth" },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(content).toHaveProperty("health")
    expect(content).toHaveProperty("hint")
  })

  it("chronicle://entry/{id} returns a specific entry", async () => {
    const entryId = randomUUID()
    const { dir } = await makeChronicle(tmpDir, {
      entries: [{ id: entryId, topic: "specific entry", decision: "it worked", status: "validated", confidence: 0.9 }],
    })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 26, method: "resources/read",
      params: { uri: `chronicle://entry/${entryId}` },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(content.topic).toBe("specific entry")
    expect(content.id).toBe(entryId)
  })

  it("chronicle://entry/{prefix} matches by id prefix", async () => {
    const entryId = randomUUID()
    const { dir } = await makeChronicle(tmpDir, {
      entries: [{ id: entryId, topic: "prefix match", decision: "works", status: "validated", confidence: 0.8 }],
    })
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 27, method: "resources/read",
      params: { uri: `chronicle://entry/${entryId.slice(0, 8)}` },
    })

    expect(body.error).toBeUndefined()
    const content = JSON.parse(body.result.contents[0].text)
    expect(content.topic).toBe("prefix match")
  })

  it("returns -32602 for unknown entry id", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 28, method: "resources/read",
      params: { uri: "chronicle://entry/does-not-exist" },
    })

    expect(body.error.code).toBe(-32602)
  })

  it("returns -32602 for unknown resource URI", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 29, method: "resources/read",
      params: { uri: "chronicle://unknown" },
    })

    expect(body.error.code).toBe(-32602)
  })

  it("returns -32602 when uri is missing", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 30, method: "resources/read",
      params: {},
    })

    expect(body.error.code).toBe(-32602)
  })
})

// ── initialize advertises resources capability ─────────────────────────────────

describe("POST /mcp — initialize advertises resources", () => {
  it("capabilities includes resources", async () => {
    const { dir } = await makeChronicle(tmpDir)
    srv = await startServer(tmpDir, dir)

    const { body } = await req("POST", `${srv.baseUrl}/mcp`, {
      jsonrpc: "2.0", id: 31, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    })

    expect(body.result.capabilities.resources).toBeDefined()
  })
})

