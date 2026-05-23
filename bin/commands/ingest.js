/**
 * quorum ingest <paths...> [--recurse] [--propose]
 *
 * Ingests files and directories into .chronicle/sources/ and .chronicle/evidence/
 * as low-trust, metadata-derived records (confidence 0.4, needs_human_summary: true).
 *
 * With --propose, each evidence item is also written to .chronicle/proposals/
 * for review with: quorum commit --list
 */

import { createHash, randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"

function parseArgs(argv) {
  const args = { paths: [], recurse: false, propose: false }
  for (const arg of argv) {
    if (arg === "--recurse" || arg === "-r") args.recurse = true
    else if (arg === "--propose") args.propose = true
    else if (!arg.startsWith("-")) args.paths.push(arg)
  }
  return args
}

async function* walkDir(dir) {
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue
      yield* walkDir(full)
    } else {
      yield full
    }
  }
}

async function collectFiles(targetPaths, recurse) {
  const files = []
  for (const p of targetPaths) {
    const stat = await fs.stat(p).catch(() => null)
    if (!stat) { console.warn(c.dim(`  skip: ${p} (not found)`)); continue }
    if (stat.isDirectory()) {
      if (recurse) {
        for await (const f of walkDir(p)) files.push(f)
      } else {
        console.warn(c.dim(`  skip: ${p} is a directory — use --recurse`))
      }
    } else {
      files.push(p)
    }
  }
  return files
}

const TEXT_EXTS = new Set([
  ".md", ".txt", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".json", ".yaml", ".yml", ".toml", ".sh", ".bash",
  ".html", ".htm", ".css", ".scss", ".svg", ".xml", ".csv",
  ".rst", ".adoc", ".env",
])

async function extractContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (!TEXT_EXTS.has(ext)) return null
  try {
    const raw = await fs.readFile(filePath, "utf8")
    return raw.slice(0, 3000)
  } catch {
    return null
  }
}

function deriveScope(filePath) {
  const scope = []
  const rel = filePath.replace(/\\/g, "/")
  if (rel.match(/\/docs?\//i) || rel.endsWith(".md") || rel.endsWith(".rst")) scope.push("docs")
  if (rel.match(/\/(src|lib|modules)\//))  scope.push("source")
  if (rel.match(/\/(tests?|__tests__)\//i) || rel.match(/\.(test|spec)\./)) scope.push("tests")
  if (rel.includes("/.github/") || rel.includes("/ci/")) scope.push("ci")
  if (rel.includes("/bin/") || rel.endsWith(".sh")) scope.push("cli")
  if (scope.length === 0) scope.push("general")
  return scope
}

function summariseContent(filePath, content) {
  if (!content) return `Ingested ${path.basename(filePath)}`
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean)
  const heading = lines.find(l => l.startsWith("#")) ?? lines[0] ?? ""
  return heading.replace(/^#+\s*/, "").slice(0, 150) || `Content from ${path.basename(filePath)}`
}

export async function run(argv) {
  const args = parseArgs(argv)
  if (args.paths.length === 0) {
    console.error(c.red("Usage: quorum ingest <paths...> [--recurse] [--propose]"))
    process.exit(1)
  }

  const chronicleDir = await findChronicleDir()
  if (!chronicleDir) {
    console.error(c.red("No .chronicle/ directory found. Run quorum init first."))
    process.exit(1)
  }

  const sourcesDir   = path.join(chronicleDir, "sources")
  const evidenceDir  = path.join(chronicleDir, "evidence")
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(sourcesDir,  { recursive: true })
  await fs.mkdir(evidenceDir, { recursive: true })
  if (args.propose) await fs.mkdir(proposalsDir, { recursive: true })

  // Load existing content hashes to skip unchanged files
  const existingHashes = new Set()
  try {
    for (const f of await fs.readdir(sourcesDir)) {
      if (!f.endsWith(".json")) continue
      try {
        const src = JSON.parse(await fs.readFile(path.join(sourcesDir, f), "utf8"))
        if (src.type === "file" && src.content_hash) existingHashes.add(src.content_hash)
      } catch { /* skip malformed */ }
    }
  } catch { /* no sources yet */ }

  const files = await collectFiles(args.paths, args.recurse)
  let ingested = 0, skipped = 0, proposed = 0
  const now = new Date().toISOString()

  console.log(c.bold(`\nIngesting ${files.length} file(s)...\n`))

  for (const filePath of files) {
    const content  = await extractContent(filePath)
    const text     = content ?? ""
    const hashKey  = `sha256:${createHash("sha256").update(text).digest("hex")}`

    if (existingHashes.has(hashKey)) {
      skipped++
      console.log(c.dim(`  ≡ skip    ${path.relative(process.cwd(), filePath)} (unchanged)`))
      continue
    }

    const relPath    = path.relative(process.cwd(), filePath)
    const scope      = deriveScope(filePath)
    const summary    = summariseContent(filePath, content)
    const sourceId   = randomUUID()
    const evidenceId = randomUUID()

    const sourceRecord = {
      id: sourceId,
      type: "file",
      ref: relPath,
      ingested_at: now,
      content_hash: hashKey,
      metadata: { size_bytes: text.length, ext: path.extname(filePath) },
    }
    await fs.writeFile(
      path.join(sourcesDir, `${sourceId}.json`),
      JSON.stringify(sourceRecord, null, 2),
    )
    existingHashes.add(hashKey)

    const evidenceRecord = {
      id: evidenceId,
      source_id: sourceId,
      schema_version: 2,
      topic: relPath,
      key_insight: summary,
      decision: summary,
      affected_areas: [relPath],
      scope,
      alternatives_considered: [],
      rejected_reason: [],
      status: "open",
      confidence: 0.4,
      source_quality: "metadata-derived",
      needs_human_summary: true,
      source_module: "ingest",
      work_ref: { type: "file", ref: relPath },
      ingested_at: now,
    }
    await fs.writeFile(
      path.join(evidenceDir, `${evidenceId}.json`),
      JSON.stringify(evidenceRecord, null, 2),
    )

    if (args.propose) {
      const proposalId = randomUUID()
      const { id: _id, ingested_at: _ts, ...proposalBody } = evidenceRecord

      // Truncate key_insight/decision to max 200 chars so the proposal passes
      // validateEntry() — ingest summaries are auto-generated and unbounded (#51)
      const insight = (proposalBody.key_insight ?? "").slice(0, 150).trim() || `Ingested ${path.basename(relPath)}`
      proposalBody.key_insight = insight
      proposalBody.decision    = insight

      // Ensure affected_areas is non-empty (#51)
      if (!proposalBody.affected_areas?.length) proposalBody.affected_areas = [relPath]

      await fs.writeFile(
        path.join(proposalsDir, `${proposalId}.json`),
        JSON.stringify(proposalBody, null, 2),
      )
      proposed++
      console.log(c.green(`  ✓ propose  ${relPath}`))
    } else {
      console.log(c.green(`  ✓ ingest   ${relPath}`))
    }
    ingested++
  }

  const suffix = args.propose ? `  ${proposed} proposed` : ""
  console.log(`\n${c.bold("Done.")}  ${ingested} ingested  ${skipped} unchanged${suffix}`)
  if (ingested > 0 && !args.propose) {
    console.log(c.dim(`\n  Evidence in .chronicle/evidence/`))
    console.log(c.dim(`  Re-run with --propose to stage as Chronicle proposals.`))
  } else if (proposed > 0) {
    console.log(c.dim(`\n  Review proposals:  quorum commit --list`))
  }
}
