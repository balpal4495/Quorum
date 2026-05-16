/**
 * Evaluate the "Quorum as npm CLI" proposal through Jury + Council.
 *
 * LLM provider: Gemini CLI (shells out — requires GEMINI_API_KEY in ~/.zshrc)
 * Oracle: Chronicle entries loaded directly (no embedder required)
 * Council: 3 advisors + 3 reviewers (quota-conscious)
 *
 * Run: npx tsx scripts/evaluate-npm-proposal.ts
 */

import { promises as fs } from "fs"
import { writeFileSync, unlinkSync } from "fs"
import path from "path"
import os from "os"
import { execSync, spawnSync } from "child_process"
import { evaluate } from "../modules/jury/index.js"
import { deliberate } from "../modules/council/index.js"
import type { OracleResult, LLMProvider, OracleClient, ChronicleEntry } from "../modules/shared/types.js"

// ── Colours ──────────────────────────────────────────────────────────────────

const c = {
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[90m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
}

// ── Gemini CLI adapter ────────────────────────────────────────────────────────

// Load env from ~/.zshrc once so every call has GEMINI_API_KEY
let geminiEnv: NodeJS.ProcessEnv | null = null

function loadGeminiEnv(): NodeJS.ProcessEnv {
  if (geminiEnv) return geminiEnv
  try {
    const raw = execSync("source ~/.zshrc && env", {
      shell: "/bin/zsh",
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    })
    const env: NodeJS.ProcessEnv = {}
    for (const line of raw.split("\n")) {
      const idx = line.indexOf("=")
      if (idx === -1) continue
      env[line.slice(0, idx)] = line.slice(idx + 1)
    }
    geminiEnv = env
    return env
  } catch {
    console.error(c.red("Failed to load env from ~/.zshrc"))
    process.exit(1)
  }
}

let callCount = 0

const geminiProvider: LLMProvider = async (messages, _model) => {
  callCount++
  const idx = callCount

  const system = messages.find(m => m.role === "system")?.content ?? ""
  const userMsgs = messages.filter(m => m.role !== "system")
  const fullPrompt = system
    ? `${system}\n\n---\n\n${userMsgs.map(m => m.content).join("\n\n")}`
    : userMsgs.map(m => m.content).join("\n\n")

  const tmpFile = path.join(os.tmpdir(), `quorum-eval-${Date.now()}-${idx}.txt`)
  writeFileSync(tmpFile, fullPrompt, "utf8")

  process.stdout.write(c.dim(`  [llm call ${idx}] gemini... `))

  try {
    const env = loadGeminiEnv()
    const result = spawnSync(
      "/bin/zsh",
      ["-c", `cat "${tmpFile}" | gemini -p "Respond only with the JSON as instructed above."`],
      { encoding: "utf8", env, maxBuffer: 10 * 1024 * 1024 },
    )

    if (result.status !== 0) {
      const stderr = result.stderr?.slice(0, 300) ?? ""
      throw new Error(`Gemini exited ${result.status}: ${stderr}`)
    }

    const out = result.stdout.trim()
    process.stdout.write(c.green(`ok (${out.length} chars)\n`))
    return out
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore */ }
  }
}

// ── Chronicle loader (no embedder needed) ────────────────────────────────────

async function loadChronicleEntries(chronicleDir: string): Promise<ChronicleEntry[]> {
  const committedDir = path.join(chronicleDir, "committed")
  let files: string[]
  try {
    files = await fs.readdir(committedDir)
  } catch {
    return []
  }
  const entries: ChronicleEntry[] = []
  for (const f of files.filter(f => f.endsWith(".json"))) {
    try {
      const raw = await fs.readFile(path.join(committedDir, f), "utf8")
      entries.push(JSON.parse(raw) as ChronicleEntry)
    } catch { /* skip malformed */ }
  }
  return entries
}

function entriesToOracleResults(entries: ChronicleEntry[]): OracleResult[] {
  return entries.map(e => ({ ...e, score: 0.5, tier: "supporting" as const }))
}

// ── No-op Oracle (Chronicle is read-only for this evaluation) ────────────────

function makeReadOnlyOracle(entries: ChronicleEntry[]): OracleClient {
  return {
    query: async (text: string) => {
      // Simple keyword filter — surface entries whose key_insight overlaps with query terms
      const terms = text.toLowerCase().split(/\s+/)
      const scored = entries
        .map(e => {
          const haystack = `${e.key_insight} ${e.affected_areas.join(" ")}`.toLowerCase()
          const hits = terms.filter(t => haystack.includes(t)).length
          return { entry: e, score: hits / terms.length }
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
      return scored.map(r => ({ ...r.entry, score: r.score, tier: "supporting" as const }))
    },
    propose: async (entry) => {
      console.log(c.cyan("\n[oracle.propose() called — staging proposal for human approval]"))
      console.log(c.dim(`  key_insight: ${entry.key_insight.slice(0, 80)}`))
      return { proposalId: `proposal-${Date.now()}` }
    },
    commit: async (_proposalId) => {
      throw new Error("oracle.commit() must be called by a human — never auto-committed")
    },
  }
}

// ── Proposal ──────────────────────────────────────────────────────────────────

const OUTCOME = "Quorum becomes a globally-installable npm CLI that scaffolds new projects and maintains itself in existing ones — replacing the copy-and-paste distribution model"

const DESIGN = `
Publish the existing 'quorum' package to npm (remove "private": true, add a release workflow).
The npm package is a pure CLI — it never becomes a runtime dependency. When installed,
it copies modules into the target project's repository so source remains readable by AI agents.

Three subcommands:

1. npx quorum init  (already exists as bin/init.js, needs minor additions)
   - Copies modules/ into host project
   - Merges CLAUDE.md, AGENTS.md, copilot-instructions.md non-destructively
   - Writes .quorum-version with the installed semver
   - Initialises .chronicle/committed and .chronicle/proposals
   - Adds SENTINEL_CODEBASE_PATH env var hint to CI workflow

2. npx quorum upgrade  (new subcommand)
   - Reads .quorum-version to know current installed version
   - Fetches the new release's modules/ via npm pack or GitHub archive
   - Three-way diff: base version → new version vs base version → local modifications
   - Applies clean file updates automatically
   - Flags files with local modifications for manual review
   - Updates .quorum-version on success

3. npx quorum sentinel  (new subcommand)
   - Runs coverage report locally without CI
   - Output mirrors what sentinel-pr.yml posts as a PR comment
   - Accepts --codebase-path flag to set the source tree root

Design constraints preserved:
- Modules live in the host project's repo, not node_modules
- Source is readable by AI agents (no black box)
- CLAUDE.md and AGENTS.md travel with the code
- Chronicle write path remains human-gated (no auto-commits)
`

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold("\nQuorum — Jury + Council Evaluation"))
  console.log(c.bold("Proposal: npm CLI distribution model\n"))

  // Load Chronicle
  const entries = await loadChronicleEntries(".chronicle")
  console.log(`Chronicle: ${entries.length} committed entries loaded`)

  const oracle = makeReadOnlyOracle(entries)
  const evidence = entriesToOracleResults(entries)

  console.log(c.dim(`Evidence pack: ${evidence.length} entries passed to Jury\n`))

  // ── Jury ──────────────────────────────────────────────────────────────────

  console.log(c.bold("── Jury ──────────────────────────────────────────"))
  console.log(c.dim("Evaluating design against Oracle evidence...\n"))

  const juryOutput = await evaluate(
    { outcome: OUTCOME, design: DESIGN, evidence },
    { llm: geminiProvider },
  )

  console.log(`\n${c.bold("Jury result:")}`)
  console.log(`  confidence:    ${juryOutput.confidence.toFixed(2)}`)
  console.log(`  council_brief: ${juryOutput.council_brief}`)
  console.log(`  recommendation: ${juryOutput.recommendation}`)
  console.log(`  assessment:    ${juryOutput.assessment.slice(0, 200)}`)
  if (juryOutput.gaps.length > 0) {
    console.log(`  gaps:`)
    juryOutput.gaps.forEach(g => console.log(`    • ${g}`))
  }

  if (juryOutput.recommendation === "redesign") {
    console.log(c.yellow("\nJury recommends redesign — skipping Council."))
    return
  }

  // ── Council ───────────────────────────────────────────────────────────────

  console.log(c.bold("\n── Council ───────────────────────────────────────"))
  console.log(c.dim(`Brief: ${juryOutput.council_brief} — 3 advisors, 3 reviewers\n`))

  const councilOutput = await deliberate(
    { outcome: OUTCOME, design: DESIGN, evidence, jury_output: juryOutput },
    {
      llm: geminiProvider,
      oracle,
      advisorCount: 3,
      reviewerCount: 3,
    },
  )

  console.log(`\n${c.bold("Council verdict:")}`)
  console.log(`  satisfied:      ${councilOutput.satisfied}`)
  console.log(`  recommendation: ${councilOutput.recommendation}`)
  console.log(`  evidence_cited: ${councilOutput.evidence_cited.join(", ") || "none"}`)
  console.log(`\n${c.bold("Verdict:")}`)
  console.log(`  ${councilOutput.verdict}`)

  if (councilOutput.challenges.length > 0) {
    console.log(`\n${c.bold("Challenges raised:")}`)
    councilOutput.challenges.forEach(ch => console.log(`  • ${ch}`))
  }

  console.log(`\n${c.dim(`Total LLM calls: ${callCount}`)}`)
  console.log(
    councilOutput.satisfied
      ? c.green("\n→ Council satisfied. Ready for human gate.")
      : c.yellow(`\n→ Council not satisfied. Recommendation: ${councilOutput.recommendation}`),
  )
}

main().catch(err => {
  console.error(c.red("\nEvaluation failed:"), err.message)
  process.exit(1)
})
