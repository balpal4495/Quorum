/**
 * quorum ingest-git [--since P90D] [--propose]
 *
 * Reads git commit history and ingests each commit as a low-trust evidence
 * record in .chronicle/sources/ and .chronicle/evidence/.
 *
 * With --propose, each commit is also written to .chronicle/proposals/
 * for review with: quorum commit --list
 *
 * --since accepts ISO 8601 durations: P90D (90 days), P6M (6 months), P1Y (1 year).
 * Defaults to P90D.
 */

import { execSync } from "child_process"
import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"

function parseArgs(argv) {
  const args = { since: "P90D", propose: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since" && argv[i + 1]) { args.since = argv[++i]; continue }
    if (argv[i].startsWith("--since="))       { args.since = argv[i].slice(8); continue }
    if (argv[i] === "--propose")               { args.propose = true }
  }
  return args
}

/**
 * Parse a restricted subset of ISO 8601 duration (PnD, PnM, PnY) to a
 * human-readable git --since value. Returns a safe numeric string like
 * "90 days ago" — never passes raw user input to the shell.
 */
export function parseDurationToGitSince(duration) {
  const match = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/.exec(duration)
  if (!match) return "90 days ago"
  const years  = parseInt(match[1] ?? "0", 10)
  const months = parseInt(match[2] ?? "0", 10)
  const days   = parseInt(match[3] ?? "0", 10)
  const total  = years * 365 + months * 30 + days
  return `${total > 0 ? total : 90} days ago`
}

function deriveScope(files) {
  const scope = []
  if (files.some(f => f.startsWith("modules/")))  scope.push("modules")
  if (files.some(f => f.startsWith("bin/")))       scope.push("cli")
  if (files.some(f => f.startsWith(".github/")))   scope.push("ci")
  if (files.some(f => f === "README.md"))          scope.push("docs")
  if (files.some(f => f === "package.json"))       scope.push("npm")
  if (scope.length === 0) scope.push("general")
  return scope
}

export async function run(argv) {
  const args = parseArgs(argv)

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

  // Load already-ingested commit hashes to avoid duplicates
  const existingRefs = new Set()
  try {
    for (const f of await fs.readdir(sourcesDir)) {
      if (!f.endsWith(".json")) continue
      try {
        const src = JSON.parse(await fs.readFile(path.join(sourcesDir, f), "utf8"))
        if (src.type === "git-commit" && src.ref) existingRefs.add(src.ref)
      } catch { /* skip malformed */ }
    }
  } catch { /* no sources yet */ }

  const gitSince = parseDurationToGitSince(args.since)
  console.log(c.bold(`\nReading git history since "${gitSince}"...\n`))

  let logRaw
  try {
    logRaw = execSync(
      // Safe: gitSince is always "N days ago" from parseDurationToGitSince
      `git log --since="${gitSince}" --pretty=format:"%H|||%ci|||%s" --no-merges`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim()
  } catch {
    console.error(c.red("Could not run git log. Ensure this is a git repository."))
    process.exit(1)
  }

  if (!logRaw) {
    console.log(c.dim(`No commits found since "${gitSince}"`))
    return
  }

  const commits = logRaw
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [hash, date, ...parts] = line.split("|||")
      return { hash: hash.trim(), date: date.trim(), subject: parts.join("|||").trim() }
    })

  let ingested = 0, skipped = 0, proposed = 0
  const now = new Date().toISOString()

  for (const { hash, date, subject } of commits) {
    if (existingRefs.has(hash)) { skipped++; continue }

    // Get changed files — hash is hex from git log, safe to interpolate
    let changedFiles = []
    try {
      changedFiles = execSync(
        `git diff-tree --no-commit-id -r --name-only ${hash}`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim().split("\n").filter(Boolean)
    } catch { /* skip file list on error */ }

    const scope      = deriveScope(changedFiles)
    const sourceId   = randomUUID()
    const evidenceId = randomUUID()

    const sourceRecord = {
      id: sourceId,
      type: "git-commit",
      ref: hash,
      ingested_at: now,
      metadata: { date, subject, files_changed: changedFiles.length },
    }
    await fs.writeFile(
      path.join(sourcesDir, `${sourceId}.json`),
      JSON.stringify(sourceRecord, null, 2),
    )
    existingRefs.add(hash)

    const evidenceRecord = {
      id: evidenceId,
      source_id: sourceId,
      schema_version: 2,
      topic: `git: ${subject.slice(0, 80)}`,
      key_insight: subject.slice(0, 150),
      decision: subject.slice(0, 150),
      affected_areas: changedFiles.slice(0, 10),
      scope,
      alternatives_considered: [],
      rejected_reason: [],
      status: "open",
      confidence: 0.4,
      source_quality: "metadata-derived",
      needs_human_summary: true,
      source_module: "ingest-git",
      work_ref: { type: "git-commit", ref: hash, date },
      ingested_at: now,
    }
    await fs.writeFile(
      path.join(evidenceDir, `${evidenceId}.json`),
      JSON.stringify(evidenceRecord, null, 2),
    )

    if (args.propose) {
      const proposalId = randomUUID()
      const { id: _id, ingested_at: _ts, ...proposalBody } = evidenceRecord
      await fs.writeFile(
        path.join(proposalsDir, `${proposalId}.json`),
        JSON.stringify(proposalBody, null, 2),
      )
      proposed++
      console.log(c.green(`  ✓ propose  ${hash.slice(0, 7)}  ${subject.slice(0, 60)}`))
    } else {
      console.log(c.green(`  ✓ ingest   ${hash.slice(0, 7)}  ${subject.slice(0, 60)}`))
    }
    ingested++
  }

  const suffix = args.propose ? `  ${proposed} proposed` : ""
  console.log(`\n${c.bold("Done.")}  ${ingested} commits ingested  ${skipped} already ingested${suffix}`)
  if (ingested > 0 && !args.propose) {
    console.log(c.dim(`\n  Evidence in .chronicle/evidence/`))
    console.log(c.dim(`  Re-run with --propose to stage as Chronicle proposals.`))
  } else if (proposed > 0) {
    console.log(c.dim(`\n  Review proposals:  quorum commit --list`))
  }
}
