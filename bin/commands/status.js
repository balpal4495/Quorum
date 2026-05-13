import { c } from "../shared/colors.js"
import { findChronicleDir, readProposals, readCommitted, entryText } from "../shared/chronicle.js"

function relativeTime(isoString) {
  const ms = Date.now() - new Date(isoString).getTime()
  const mins  = Math.floor(ms / 60_000)
  const hours = Math.floor(ms / 3_600_000)
  const days  = Math.floor(ms / 86_400_000)
  if (mins < 2)    return "just now"
  if (mins < 60)   return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days < 30)   return `${days}d ago`
  return new Date(isoString).toISOString().slice(0, 10)
}

function statusBadge(status) {
  switch (status) {
    case "accepted":  return c.green("accepted")
    case "refuted":   return c.red("refuted")
    case "superseded":return c.yellow("superseded")
    default:          return c.dim(status ?? "unknown")
  }
}

export async function run(argv) {
  const jsonMode = argv.includes("--json")
  const cwd = process.cwd()

  const chronicleDir = await findChronicleDir(cwd)

  if (!chronicleDir) {
    if (jsonMode) {
      console.log(JSON.stringify({ error: "No .chronicle directory found", initialized: false }))
    } else {
      console.log(`\n${c.yellow("No .chronicle/ found")} in ${cwd} or any parent directory.`)
      console.log(`${c.dim("Run")} quorum init ${c.dim("first.")}\n`)
    }
    process.exit(1)
  }

  const [proposals, committed] = await Promise.all([
    readProposals(chronicleDir),
    readCommitted(chronicleDir),
  ])

  if (jsonMode) {
    console.log(JSON.stringify({
      initialized: true,
      chronicleDir,
      proposals: proposals.length,
      committed: committed.length,
      pendingProposals: proposals.map(p => ({
        id: p.proposalId,
        key_insight: p.key_insight,
        affected_areas: p.affected_areas,
      })),
      recentEntries: committed.slice(0, 5).map(e => ({
        id: e.id,
        status: e.status,
        key_insight: e.key_insight,
        timestamp: e.timestamp,
      })),
    }, null, 2))
    return
  }

  // ── Header ────────────────────────────────────────────────────────────────
  console.log(`\n${c.bold("Chronicle status")}  ${c.dim(chronicleDir)}\n`)

  // ── Counts ────────────────────────────────────────────────────────────────
  const acceptedCount  = committed.filter(e => e.status === "accepted").length
  const refutedCount   = committed.filter(e => e.status === "refuted").length
  const otherCount     = committed.length - acceptedCount - refutedCount

  console.log(`  ${c.bold(String(committed.length).padStart(4))}  committed entries  ` +
    `(${c.green(acceptedCount + " accepted")}, ${c.red(refutedCount + " refuted")}${otherCount ? `, ${otherCount} other` : ""})`)
  console.log(`  ${c.bold(String(proposals.length).padStart(4))}  pending proposals\n`)

  // ── Pending proposals ─────────────────────────────────────────────────────
  if (proposals.length > 0) {
    console.log(c.bold("Pending proposals") + c.dim("  (awaiting quorum commit <id>)"))
    for (const p of proposals) {
      const insight = (entryText(p) ?? "").slice(0, 72)
      const areas   = (p.affected_areas ?? []).join(", ").slice(0, 40)
      console.log(`  ${c.cyan(p.proposalId.slice(0, 8))}  ${insight}`)
      if (areas) console.log(`          ${c.dim(areas)}`)
    }
    console.log("")
  }

  // ── Recent committed entries ───────────────────────────────────────────────
  if (committed.length > 0) {
    console.log(c.bold("Recent entries"))
    for (const e of committed.slice(0, 8)) {
      const insight = (entryText(e) ?? "").slice(0, 65)
      const when    = relativeTime(e.timestamp)
      const areas   = (e.affected_areas ?? []).join(", ").slice(0, 35)
      console.log(
        `  ${c.dim(e.id.slice(0, 8))}  [${statusBadge(e.status)}]  ` +
        `${insight}  ${c.dim(when)}`
      )
      if (areas) console.log(`          ${c.dim(areas)}`)
    }
    if (committed.length > 8) {
      console.log(`  ${c.dim(`… and ${committed.length - 8} more`)}`)
    }
    console.log("")
  } else {
    console.log(c.dim("  No committed entries yet.\n"))
  }

  // ── Hint ──────────────────────────────────────────────────────────────────
  if (proposals.length > 0) {
    console.log(c.dim(`  Tip: quorum commit <first-8-chars-of-id>  to approve a proposal`))
    console.log(c.dim(`       quorum commit --list                  to see full proposal details\n`))
  }
}
