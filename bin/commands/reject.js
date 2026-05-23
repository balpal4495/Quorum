/**
 * quorum reject <id> [--as-refuted]
 *
 * Deletes a pending Chronicle proposal by ID (supports partial prefix match).
 * With --as-refuted, moves it to committed/ with status: "refuted" instead
 * of deleting, so the rejection is recorded in Chronicle history.
 */

import { promises as fs } from "fs"
import { randomUUID } from "crypto"
import path from "path"
import { c } from "../shared/colors.js"
import { findChronicleDir, entryText } from "../shared/chronicle.js"

function parseArgs(argv) {
  const args = { id: null, asRefuted: false }
  for (const arg of argv) {
    if (arg === "--as-refuted") { args.asRefuted = true; continue }
    if (!arg.startsWith("-")) args.id = arg
  }
  return args
}

export async function run(argv) {
  const args = parseArgs(argv)

  if (!args.id) {
    console.error(`\n${c.bold("quorum reject")} — delete or mark-refuted a pending Chronicle proposal\n`)
    console.error("Usage:")
    console.error(`  quorum reject <id>               Delete the proposal`)
    console.error(`  quorum reject <id> --as-refuted  Commit it with status: refuted\n`)
    process.exit(1)
  }

  const chronicleDir = await findChronicleDir()
  if (!chronicleDir) {
    console.error(c.red("\nNo .chronicle/ directory found. Run quorum init first.\n"))
    process.exit(1)
  }

  // ── Find proposal (supports partial ID prefix) ─────────────────────────────
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

  let partial
  try {
    partial = JSON.parse(await fs.readFile(proposalPath, "utf8"))
  } catch {
    console.error(`\n${c.red("Could not read proposal:")} ${proposalPath}\n`)
    process.exit(1)
  }

  if (args.asRefuted) {
    // ── Commit with status: refuted ──────────────────────────────────────────
    const entry = {
      ...partial,
      id: randomUUID(),
      status: "refuted",
      timestamp: new Date().toISOString(),
      source_proposal_id: proposalId,
    }
    const committedDir  = path.join(chronicleDir, "committed")
    const committedPath = path.join(committedDir, `${entry.id}.json`)
    await fs.mkdir(committedDir, { recursive: true })
    await fs.writeFile(committedPath, JSON.stringify(entry, null, 2), "utf8")
    await fs.unlink(proposalPath)

    console.log(`\n${c.red("✗ Rejected")} (committed as refuted)  ${c.dim(entry.id)}`)
    console.log(`  ${c.bold("key_insight:")} ${entryText(entry)}`)
    console.log(`  ${c.bold("areas:")}       ${(entry.affected_areas ?? []).join(", ")}`)
    console.log(c.dim("\n  This entry is now in Chronicle with status: refuted.\n"))
  } else {
    // ── Delete the proposal ──────────────────────────────────────────────────
    await fs.unlink(proposalPath)

    console.log(`\n${c.red("✗ Deleted")}  proposal ${c.cyan(proposalId.slice(0, 8))}`)
    console.log(`  ${c.bold("key_insight:")} ${entryText(partial)}`)
    console.log(c.dim("\n  Proposal removed. Use --as-refuted to keep it in Chronicle history.\n"))
  }
}
