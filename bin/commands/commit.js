import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { exec } from "child_process"
import { promisify } from "util"
import { c } from "../shared/colors.js"
import { findChronicleDir, entryText, updateSummary } from "../shared/chronicle.js"

const execAsync = promisify(exec)

function parseArgs(argv) {
  const args = { id: null, dryRun: false, list: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") { args.dryRun = true; continue }
    if (argv[i] === "--list")    { args.list   = true; continue }
    if (!argv[i].startsWith("-")) args.id = argv[i]
  }
  return args
}

async function checkDep(name) {
  try {
    await import(name)
    return true
  } catch {
    return false
  }
}

function spinner(msg) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  let i = 0
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan(frames[i++ % frames.length])}  ${msg}`)
  }, 80)
  return { stop: (finalMsg) => { clearInterval(interval); process.stdout.write(`\r  ${finalMsg}\n`) } }
}

export async function run(argv) {
  const args = parseArgs(argv)

  const chronicleDir = await findChronicleDir(process.cwd())
  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  // ── --list: show pending proposals ────────────────────────────────────────
  if (args.list || (!args.id && argv.length === 0)) {
    const proposalsDir = path.join(chronicleDir, "proposals")
    let files
    try { files = await fs.readdir(proposalsDir) } catch { files = [] }
    const proposals = []
    for (const f of files) {
      if (!f.endsWith(".json")) continue
      try {
        const raw = await fs.readFile(path.join(proposalsDir, f), "utf8")
        proposals.push({ id: f.replace(".json", ""), ...JSON.parse(raw) })
      } catch { /* skip */ }
    }
    if (proposals.length === 0) {
      console.log(`\n${c.dim("No pending proposals.")}\n`)
      return
    }
    console.log(`\n${c.bold("Pending proposals")}\n`)
    for (const p of proposals) {
      console.log(`  ${c.cyan(p.id)}`)
      console.log(`    ${c.bold("key_insight:")} ${entryText(p)}`)
      console.log(`    ${c.bold("areas:")}       ${(p.affected_areas ?? []).join(", ")}`)
      console.log(`    ${c.bold("confidence:")}  ${p.confidence}`)
      if (p.status) console.log(`    ${c.bold("status:")}      ${p.status}`)
      console.log("")
    }
    console.log(c.dim(`  quorum commit <id>  to approve and index a proposal`))
    console.log("")
    return
  }

  if (!args.id) {
    console.error(`\n${c.bold("quorum commit")} — approve and index a Chronicle proposal\n`)
    console.error("Usage:")
    console.error(`  quorum commit <proposalId>       Commit and index the proposal`)
    console.error(`  quorum commit <proposalId> --dry-run   Preview without writing`)
    console.error(`  quorum commit --list                   List pending proposals\n`)
    process.exit(1)
  }

  // ── Find proposal (supports partial ID prefix) ────────────────────────────
  const proposalsDir = path.join(chronicleDir, "proposals")
  let files
  try { files = await fs.readdir(proposalsDir) } catch { files = [] }

  const match = files.find(f => f === `${args.id}.json` || f.startsWith(args.id))
  if (!match) {
    console.error(`\n${c.red("Proposal not found:")} ${args.id}`)
    console.error(c.dim(`  Run ${c.bold("quorum commit --list")} to see pending proposals.\n`))
    process.exit(1)
  }

  const proposalId   = match.replace(".json", "")
  const proposalPath = path.join(proposalsDir, match)

  let raw
  try { raw = await fs.readFile(proposalPath, "utf8") } catch {
    console.error(`\n${c.red("Could not read proposal:")} ${proposalPath}\n`)
    process.exit(1)
  }
  const partial = JSON.parse(raw)

  // ── Re-validate at commit time (#52) ─────────────────────────────────────────
  const insight = (partial.key_insight ?? "").trim()
  const decision = (partial.decision ?? "").trim()
  const primaryText = decision || insight
  if (primaryText.length < 20) {
    console.error(`\n${c.red("Validation failed:")} key_insight/decision is too short (min 20 chars).`)
    console.error(c.dim(`  Edit the proposal file or delete it with: quorum reject ${proposalId}\n`))
    process.exit(1)
  }
  if (primaryText.length > 200) {
    console.error(`\n${c.red("Validation failed:")} key_insight/decision is too long (${primaryText.length} chars, max 200).`)
    console.error(c.dim(`  Edit the proposal file or delete it with: quorum reject ${proposalId}\n`))
    process.exit(1)
  }
  const areas = (partial.affected_areas ?? []).filter(a => a.trim())
  if (areas.length === 0) {
    console.error(`\n${c.red("Validation failed:")} affected_areas must contain at least one non-empty entry.`)
    console.error(c.dim(`  Edit the proposal file or delete it with: quorum reject ${proposalId}\n`))
    process.exit(1)
  }

  // ── Dry run ────────────────────────────────────────────────────────────────
  if (args.dryRun) {
    console.log(`\n${c.bold("Dry run")} — would commit proposal ${c.cyan(proposalId.slice(0, 8))}\n`)
    console.log(`  ${c.bold("key_insight:")} ${entryText(partial)}`)
    console.log(`  ${c.bold("areas:")}       ${(partial.affected_areas ?? []).join(", ")}`)
    console.log(`  ${c.bold("status:")}      ${partial.status}`)
    console.log(`  ${c.bold("confidence:")}  ${partial.confidence}`)
    if (partial.scope?.length) console.log(`  ${c.bold("scope:")}       ${partial.scope.join(", ")}`)
    console.log(`\n  ${c.dim("(No changes made.)")}\n`)
    return
  }

  // ── Check optional embedding dependencies ─────────────────────────────────
  const hasXenova  = await checkDep("@xenova/transformers")
  const hasLanceDB = await checkDep("vectordb")
  const canEmbed   = hasXenova && hasLanceDB

  if (!canEmbed) {
    console.log(`\n${c.dim("  Embedding deps not found — committing to JSON store only.")}`)
    console.log(c.dim("  Install @xenova/transformers + vectordb to enable semantic search.\n"))
  }

  // ── Build entry ────────────────────────────────────────────────────────────
  const entry = {
    ...partial,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  }

  // ── Embed + index in vector store (optional) ───────────────────────────────
  if (canEmbed) {
    const spin = spinner("Embedding and indexing…")
    try {
      const { pipeline } = (await import("@xenova/transformers")).default ?? await import("@xenova/transformers")
      const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
      const embeddingText = [
        entryText(entry),
        ...(entry.affected_areas ?? []),
        ...(entry.scope ?? []),
      ].join(" ")
      const output = await embedder(embeddingText, { pooling: "mean", normalize: true })
      const vector = Array.from(output.data)
      spin.stop(`${c.green("✓")}  Embedded (${vector.length}-dim)`)

      const storeSpin = spinner("Indexing in vector store…")
      try {
        const lancedb = (await import("vectordb")).default ?? (await import("vectordb"))
        const tableDir = path.join(chronicleDir, "entries")
        const db = await lancedb.connect(tableDir)
        const row = { id: entry.id, vector, payload: JSON.stringify(entry) }
        const names = await db.tableNames()
        if (names.includes("entries")) {
          const table = await db.openTable("entries")
          await table.delete(`id = '${entry.id.replace(/'/g, "''")}'`)
          await table.add([row])
        } else {
          await db.createTable("entries", [row], { metric: "cosine" })
        }
        storeSpin.stop(`${c.green("✓")}  Indexed in vector store`)
      } catch (err) {
        storeSpin.stop(`${c.yellow("⚠")}  Vector store write failed — JSON commit will proceed`)
        console.error(c.dim(`     ${err.message}`))
      }
    } catch (err) {
      spin.stop(`${c.yellow("⚠")}  Embedding failed — JSON commit will proceed`)
      console.error(c.dim(`     ${err.message}`))
    }
  }

  // ── Write committed file ───────────────────────────────────────────────────
  const committedDir  = path.join(chronicleDir, "committed")
  const committedPath = path.join(committedDir, `${entry.id}.json`)
  await fs.mkdir(committedDir, { recursive: true })
  await fs.writeFile(committedPath, JSON.stringify(entry, null, 2), "utf8")

  // Git add — best-effort
  try { await execAsync(`git add "${committedPath}"`) } catch { /* not in git, or git unavailable */ }

  // Update SUMMARY.md — best-effort
  try { await updateSummary(chronicleDir) } catch { /* never fail a commit */ }

  // Remove proposal
  await fs.unlink(proposalPath)

  // ── Result ─────────────────────────────────────────────────────────────────
  console.log(`\n${c.green("✓ Committed")}  ${c.dim(entry.id)}`)
  console.log(`  ${c.bold("key_insight:")} ${entryText(entry)}`)
  console.log(`  ${c.bold("areas:")}       ${(entry.affected_areas ?? []).join(", ")}`)
  console.log(`  ${c.bold("status:")}      ${entry.status}`)
  console.log("")
}
