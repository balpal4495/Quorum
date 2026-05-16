import { c } from "../shared/colors.js"
import { findChronicleDir, readCommitted, readProposals, entryText } from "../shared/chronicle.js"

const STALLED_DAYS = 14
const SLOW_DAYS    = 7

function parseArgs(argv) {
  const args = { json: false }
  for (const arg of argv) {
    if (arg === "--json") args.json = true
  }
  return args
}

function weekKey(timestamp) {
  const d = new Date(timestamp)
  const day = d.getUTCDay() || 7
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1))
  return mon.toISOString().slice(0, 10)
}

export async function run(argv) {
  const args = parseArgs(argv)

  const chronicleDir = await findChronicleDir(process.cwd())
  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  const [entries, proposals] = await Promise.all([
    readCommitted(chronicleDir),
    readProposals(chronicleDir),
  ])

  const now      = Date.now()
  const msPerDay = 86_400_000
  const sorted   = [...entries].sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))

  const in7Days  = entries.filter(e => e.timestamp && (now - new Date(e.timestamp).getTime()) < 7  * msPerDay).length
  const in30Days = entries.filter(e => e.timestamp && (now - new Date(e.timestamp).getTime()) < 30 * msPerDay).length

  const newest    = sorted[sorted.length - 1]
  const daysSince = newest?.timestamp
    ? Math.floor((now - new Date(newest.timestamp).getTime()) / msPerDay)
    : null

  let status
  if (entries.length === 0)                                   status = "empty"
  else if (daysSince !== null && daysSince >= STALLED_DAYS)  status = "stalled"
  else if (daysSince !== null && daysSince >= SLOW_DAYS)     status = "slow"
  else if (in7Days >= 3)                                     status = "thriving"
  else                                                        status = "healthy"

  if (args.json) {
    console.log(JSON.stringify({
      status,
      totalEntries: entries.length,
      pendingProposals: proposals.length,
      commitsLast7Days: in7Days,
      commitsLast30Days: in30Days,
      daysSinceLastCommit: daysSince,
      newestEntryTimestamp: newest?.timestamp ?? null,
    }, null, 2))
    return
  }

  const statusLabel = {
    empty:    c.red("EMPTY — Chronicle has no committed entries"),
    stalled:  c.red(`STALLED — no commits in ${daysSince} days`),
    slow:     c.yellow(`SLOW — no commits in ${daysSince} day${daysSince === 1 ? "" : "s"}`),
    thriving: c.green("THRIVING"),
    healthy:  c.green("HEALTHY"),
  }[status]

  console.log(`\n${c.bold("Chronicle growth")}\n`)
  console.log(`  Status        ${statusLabel}`)
  console.log(`  Total entries ${c.bold(String(entries.length))}`)
  console.log(`  Last 7 days   ${in7Days === 0 ? c.yellow("0") : c.green(String(in7Days))} commit${in7Days === 1 ? "" : "s"}`)
  console.log(`  Last 30 days  ${in30Days} commit${in30Days === 1 ? "" : "s"}`)

  if (daysSince !== null) {
    const col = daysSince >= STALLED_DAYS ? c.red : daysSince >= SLOW_DAYS ? c.yellow : c.green
    console.log(`  Last commit   ${col(`${daysSince} day${daysSince === 1 ? "" : "s"} ago`)}  ${c.dim(newest.timestamp.slice(0, 10))}`)
  }

  console.log(`  Pending       ${proposals.length} proposal${proposals.length === 1 ? "" : "s"} awaiting ${c.bold("quorum commit")}`)

  // Weekly sparkline (last 8 weeks)
  if (entries.length > 0) {
    const weeks = new Map()
    for (const e of entries) {
      if (!e.timestamp) continue
      const k = weekKey(e.timestamp)
      weeks.set(k, (weeks.get(k) ?? 0) + 1)
    }
    const weekKeys = [...weeks.keys()].sort().reverse().slice(0, 8)
    if (weekKeys.length > 0) {
      console.log(`\n  ${c.bold("Weekly commits")}`)
      for (const wk of weekKeys) {
        const n = weeks.get(wk)
        const bar = "▪".repeat(n)
        const col = n >= 3 ? c.green : n >= 1 ? c.cyan : c.dim
        console.log(`    ${c.dim("w/c")} ${wk}  ${col(bar || "—")}  ${col(String(n))}`)
      }
    }
  }

  // Recent learnings
  const recent = [...entries]
    .filter(e => e.timestamp)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 7)
  if (recent.length > 0) {
    console.log(`\n  ${c.bold("Recent learnings")}`)
    for (const e of recent) {
      const text = entryText(e).slice(0, 72)
      const trail = entryText(e).length > 72 ? "…" : ""
      const date  = e.timestamp.slice(0, 10)
      const col   = e.status === "refuted" ? c.red : e.status === "open" ? c.yellow : c.dim
      console.log(`    ${c.dim(e.id.slice(0, 8))}  ${text}${trail}  ${col(date)}`)
    }
  }

  // Actionable advice when not healthy
  if (status === "stalled" || status === "slow" || status === "empty") {
    console.log(`\n  ${c.yellow("Action needed:")}`)
    if (proposals.length > 0) {
      console.log(`    ${proposals.length} proposal${proposals.length === 1 ? " is" : "s are"} staged and ready to commit.`)
      console.log(`    Run ${c.bold("quorum commit --list")} to review them.`)
    } else {
      console.log(`    No proposals are staged.`)
      console.log(`    At the end of every session, create proposals for significant decisions.`)
      console.log(`    ${c.dim("See CLAUDE.md for the proposal format and session protocol.")}`)
    }
  }

  console.log("")
}
