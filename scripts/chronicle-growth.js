#!/usr/bin/env node
/**
 * Posts a Chronicle growth summary comment on a merged PR.
 * Called by chronicle-on-merge.yml after the proposal step.
 *
 * Reads PR_NUMBER, PR_CREATED_AT from env.
 * Identifies entries committed during this PR's lifecycle by timestamp.
 * Posts a markdown comment via gh pr comment.
 */

import { execSync } from "child_process"
import { promises as fs } from "fs"
import path from "path"

const PR_NUMBER     = process.env.PR_NUMBER
const PR_CREATED_AT = process.env.PR_CREATED_AT  // ISO timestamp from github event

if (!PR_NUMBER) {
  console.log("No PR_NUMBER — skipping growth comment")
  process.exit(0)
}

// Read all committed entries
const committedDir = path.join(".chronicle", "committed")
let allEntries = []
try {
  const files = await fs.readdir(committedDir)
  for (const file of files) {
    if (!file.endsWith(".json")) continue
    try {
      const raw = await fs.readFile(path.join(committedDir, file), "utf8")
      allEntries.push(JSON.parse(raw))
    } catch { /* skip malformed */ }
  }
} catch {
  console.log("No .chronicle/committed/ directory — skipping growth comment")
  process.exit(0)
}

if (allEntries.length === 0) {
  console.log("No committed entries — skipping growth comment")
  process.exit(0)
}

// Entries committed during this PR's lifetime
const prStart = PR_CREATED_AT ? new Date(PR_CREATED_AT).getTime() : null
const prEntries = prStart
  ? allEntries.filter(e => e.timestamp && new Date(e.timestamp).getTime() >= prStart)
  : []

const totalEntries  = allEntries.length
const prEntryCount  = prEntries.length
const prevTotal     = totalEntries - prEntryCount

function entryText(e) {
  return (e.decision ?? e.key_insight ?? "").trim()
}

function statusEmoji(status) {
  if (status === "validated") return "✅"
  if (status === "refuted")   return "❌"
  return "🔵"
}

// Build markdown comment
const lines = []

lines.push("## Quorum Chronicle — what this PR taught\n")

if (prEntryCount > 0) {
  const growthLine = prevTotal > 0
    ? `Chronicle grew from **${prevTotal} → ${totalEntries} entries**`
    : `Chronicle now has **${totalEntries} entries**`
  lines.push(growthLine + "\n")

  lines.push("**Committed this PR:**")
  for (const e of prEntries.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""))) {
    const text = entryText(e).slice(0, 100)
    const trail = entryText(e).length > 100 ? "…" : ""
    lines.push(`- ${statusEmoji(e.status)} \`[${e.id.slice(0, 8)}]\` ${text}${trail}`)
  }
} else {
  lines.push(`Chronicle has **${totalEntries} entries** — no new entries committed this PR.\n`)
  lines.push("_Tip: run `quorum commit --list` to review any pending proposals from this work._")
}

// Pending proposals
let pendingCount = 0
try {
  const proposalFiles = await fs.readdir(path.join(".chronicle", "proposals"))
  pendingCount = proposalFiles.filter(f => f.endsWith(".json")).length
} catch { /* no proposals dir */ }

if (pendingCount > 0) {
  lines.push(`\n**${pendingCount} proposal${pendingCount === 1 ? "" : "s"} pending** — run \`quorum commit --list\` to review and commit.`)
}

lines.push("\n---")
lines.push("_Run `quorum growth` for full Chronicle health · `quorum evolve` to consolidate entries_")

const comment = lines.join("\n")

// Post the comment
try {
  execSync(`gh pr comment ${PR_NUMBER} --body ${JSON.stringify(comment)}`, { stdio: "inherit" })
  console.log(`Posted Chronicle growth comment on PR #${PR_NUMBER}`)
} catch (err) {
  console.warn("Could not post PR comment:", err.message)
  process.exit(0)  // non-fatal — don't block the workflow
}
