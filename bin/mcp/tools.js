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

// ── LLM-powered tools ─────────────────────────────────────────────────────────
// These are activated when quorum serve detects an LLM provider.
// Without a provider they return a clear CLI-fallback hint.

let _llm = null  // set by createTools() at server startup

const NO_LLM = (name) => ({
  status: "no-llm",
  message: `${name} requires an LLM provider. No provider was detected at startup. ` +
    `Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY and restart quorum serve. ` +
    `Alternatively run 'quorum ${name.replace("quorum_", "")}' from the CLI.`,
})

export async function toolAdvisor({ question, projectRoot } = {}) {
  if (!question) throw new Error("question is required")
  if (!_llm) return NO_LLM("quorum_advisor")

  const { ask } = await import("../../dist/advisor/index.js")
  const { chronicleDir } = await resolve(projectRoot)
  const { createOracleClient } = await import("../../dist/oracle/index.js")
  const { xenovaEmbed } = await import("../../dist/oracle/adapters/xenova-embedder.js")
  const { createLanceDBStore } = await import("../../dist/oracle/adapters/lance-db.js")

  const store  = await createLanceDBStore(chronicleDir)
  const oracle = createOracleClient({ vectorStore: store, embedder: xenovaEmbed })
  const evidence = await oracle.query(question)
  const result = await ask({ question, evidence }, { llm: _llm })
  return result
}

export async function toolCheck({ outcome, design, projectRoot } = {}) {
  // quorum check is LLM-free — uses the same preflight + risk classifier as the CLI
  if (!outcome && !design) throw new Error("outcome or design is required")
  const { runPreflight, classifyRisk } = await import("../shared/patterns.js")
  const preflight = runPreflight(outcome ?? "", design ?? "")
  const risk      = classifyRisk(outcome ?? "", design ?? "")
  return { preflight, risk }
}

export async function toolCompass({ subcommand = "brief", goal, idea, projectRoot } = {}) {
  if (!_llm) return NO_LLM("quorum_compass")

  const { run: compassRun } = await import("../commands/compass.js")

  // Capture stdout — always request JSON so there are no ANSI codes
  const captured = []
  const origWrite = process.stdout.write.bind(process.stdout)
  process.stdout.write = (chunk, ...rest) => { captured.push(String(chunk)); return true }
  try {
    const extraArgs = ["--json"]
    if (subcommand === "pathways" && goal) extraArgs.push("--goal", goal)
    if (subcommand === "score"    && idea) extraArgs.push("--idea", idea)
    // Pass _llm directly to skip the ~1.5 s provider re-detection on every request
    await compassRun([subcommand, ...extraArgs], _llm)
  } finally {
    process.stdout.write = origWrite
  }

  const raw = captured.join("").trim()
  let data = null
  try { data = JSON.parse(raw) } catch { /* fallback to raw string below */ }
  return { subcommand, data, output: data ? null : raw }
}

/**
 * Ingest files, git history, or a URL into .chronicle/sources/ and
 * .chronicle/evidence/ as low-trust drafts (confidence 0.4).
 * Returns { added, skipped, items } — no console output, no process.exit.
 */
export async function toolIngest({ type = "git", paths, since = "P90D", urls, propose = false, projectRoot } = {}) {
  const { promisify } = await import("util")
  const { execFile }  = await import("child_process")
  const { createHash, randomUUID: uuid } = await import("crypto")
  const execFileAsync = promisify(execFile)

  const { projectRoot: root, chronicleDir } = await resolve(projectRoot)
  const sourcesDir   = path.join(chronicleDir, "sources")
  const evidenceDir  = path.join(chronicleDir, "evidence")
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(sourcesDir,  { recursive: true })
  await fs.mkdir(evidenceDir, { recursive: true })
  if (propose) await fs.mkdir(proposalsDir, { recursive: true })

  // Load existing content hashes to skip duplicates
  const existingHashes = new Set()
  for (const f of await fs.readdir(sourcesDir).catch(() => [])) {
    if (!f.endsWith(".json")) continue
    try {
      const s = JSON.parse(await fs.readFile(path.join(sourcesDir, f), "utf8"))
      if (s.content_hash) existingHashes.add(s.content_hash)
    } catch { /* skip malformed */ }
  }

  async function writeRecord({ hash, kind, sourceRef, title, summary, scope }) {
    const id = uuid()
    const ts = new Date().toISOString()
    await fs.writeFile(path.join(sourcesDir, `${id}.json`), JSON.stringify(
      { id, kind, source_ref: sourceRef, content_hash: hash, ingested_at: ts, schema_version: 2 }, null, 2), "utf8")

    const evidenceId = uuid()
    const evidence = {
      id: evidenceId, schema_version: 2,
      topic: `ingest/${kind}/${title.slice(0, 40).replace(/\s+/g, "-").toLowerCase()}`,
      key_insight: summary.slice(0, 200), decision: summary.slice(0, 200),
      scope, affected_areas: [], status: "open", confidence: 0.4,
      source_quality: "metadata-derived", needs_human_summary: true,
      source_module: "ingest", evidence_cited: [],
      alternatives_considered: [], rejected_reason: [],
      ingested_at: ts, source_id: id,
    }
    await fs.writeFile(path.join(evidenceDir, `${evidenceId}.json`), JSON.stringify(evidence, null, 2), "utf8")
    if (propose) {
      const propId = uuid()
      await fs.writeFile(path.join(proposalsDir, `${propId}.json`), JSON.stringify({ ...evidence, id: propId }, null, 2), "utf8")
    }
  }

  let added = 0, skipped = 0
  const items = []

  if (type === "git") {
    // Parse ISO 8601 duration PnD/PnM/PnY safely — never raw user input to shell
    const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/.exec(since ?? "P90D")
    const days = match ? (parseInt(match[1] ?? "0") * 365 + parseInt(match[2] ?? "0") * 30 + parseInt(match[3] ?? "0")) : 90
    const sinceArg = `${days > 0 ? days : 90} days ago`

    let stdout
    try {
      const res = await execFileAsync("git", ["log", `--since=${sinceArg}`, "--format=%H|%s|%ae|%ad", "--date=iso"], { cwd: root })
      stdout = res.stdout.trim()
    } catch { return { added: 0, skipped: 0, items: [], error: "git log failed — is this a git repository?" } }

    for (const line of stdout.split("\n").filter(Boolean)) {
      const [commitHash, subject = ""] = line.split("|")
      if (!commitHash) continue
      const fingerprint = createHash("sha256").update(commitHash).digest("hex").slice(0, 16)
      if (existingHashes.has(fingerprint)) { skipped++; continue }
      const short = commitHash.slice(0, 7)
      await writeRecord({ hash: fingerprint, kind: "git-commit", sourceRef: commitHash, title: subject, summary: `${short}: ${subject}`, scope: ["source", "git"] })
      items.push({ ref: short, summary: subject.slice(0, 80) })
      added++
    }
  } else if (type === "url") {
    const urlList = Array.isArray(urls) ? urls : (urls ? [urls] : [])
    for (const u of urlList.filter(Boolean)) {
      let parsed
      try { parsed = new URL(u) } catch { skipped++; continue }
      if (!["http:", "https:"].includes(parsed.protocol)) { skipped++; continue }
      const fingerprint = createHash("sha256").update(u).digest("hex").slice(0, 16)
      if (existingHashes.has(fingerprint)) { skipped++; continue }
      let text = ""
      try {
        const res = await fetch(u, { signal: AbortSignal.timeout(15000) })
        const html = await res.text()
        text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000)
      } catch { skipped++; continue }
      const title = parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.hostname
      const summary = text.slice(0, 200) || u
      await writeRecord({ hash: fingerprint, kind: "url", sourceRef: u, title, summary, scope: ["docs"] })
      items.push({ ref: u.slice(0, 60), summary: summary.slice(0, 80) })
      added++
    }
  } else if (type === "files") {
    const TEXT_EXTS = new Set([".md", ".txt", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".json", ".yaml", ".yml", ".toml", ".sh", ".html", ".css", ".csv"])
    const pathList = Array.isArray(paths) ? paths : (paths ? String(paths).split(",").map(p => p.trim()) : [])
    for (const p of pathList.filter(Boolean)) {
      const abs = path.isAbsolute(p) ? p : path.join(root, p)
      if (!TEXT_EXTS.has(path.extname(abs).toLowerCase())) { skipped++; continue }
      let content
      try { content = await fs.readFile(abs, "utf8") } catch { skipped++; continue }
      const fingerprint = createHash("sha256").update(content.slice(0, 3000)).digest("hex").slice(0, 16)
      if (existingHashes.has(fingerprint)) { skipped++; continue }
      const rel = path.relative(root, abs).replace(/\\/g, "/")
      const lines = content.split("\n").map(l => l.trim()).filter(Boolean)
      const summary = (lines.find(l => l.startsWith("#")) ?? lines[0] ?? rel).replace(/^#+\s*/, "").slice(0, 200)
      await writeRecord({ hash: fingerprint, kind: "file", sourceRef: rel, title: path.basename(abs), summary, scope: ["docs"] })
      items.push({ ref: rel, summary: summary.slice(0, 80) })
      added++
    }
  }

  return { added, skipped, items: items.slice(0, 30) }
}

/**
 * Structural drift check — Chronicle entries whose affected_areas paths no
 * longer exist as files in the codebase. LLM-free and fast.
 */
export async function toolSentinelDrift({ projectRoot } = {}) {
  const { projectRoot: root, chronicleDir } = await resolve(projectRoot)
  const entries = await readCommitted(chronicleDir)

  const flags = []
  for (const entry of entries) {
    if (!entry.affected_areas?.length) continue
    const missingFiles = []
    for (const area of entry.affected_areas) {
      const abs = path.join(root, area)
      const exists = await fs.access(abs).then(() => true).catch(() => false)
      if (!exists) missingFiles.push(area)
    }
    if (missingFiles.length > 0) {
      flags.push({
        entryId:      (entry.id ?? "").slice(0, 8),
        topic:        entry.topic,
        decision:     (entry.decision ?? entry.key_insight ?? "").slice(0, 160),
        missingFiles,
        confidence:   entry.confidence,
        status:       entry.status,
      })
    }
  }

  return {
    total:   entries.length,
    flagged: flags.length,
    flags,
    note: "Structural check: entries whose affected_areas paths no longer exist. For semantic drift (did the code meaning change?) run: quorum sentinel --drift from the CLI.",
  }
}

/**
 * Call once at server startup to wire the LLM provider into LLM-powered tools.
 */
export function setLLM(llmProvider) {
  _llm = llmProvider
}

// ── Proposal commit (human-gate — UI only, never an MCP AI tool) ──────────────

export async function commitProposal(proposalId, chronicleDir) {
  // ── Read proposal + validate BEFORE the try/catch ─────────────────────────
  // Validation errors must propagate (HTTP 400) and must never be swallowed by
  // the embedding-deps catch block below. Fixes #56.
  const proposalsDir = path.join(chronicleDir, "proposals")
  const allFiles = await fs.readdir(proposalsDir).catch(() => [])
  const match = allFiles.find(f => f === `${proposalId}.json` || f.startsWith(proposalId))
  if (!match) throw new Error(`Proposal not found: ${proposalId}`)
  const resolvedId  = match.replace(".json", "")
  const proposalPath = path.join(proposalsDir, match)
  const partial = JSON.parse(await fs.readFile(proposalPath, "utf8"))

  // Inline validateEntry — mirrors the logic in oracle/propose.ts so it runs
  // unconditionally regardless of whether embedding deps are available.
  const primaryText = ((partial.decision ?? partial.key_insight) ?? "").trim()
  if (primaryText.length < 20)
    throw new Error(`Validation failed: key_insight/decision is too short (${primaryText.length} chars, min 20)`)
  if (primaryText.length > 200)
    throw new Error(`Validation failed: key_insight/decision is too long (${primaryText.length} chars, max 200)`)
  const areas = (partial.affected_areas ?? []).filter(a => String(a).trim())
  if (areas.length === 0)
    throw new Error("Validation failed: affected_areas must contain at least one non-empty entry")

  // ── Embedding path (optional) ──────────────────────────────────────────────
  // Only infrastructure/dependency errors are caught here — validation already ran.
  const committedDir = path.join(chronicleDir, "committed")
  try {
    const { createOracleClient } = await import("../../dist/oracle/index.js")
    const { xenovaEmbed } = await import("../../dist/oracle/adapters/xenova-embedder.js")
    const { createLanceDBStore } = await import("../../dist/oracle/adapters/lance-db.js")
    const store  = await createLanceDBStore(chronicleDir)
    const oracle = createOracleClient({ vectorStore: store, embedder: xenovaEmbed, chronicleDir })
    const entry  = await oracle.commit(proposalId)
    return { id: entry.id, topic: entry.topic }
  } catch {
    // Embedding deps not available — fall back to JSON-only commit with idempotency guard.
    // Validation already ran above — safe to skip here.
    await fs.mkdir(committedDir, { recursive: true })
    const committedFiles = await fs.readdir(committedDir).catch(() => [])
    for (const file of committedFiles) {
      if (!file.endsWith(".json")) continue
      try {
        const existing = JSON.parse(await fs.readFile(path.join(committedDir, file), "utf8"))
        if (existing.source_proposal_id === resolvedId) {
          return { id: existing.id, topic: existing.topic }
        }
      } catch { /* skip malformed */ }
    }

    const entry = { ...partial, id: randomUUID(), timestamp: new Date().toISOString(), source_proposal_id: resolvedId }
    await fs.writeFile(path.join(committedDir, `${entry.id}.json`), JSON.stringify(entry, null, 2), "utf8")
    await fs.unlink(proposalPath)
    await updateSummary(chronicleDir).catch(() => {})
    return { id: entry.id, topic: entry.topic }
  }
}

export async function deleteProposal(proposalId, chronicleDir) {
  const proposalsDir = path.join(chronicleDir, "proposals")
  const files = await fs.readdir(proposalsDir).catch(() => [])
  const match = files.find(f => f === `${proposalId}.json` || f.startsWith(proposalId))
  if (!match) throw new Error(`Proposal not found: ${proposalId}`)
  await fs.unlink(path.join(proposalsDir, match))
  return { deleted: match.replace(".json", "") }
}

export async function updateProposal(proposalId, patch, chronicleDir) {
  const ALLOWED = ["topic", "decision", "key_insight", "status", "confidence",
                   "affected_areas", "scope", "alternatives_considered", "rejected_reason"]
  const proposalsDir = path.join(chronicleDir, "proposals")
  const files = await fs.readdir(proposalsDir).catch(() => [])
  const match = files.find(f => f === `${proposalId}.json` || f.startsWith(proposalId))
  if (!match) throw new Error(`Proposal not found: ${proposalId}`)

  const proposalPath = path.join(proposalsDir, match)
  const raw     = await fs.readFile(proposalPath, "utf8")
  const current = JSON.parse(raw)

  // Only apply allowed fields — never let PATCH overwrite id/proposalId/schema_version
  for (const key of ALLOWED) {
    if (patch[key] !== undefined) current[key] = patch[key]
  }

  await fs.writeFile(proposalPath, JSON.stringify(current, null, 2), "utf8")
  return { updated: match.replace(".json", ""), topic: current.topic }
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
    description: "Ask a plain-language question answered from Chronicle using an LLM. Returns a synthesised answer with evidence citations. Auto-activated when quorum serve detects an API key.",
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
    description: "Run instant risk triage on a design against Chronicle patterns — no LLM required. Returns preflight flags and a risk level (low/medium/high/critical).",
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
    description: "Product-direction synthesis — behaviours, pathways, bets, idea scoring. Auto-activated when quorum serve detects an LLM provider. Use subcommand: brief | map | pathways | bets | score | opportunities.",
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
