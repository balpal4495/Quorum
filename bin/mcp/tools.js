/**
 * Quorum MCP tool definitions — pure logic, no HTTP.
 * Shared between the MCP JSON-RPC handler and the REST API used by the UI.
 *
 * Tool naming follows Keep's pattern: all tools share a consistent prefix.
 * Tools marked [TODO] are stubs — LLM-powered tools are out of scope for the
 * current stateless HTTP server and require a future quorum serve --llm design.
 */
import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { randomUUID } from "crypto"
import { findChronicleDir, readCommitted, readProposals, updateSummary } from "../shared/chronicle.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

export async function toolQuery({ topic, projectRoot } = {}) {
  if (!topic) throw new Error("topic is required")
  const { chronicleDir } = await resolve(projectRoot)
  const entries = await readCommitted(chronicleDir)
  const results = findRelevant(entries, topic, 8)
  return { query: topic, count: results.length, entries: results }
}

export async function toolBrief({ projectRoot } = {}) {
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

export async function toolStage({ entry, projectRoot } = {}) {
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

export async function toolPending({ projectRoot } = {}) {
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

export async function toolCoverage({ projectRoot } = {}) {
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

  const coveredFiles = coverageByFile.filter(f => f.covered)
  const percentage   = files.length === 0 ? 0
    : Math.round((coveredFiles.length / files.length) * 100)

  return { percentage, totalFiles: files.length, coveredFiles: coveredFiles.length, coverageByFile }
}

export async function toolGrowth({ projectRoot } = {}) {
  const { chronicleDir } = await resolve(projectRoot)
  const [entries, proposals] = await Promise.all([
    readCommitted(chronicleDir),
    readProposals(chronicleDir),
  ])

  const byStatus = { validated: 0, open: 0, refuted: 0, other: 0 }
  let totalConfidence = 0
  for (const e of entries) {
    const k = e.status === "validated" || e.status === "open" || e.status === "refuted"
      ? e.status : "other"
    byStatus[k]++
    totalConfidence += e.confidence ?? 0
  }

  const avgConfidence = entries.length > 0
    ? Math.round((totalConfidence / entries.length) * 100) / 100
    : 0

  // Rough health score: reward validated entries, penalise refuted + pending
  const health = entries.length === 0 ? 0 : Math.max(0, Math.min(100, Math.round(
    (byStatus.validated / entries.length) * 100
    - (byStatus.refuted / entries.length) * 20
    - (proposals.length / Math.max(1, entries.length)) * 10
  )))

  return {
    health,
    entries: { total: entries.length, byStatus, avgConfidence },
    proposals: { pending: proposals.length },
    hint: health >= 80 ? "Chronicle is healthy."
      : health >= 50 ? "Chronicle is growing — consider committing pending proposals."
      : "Chronicle needs attention — validate open entries and reduce pending proposals.",
  }
}

// Path to the modules README for quorum_help
const HELP_PATH = path.join(__dirname, "../../modules/README.md")

export async function toolHelp({ topic } = {}) {
  let readme
  try {
    readme = await fs.readFile(HELP_PATH, "utf8")
  } catch {
    return { topic, content: "Quorum help text not found. See https://github.com/balpal4495/Quorum for documentation." }
  }

  if (!topic || topic === "index") {
    // Return the first 100 lines as an index
    const lines = readme.split("\n").slice(0, 100).join("\n")
    return { topic: "index", content: lines }
  }

  // Find the heading that best matches the topic and return its section
  const lines  = readme.split("\n")
  const needle = topic.toLowerCase()
  const start  = lines.findIndex(l => l.startsWith("#") && l.toLowerCase().includes(needle))

  if (start === -1) {
    return { topic, content: `No section found for "${topic}". Try quorum_help with topic="index" to browse available topics.` }
  }

  // Collect lines until the next same-level heading
  const level = (lines[start].match(/^#+/) ?? [""])[0].length
  const end   = lines.findIndex((l, i) => i > start && l.startsWith("#".repeat(level)) && l.length > level)
  const section = lines.slice(start, end === -1 ? start + 60 : end).join("\n")

  return { topic, content: section }
}

// ── [TODO] LLM-powered placeholders ──────────────────────────────────────────
// These tools require a live LLM provider wired into quorum serve (--llm flag).
// They are registered so AI clients can discover them, but return a clear
// "not yet available" message rather than silently failing.

const TODO_MESSAGE = (name) =>
  `${name} requires an LLM provider. This is planned — run 'quorum ${name.replace("quorum_", "")}' from the CLI for now, or watch for a future 'quorum serve --llm' flag.`

export async function toolAdvisor({ question } = {}) {
  if (!question) throw new Error("question is required")
  return { status: "todo", message: TODO_MESSAGE("quorum_advisor") }
}

export async function toolCheck({ outcome, design } = {}) {
  if (!outcome && !design) throw new Error("outcome or design is required")
  return { status: "todo", message: TODO_MESSAGE("quorum_check") }
}

export async function toolCompass({ subcommand } = {}) {
  return { status: "todo", message: TODO_MESSAGE("quorum_compass") }
}

// ── Proposal commit (human-gate — UI only, never an MCP AI tool) ──────────────

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

// ── MCP tool registry ─────────────────────────────────────────────────────────

export const MCP_TOOLS = [
  // ── Core: Chronicle (no LLM) ──
  {
    name: "quorum_query",
    description: "Search Chronicle entries by topic using BM25. Returns the most relevant prior decisions and findings. Always call this before proposing a design.",
    inputSchema: {
      type: "object",
      properties: {
        topic:       { type: "string", description: "Topic or keywords to search for" },
        projectRoot: { type: "string", description: "Project root directory (defaults to server cwd)" },
      },
      required: ["topic"],
    },
    fn: toolQuery,
  },
  {
    name: "quorum_brief",
    description: "Return a full summary of all Chronicle entries — decisions, statuses, and confidence scores.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: { type: "string" },
      },
    },
    fn: toolBrief,
  },
  {
    name: "quorum_stage",
    description: "Stage a new Chronicle entry for human review. Returns a proposalId. A human must approve it via the Quorum UI or 'quorum commit <id>'.",
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
    fn: toolStage,
  },
  {
    name: "quorum_pending",
    description: "List Chronicle proposals awaiting human approval.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" } },
    },
    fn: toolPending,
  },
  // ── Sentinel ──
  {
    name: "quorum_coverage",
    description: "Return Chronicle coverage for source files — which files have Chronicle entries referencing them and which are undocumented.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" } },
    },
    fn: toolCoverage,
  },
  // ── Memory health ──
  {
    name: "quorum_growth",
    description: "Report Chronicle memory health — entry counts by status, average confidence, pending proposals, and a health score with guidance.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: { type: "string" } },
    },
    fn: toolGrowth,
  },
  // ── Documentation ──
  {
    name: "quorum_help",
    description: "Browse Quorum documentation. Call with topic='index' to see all available sections, or topic='<section>' to read a specific section.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Documentation topic, or 'index' for the full list" },
      },
    },
    fn: toolHelp,
  },
  // ── [TODO] LLM-powered tools ──
  {
    name: "quorum_advisor",
    description: "[TODO] Ask a plain-language question answered from Chronicle using an LLM. Requires 'quorum serve --llm'. Use 'quorum advisor' CLI for now.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Plain-language question to answer from Chronicle" },
      },
      required: ["question"],
    },
    fn: toolAdvisor,
  },
  {
    name: "quorum_check",
    description: "[TODO] Run instant risk triage on a design against Chronicle evidence. Requires 'quorum serve --llm'. Use 'quorum check' CLI for now.",
    inputSchema: {
      type: "object",
      properties: {
        outcome: { type: "string", description: "Desired outcome" },
        design:  { type: "string", description: "Proposed design or approach" },
      },
    },
    fn: toolCheck,
  },
  {
    name: "quorum_compass",
    description: "[TODO] Product-direction synthesis — behaviours, pathways, bets, idea scoring. Requires 'quorum serve --llm'. Use 'quorum compass' CLI for now.",
    inputSchema: {
      type: "object",
      properties: {
        subcommand: { type: "string", description: "One of: brief, map, pathways, bets, score, opportunities" },
        goal:       { type: "string", description: "Goal for pathways subcommand" },
        idea:       { type: "string", description: "Idea to score for score subcommand" },
      },
    },
    fn: toolCompass,
  },
]
