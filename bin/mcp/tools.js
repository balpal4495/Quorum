/**
 * Quorum MCP tool definitions — pure logic, no HTTP.
 * Shared between the MCP JSON-RPC handler and the REST API used by the UI.
 */
import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { findChronicleDir, readCommitted, readProposals, updateSummary } from "../shared/chronicle.js"

// ── BM25-lite search ──────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
}

function scoreEntry(query, entry) {
  const qTokens = new Set(tokenize(query))
  const text = [
    entry.key_insight ?? "",
    entry.decision    ?? "",
    entry.topic       ?? "",
    ...(entry.affected_areas ?? []),
    ...(entry.scope          ?? []),
  ].join(" ")
  const eTokens = tokenize(text)
  const overlap = eTokens.filter(t => qTokens.has(t)).length
  return overlap / Math.sqrt(qTokens.size * eTokens.length + 1)
}

export function findRelevant(entries, query, limit = 8) {
  return entries
    .map(e => ({ entry: e, score: scoreEntry(query, e) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

// ── File-tree coverage ────────────────────────────────────────────────────────

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".chronicle", "coverage", "__tests__"])
const TEST_SUFFIXES = [".test.ts", ".spec.ts", ".test.js", ".spec.js"]
const EXTENSIONS    = [".ts", ".js"]

async function walkFiles(dir) {
  const results = []
  async function recurse(current) {
    let entries
    try { entries = await fs.readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await recurse(path.join(current, entry.name))
        }
      } else if (EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
        if (TEST_SUFFIXES.some(s => entry.name.endsWith(s))) continue
        results.push(path.join(current, entry.name))
      }
    }
  }
  await recurse(dir)
  return results
}

function isCovered(relativePath, entries) {
  const normalised = relativePath.replace(/\\/g, "/")
  const entryIds = []
  for (const entry of entries) {
    const hits = (entry.affected_areas ?? []).some(area => {
      const normArea = area.replace(/\\/g, "/")
      return normalised.includes(normArea) || normArea.includes(normalised)
    })
    if (hits) entryIds.push(entry.id)
  }
  return { covered: entryIds.length > 0, entryIds }
}

// ── Tool functions ────────────────────────────────────────────────────────────

/**
 * Resolve project root: explicit arg > cwd.
 * Returns { projectRoot, chronicleDir } or throws if no .chronicle found.
 */
async function resolve(projectRoot) {
  const root = projectRoot ?? process.cwd()
  const chronicleDir = await findChronicleDir(root)
  if (!chronicleDir) throw new Error(`No .chronicle/ found from ${root}. Run quorum init first.`)
  return { projectRoot: root, chronicleDir }
}

export async function toolChronicleQuery({ topic, projectRoot } = {}) {
  if (!topic) throw new Error("topic is required")
  const { chronicleDir } = await resolve(projectRoot)
  const entries = await readCommitted(chronicleDir)
  const results = findRelevant(entries, topic, 8)
  return { query: topic, count: results.length, entries: results }
}

export async function toolChronicleBrief({ projectRoot } = {}) {
  const { chronicleDir } = await resolve(projectRoot)
  const entries = await readCommitted(chronicleDir)
  const byStatus = { validated: 0, open: 0, refuted: 0, other: 0 }
  for (const e of entries) {
    const k = e.status === "validated" || e.status === "open" || e.status === "refuted"
      ? e.status : "other"
    byStatus[k]++
  }
  return {
    total: entries.length,
    byStatus,
    entries: entries.slice(0, 50).map(e => ({
      id:           (e.id ?? "").slice(0, 8),
      topic:        e.topic,
      decision:     e.decision ?? e.key_insight,
      status:       e.status,
      confidence:   e.confidence,
      affected_areas: e.affected_areas,
      timestamp:    e.timestamp,
    })),
  }
}

export async function toolChroniclePropose({ entry, projectRoot } = {}) {
  if (!entry) throw new Error("entry object is required")
  const required = ["topic", "decision"]
  for (const k of required) {
    if (!entry[k]) throw new Error(`entry.${k} is required`)
  }
  const { chronicleDir } = await resolve(projectRoot)
  const proposalId = randomUUID()
  const proposal = {
    schema_version: 2,
    topic:      entry.topic,
    decision:   entry.decision,
    key_insight: entry.key_insight ?? entry.decision,
    affected_areas: entry.affected_areas ?? [],
    scope:      entry.scope ?? [],
    alternatives_considered: entry.alternatives_considered ?? [],
    rejected_reason: entry.rejected_reason ?? [],
    status:     entry.status ?? "open",
    confidence: entry.confidence ?? 0.7,
    source_module: entry.source_module ?? "mcp",
    evidence_cited: entry.evidence_cited ?? [],
    work_ref:   entry.work_ref ?? null,
  }
  const proposalPath = path.join(chronicleDir, "proposals", `${proposalId}.json`)
  await fs.mkdir(path.join(chronicleDir, "proposals"), { recursive: true })
  await fs.writeFile(proposalPath, JSON.stringify(proposal, null, 2), "utf8")
  return { proposalId, topic: proposal.topic }
}

export async function toolChroniclePending({ projectRoot } = {}) {
  const { chronicleDir } = await resolve(projectRoot)
  const proposals = await readProposals(chronicleDir)
  return {
    count: proposals.length,
    proposals: proposals.map(p => ({
      id:           p.proposalId,
      topic:        p.topic,
      decision:     p.decision ?? p.key_insight,
      status:       p.status,
      confidence:   p.confidence,
      affected_areas: p.affected_areas,
    })),
  }
}

export async function toolSentinelCoverage({ projectRoot } = {}) {
  const { projectRoot: root, chronicleDir } = await resolve(projectRoot)
  const [entries, files] = await Promise.all([
    readCommitted(chronicleDir),
    walkFiles(root),
  ])

  const coverageByFile = files.map(absolute => {
    const relative = path.relative(root, absolute).replace(/\\/g, "/")
    const { covered, entryIds } = isCovered(relative, entries)
    return { file: relative, covered, entryIds }
  })

  const coveredFiles   = coverageByFile.filter(f => f.covered)
  const uncoveredFiles = coverageByFile.filter(f => !f.covered)
  const percentage     = files.length === 0 ? 0
    : Math.round((coveredFiles.length / files.length) * 100)

  return { percentage, totalFiles: files.length, coveredFiles: coveredFiles.length, coverageByFile }
}

// ── Proposal commit (human-gate action — only callable from UI, not MCP AI tools) ──

export async function commitProposal(proposalId, chronicleDir) {
  const proposalsDir = path.join(chronicleDir, "proposals")
  const files = await fs.readdir(proposalsDir).catch(() => [])
  const match = files.find(f => f === `${proposalId}.json` || f.startsWith(proposalId))
  if (!match) throw new Error(`Proposal not found: ${proposalId}`)

  const proposalPath = path.join(proposalsDir, match)
  const raw  = await fs.readFile(proposalPath, "utf8")
  const partial = JSON.parse(raw)

  const entry = { ...partial, id: randomUUID(), timestamp: new Date().toISOString() }
  const committedPath = path.join(chronicleDir, "committed", `${entry.id}.json`)
  await fs.mkdir(path.join(chronicleDir, "committed"), { recursive: true })
  await fs.writeFile(committedPath, JSON.stringify(entry, null, 2), "utf8")
  await fs.unlink(proposalPath)
  await updateSummary(chronicleDir).catch(() => {})

  return { id: entry.id, topic: entry.topic }
}

export async function deleteProposal(proposalId, chronicleDir) {
  const proposalsDir = path.join(chronicleDir, "proposals")
  const files = await fs.readdir(proposalsDir).catch(() => [])
  const match = files.find(f => f === `${proposalId}.json` || f.startsWith(proposalId))
  if (!match) throw new Error(`Proposal not found: ${proposalId}`)
  await fs.unlink(path.join(proposalsDir, match))
  return { deleted: match.replace(".json", "") }
}

// ── MCP tool schema ───────────────────────────────────────────────────────────

export const MCP_TOOLS = [
  {
    name: "chronicle_query",
    description: "Search Chronicle entries by topic using BM25. Returns the most relevant prior decisions and findings.",
    inputSchema: {
      type: "object",
      properties: {
        topic:       { type: "string", description: "Topic or keywords to search for" },
        projectRoot: { type: "string", description: "Project root directory (defaults to server's cwd)" },
      },
      required: ["topic"],
    },
    fn: toolChronicleQuery,
  },
  {
    name: "chronicle_brief",
    description: "Return a full summary of all Chronicle entries — decisions, statuses, and confidence scores.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string", description: "Project root directory (defaults to server's cwd)" },
      },
    },
    fn: toolChronicleBrief,
  },
  {
    name: "chronicle_propose",
    description: "Stage a new Chronicle entry for human review. Returns a proposalId. A human must run quorum commit <id> to index it.",
    inputSchema: {
      type: "object",
      properties: {
        entry: {
          type: "object",
          description: "Chronicle entry to propose",
          properties: {
            topic:       { type: "string" },
            decision:    { type: "string" },
            key_insight: { type: "string" },
            affected_areas: { type: "array", items: { type: "string" } },
            scope:       { type: "array", items: { type: "string" } },
            status:      { type: "string", enum: ["validated", "open", "refuted"] },
            confidence:  { type: "number", minimum: 0, maximum: 1 },
            alternatives_considered: { type: "array", items: { type: "string" } },
            rejected_reason:         { type: "array", items: { type: "string" } },
          },
          required: ["topic", "decision"],
        },
        projectRoot: { type: "string" },
      },
      required: ["entry"],
    },
    fn: toolChroniclePropose,
  },
  {
    name: "chronicle_pending",
    description: "List proposals awaiting human approval.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
      },
    },
    fn: toolChroniclePending,
  },
  {
    name: "sentinel_coverage",
    description: "Return Chronicle coverage for source files in the project — which files have entries referencing them and which do not.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
      },
    },
    fn: toolSentinelCoverage,
  },
]
