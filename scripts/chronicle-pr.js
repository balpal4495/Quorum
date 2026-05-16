#!/usr/bin/env node
/**
 * Creates a Chronicle proposal from a merged PR.
 * Called by chronicle-on-merge.yml on every PR merge to main.
 *
 * Reads PR_NUMBER, PR_TITLE, PR_BODY from env.
 * Uses `gh pr view` to fetch changed files.
 * Writes a v2 ChronicleEntry proposal to .chronicle/proposals/.
 */

import { execSync } from "child_process"
import { promises as fs } from "fs"
import { randomUUID } from "crypto"
import path from "path"

const PR_NUMBER = process.env.PR_NUMBER
const PR_TITLE  = process.env.PR_TITLE ?? ""
const PR_BODY   = process.env.PR_BODY  ?? ""

if (!PR_NUMBER) {
  console.log("No PR_NUMBER set — skipping")
  process.exit(0)
}

let changedFiles = []
try {
  const raw = execSync(`gh pr view ${PR_NUMBER} --json files`, { encoding: "utf8" })
  changedFiles = JSON.parse(raw).files.map(f => f.path)
} catch {
  console.warn("Could not fetch changed files — using empty list")
}

// Derive scope tags from changed file paths
const scope = []
if (changedFiles.some(f => f.startsWith("modules/oracle")))   scope.push("oracle")
if (changedFiles.some(f => f.startsWith("modules/jury")))     scope.push("jury")
if (changedFiles.some(f => f.startsWith("modules/council")))  scope.push("council")
if (changedFiles.some(f => f.startsWith("modules/sentinel"))) scope.push("sentinel")
if (changedFiles.some(f => f.startsWith("modules/shared")))   scope.push("shared")
if (changedFiles.some(f => f.startsWith("bin/")))             scope.push("cli")
if (changedFiles.some(f => f.startsWith(".github/")))         scope.push("ci")
if (changedFiles.some(f => f === "README.md"))                scope.push("docs")
if (changedFiles.some(f => f === "package.json"))             scope.push("npm")
if (scope.length === 0) scope.push("general")

// Extract deferred items — only bullet/list lines that start with a marker and contain "defer"
const deferredLines = PR_BODY
  .split("\n")
  .filter(l => /^[-*]\s.+defer/i.test(l))
  .map(l => l.replace(/^[-*]\s+/, "").trim())
  .filter(Boolean)

// Only include source files in affected_areas — skip proposals/, node_modules, lock files
const sourceFiles = changedFiles.filter(f =>
  !f.startsWith(".chronicle/") &&
  !f.startsWith("node_modules/") &&
  !f.endsWith(".lock") &&
  f !== "package-lock.json"
)

const proposal = {
  schema_version: 2,
  topic: `PR #${PR_NUMBER}`,
  decision: PR_TITLE.slice(0, 200),
  key_insight: PR_TITLE.slice(0, 200),
  affected_areas: sourceFiles.slice(0, 10),
  scope,
  alternatives_considered: [],
  rejected_reason: deferredLines.slice(0, 3),
  supersedes: null,
  superseded_by: null,
  status: "open",
  confidence: 0.4,
  source_quality: "metadata-derived",
  needs_human_summary: true,
  source_module: "pr-merge",
  evidence_cited: [],
  work_ref: { type: "pr", ref: `PR #${PR_NUMBER}` },
  outcome: PR_BODY.slice(0, 500) || undefined,
}

await fs.mkdir(".chronicle/proposals", { recursive: true })
const id = randomUUID()
const proposalPath = path.join(".chronicle", "proposals", `${id}.json`)
await fs.writeFile(proposalPath, JSON.stringify(proposal, null, 2), "utf8")

console.log(`Created Chronicle proposal ${id} for PR #${PR_NUMBER}: "${PR_TITLE}"`)
console.log(`  scope: ${scope.join(", ")}`)
console.log(`  files: ${changedFiles.length} changed`)
console.log(`  path: ${proposalPath}`)
