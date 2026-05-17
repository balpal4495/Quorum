/**
 * Quorum HTTP server — MCP + Web UI on a single port.
 *
 * Routes:
 *   POST /mcp               MCP Streamable HTTP (JSON-RPC 2.0)
 *   GET  /                  Web UI
 *   GET  /api/entries       All committed entries (+ ?q= search)
 *   GET  /api/proposals     Pending proposals
 *   GET  /api/coverage      Sentinel coverage report
 *   GET  /api/growth        Memory health report
 *   POST /api/proposals/:id/commit   Human-gate: approve a proposal
 *   DELETE /api/proposals/:id        Reject / delete a proposal
 *   POST /api/advisor                Ask a question answered from Chronicle (LLM)
 *   POST /api/check                  Instant risk triage (no LLM)
 *   POST /api/ingest                 Ingest files, git history, or URLs
 *   GET  /api/sentinel/drift         Structural drift check
 *
 * MCP also exposes resources:
 *   chronicle://summary      chronicle://proposals
 *   chronicle://coverage     chronicle://growth
 *   chronicle://entry/{id}
 */
import http from "http"
import path from "path"
import { fileURLToPath } from "url"
import { promises as fs } from "fs"
import { readCommitted, readProposals, findChronicleDir } from "../shared/chronicle.js"
import {
  MCP_TOOLS,
  findRelevant,
  toolBrief,
  toolCoverage,
  toolGrowth,
  toolCompass,
  toolAdvisor,
  toolCheck,
  toolIngest,
  toolSentinelDrift,
  commitProposal,
  deleteProposal,
  updateProposal,
  setLLM,
} from "./tools.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UI_PATH   = path.join(__dirname, "../ui/app.html")

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────

function rpcOk(id, result)  { return { jsonrpc: "2.0", id, result } }
function rpcErr(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } } }

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", c => chunks.push(c))
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch (e) { reject(e) } })
    req.on("error", reject)
  })
}

// ── MCP JSON-RPC dispatcher ───────────────────────────────────────────────────

const TOOL_MAP = Object.fromEntries(MCP_TOOLS.map(t => [t.name, t]))

async function handleMCP(body, defaultProjectRoot) {
  const { method, params = {}, id } = body

  if (method === "initialize") {
    return rpcOk(id, {
      protocolVersion: "2024-11-05",
      capabilities: {
        tools:     { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      serverInfo: { name: "quorum", version: "1.0.0" },
    })
  }

  if (method === "notifications/initialized") {
    return null // no response for notifications
  }

  if (method === "tools/list") {
    return rpcOk(id, {
      tools: MCP_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    })
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params
    const tool = TOOL_MAP[name]
    if (!tool) return rpcErr(id, -32601, `Unknown tool: ${name}`)

    // Inject default projectRoot if not provided
    const callArgs = { projectRoot: defaultProjectRoot, ...args }
    try {
      const result = await tool.fn(callArgs)
      return rpcOk(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      })
    } catch (err) {
      return rpcErr(id, -32603, err.message)
    }
  }

  if (method === "resources/list") {
    return rpcOk(id, {
      resources: [
        {
          uri:         "chronicle://summary",
          name:        "Chronicle summary",
          description: "Full status summary of all committed Chronicle entries.",
          mimeType:    "application/json",
        },
        {
          uri:         "chronicle://proposals",
          name:        "Pending proposals",
          description: "All Chronicle proposals awaiting human approval.",
          mimeType:    "application/json",
        },
        {
          uri:         "chronicle://coverage",
          name:        "Sentinel coverage",
          description: "Chronicle coverage map for source files in the project.",
          mimeType:    "application/json",
        },
        {
          uri:         "chronicle://growth",
          name:        "Memory health",
          description: "Chronicle health score, entry counts, and guidance.",
          mimeType:    "application/json",
        },
        {
          uri:         "chronicle://compass",
          name:        "Compass product direction",
          description: "Latest Compass map: behaviours, gaps, and opportunities detected from the codebase.",
          mimeType:    "application/json",
        },
        {
          uriTemplate: "chronicle://entry/{id}",
          name:        "Chronicle entry",
          description: "A single committed Chronicle entry by id or 8-char prefix.",
          mimeType:    "application/json",
        },
      ],
    })
  }

  if (method === "resources/read") {
    const { uri } = params
    if (!uri) return rpcErr(id, -32602, "uri is required")

    if (uri === "chronicle://summary") {
      const result = await toolBrief({ projectRoot: defaultProjectRoot })
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] })
    }

    if (uri === "chronicle://proposals") {
      const chronicleDir = await findChronicleDir(defaultProjectRoot)
      if (!chronicleDir) return rpcErr(id, -32603, "No .chronicle/ found")
      const proposals = await readProposals(chronicleDir)
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(proposals, null, 2) }] })
    }

    if (uri === "chronicle://coverage") {
      const result = await toolCoverage({ projectRoot: defaultProjectRoot })
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] })
    }

    if (uri === "chronicle://growth") {
      const result = await toolGrowth({ projectRoot: defaultProjectRoot })
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] })
    }

    if (uri === "chronicle://compass") {
      const result = await toolCompass({ subcommand: "map", projectRoot: defaultProjectRoot })
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(result, null, 2) }] })
    }

    // chronicle://entry/{id}
    const entryMatch = uri.match(/^chronicle:\/\/entry\/(.+)$/)
    if (entryMatch) {
      const entryId = decodeURIComponent(entryMatch[1])
      const chronicleDir = await findChronicleDir(defaultProjectRoot)
      if (!chronicleDir) return rpcErr(id, -32603, "No .chronicle/ found")
      const entries = await readCommitted(chronicleDir)
      const entry = entries.find(e => e.id === entryId || (e.id ?? "").startsWith(entryId))
      if (!entry) return rpcErr(id, -32602, `Entry not found: ${entryId}`)
      return rpcOk(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(entry, null, 2) }] })
    }

    return rpcErr(id, -32602, `Unknown resource URI: ${uri}`)
  }

  if (method === "ping") {
    return rpcOk(id, {})
  }

  return rpcErr(id, -32601, `Method not found: ${method}`)
}

// ── REST API helpers ──────────────────────────────────────────────────────────

function json(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) })
  res.end(body)
}

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function createServer({ projectRoot, chronicleDir, llm = null }) {
  // Wire LLM into tools module so advisor/check/compass MCP tools work
  setLLM(llm)
  let uiHtml
  try {
    uiHtml = await fs.readFile(UI_PATH, "utf8")
  } catch {
    uiHtml = "<html><body><pre>UI not found. Run from the quorum package directory.</pre></body></html>"
  }

  const server = http.createServer(async (req, res) => {
    setCORS(res)
    const url = new URL(req.url, `http://localhost`)
    const { pathname } = url

    // Preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204)
      return res.end()
    }

    try {
      // ── MCP endpoint ────────────────────────────────────────────────────────
      if (pathname === "/mcp" && req.method === "POST") {
        let body
        try { body = await readBody(req) } catch {
          const errBody = JSON.stringify(rpcErr(null, -32700, "Parse error"))
          res.writeHead(400, { "content-type": "application/json" })
          return res.end(errBody)
        }

        // Support both single request and batch
        const isBatch = Array.isArray(body)
        const requests = isBatch ? body : [body]
        const responses = (await Promise.all(requests.map(r => handleMCP(r, projectRoot)))).filter(Boolean)
        const responseBody = JSON.stringify(isBatch ? responses : responses[0] ?? {})
        res.writeHead(200, { "content-type": "application/json" })
        return res.end(responseBody)
      }

      // ── REST: entries ───────────────────────────────────────────────────────
      if (pathname === "/api/entries" && req.method === "GET") {
        const q = url.searchParams.get("q")
        const entries = await readCommitted(chronicleDir)
        const results = q ? findRelevant(entries, q, 20) : entries
        return json(res, 200, results)
      }

      // ── REST: proposals list ────────────────────────────────────────────────
      if (pathname === "/api/proposals" && req.method === "GET") {
        const proposals = await readProposals(chronicleDir)
        return json(res, 200, proposals)
      }

      // ── REST: coverage ──────────────────────────────────────────────────────
      if (pathname === "/api/coverage" && req.method === "GET") {
        const result = await toolCoverage({ projectRoot })
        return json(res, 200, result)
      }

      // ── REST: growth ────────────────────────────────────────────────────────
      if (pathname === "/api/growth" && req.method === "GET") {
        const result = await toolGrowth({ projectRoot })
        return json(res, 200, result)
      }

      // ── REST: commit proposal (human-gate) ──────────────────────────────────
      const commitMatch = pathname.match(/^\/api\/proposals\/([^/]+)\/commit$/)
      if (commitMatch && req.method === "POST") {
        try {
          const result = await commitProposal(commitMatch[1], chronicleDir)
          return json(res, 200, result)
        } catch (err) {
          return json(res, 404, { error: err.message })
        }
      }

      // ── REST: reject/delete proposal ────────────────────────────────────────
      const proposalMatch = pathname.match(/^\/api\/proposals\/([^/]+)$/)
      if (proposalMatch && req.method === "DELETE") {
        try {
          const result = await deleteProposal(proposalMatch[1], chronicleDir)
          return json(res, 200, result)
        } catch (err) {
          return json(res, 404, { error: err.message })
        }
      }

      // ── REST: edit/patch proposal ───────────────────────────────────────────
      if (proposalMatch && req.method === "PATCH") {
        try {
          const body   = await readBody(req)
          const result = await updateProposal(proposalMatch[1], body, chronicleDir)
          return json(res, 200, result)
        } catch (err) {
          return json(res, 400, { error: err.message })
        }
      }

      // ── REST: compass ───────────────────────────────────────────────────────
      if (pathname === "/api/compass" && req.method === "GET") {
        const subcommand = new URL(req.url, "http://localhost").searchParams.get("subcommand") ?? "map"
        const result = await toolCompass({ subcommand, projectRoot })
        return json(res, 200, result)
      }

      // ── REST: advisor ───────────────────────────────────────────────────────
      if (pathname === "/api/advisor" && req.method === "POST") {
        const body = await readBody(req)
        const result = await toolAdvisor({ question: body.question, projectRoot })
        return json(res, 200, result)
      }

      // ── REST: check ─────────────────────────────────────────────────────────
      if (pathname === "/api/check" && req.method === "POST") {
        const body = await readBody(req)
        const result = await toolCheck({ outcome: body.outcome ?? "", design: body.design ?? "", projectRoot })
        return json(res, 200, result)
      }

      // ── REST: ingest ────────────────────────────────────────────────────────
      if (pathname === "/api/ingest" && req.method === "POST") {
        const body = await readBody(req)
        const result = await toolIngest({ ...body, projectRoot })
        return json(res, 200, result)
      }

      // ── REST: sentinel drift ────────────────────────────────────────────────
      if (pathname === "/api/sentinel/drift" && req.method === "GET") {
        const result = await toolSentinelDrift({ projectRoot })
        return json(res, 200, result)
      }

      // ── Web UI ──────────────────────────────────────────────────────────────
      if ((pathname === "/" || pathname === "/index.html") && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        return res.end(uiHtml)
      }

      // 404
      json(res, 404, { error: "Not found" })
    } catch (err) {
      json(res, 500, { error: err.message })
    }
  })

  return server
}
