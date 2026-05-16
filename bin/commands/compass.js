#!/usr/bin/env node
import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { c } from "../shared/colors.js"
import { findChronicleDir, readCommitted } from "../shared/chronicle.js"
import { detectProvider } from "../shared/llm.js"

// ── Chronicle / BM25 helpers ──────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
}

function bm25Score(query, entry) {
  const qTokens = new Set(tokenize(query))
  const text = [
    entry.key_insight ?? "",
    entry.decision    ?? "",
    ...(entry.affected_areas ?? []),
    ...(entry.scope          ?? []),
    entry.topic              ?? "",
  ].join(" ")
  const eTokens = tokenize(text)
  const overlap = eTokens.filter(t => qTokens.has(t)).length
  return overlap / Math.sqrt(qTokens.size * eTokens.length + 1)
}

function queryChronicle(entries, query, limit = 8) {
  return entries
    .map(e => ({ entry: e, score: bm25Score(query, e) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

function collectBearings(entries, area) {
  const queries = [
    area ?? "product direction goals decisions",
    "rejected approaches refuted alternatives",
    "constraints scope",
  ]
  const seen = new Set()
  const bearings = []
  for (const q of queries) {
    for (const entry of queryChronicle(entries, q)) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      const text = entry.decision ?? entry.key_insight ?? ""
      bearings.push({
        id: `bearing-${(entry.id ?? "").slice(0, 8)}`,
        summary: text,
        confidence: entry.confidence ?? 0.7,
        status: entry.status,
      })
    }
  }
  return bearings
}

function formatBearings(bearings) {
  if (!bearings.length) return "No Chronicle entries found."
  return bearings
    .map(b => {
      const tag = b.status === "refuted" ? " [REJECTED]" : b.status === "validated" ? " [VALIDATED]" : ""
      return `[${b.id}]${tag} ${b.summary}`
    })
    .join("\n")
}

// ── Source scanning ───────────────────────────────────────────────────────────

function inferTags(text) {
  const tags = []
  const lower = text.toLowerCase()
  const keywords = ["oracle","advisor","jury","council","sentinel","compass","cli","api","auth","test","docs","config","chronicle","llm","module"]
  for (const kw of keywords) if (lower.includes(kw)) tags.push(kw)
  return tags
}

async function scanDocs(rootDir, area) {
  const findings = []
  let idx = 0
  const targets = ["README.md","SETUP.md","CLAUDE.md","AGENTS.md","modules/README.md","quorum/CLAUDE.md","docs"]
  async function scanMd(filePath) {
    let content
    try { content = await fs.readFile(filePath, "utf8") } catch { return }
    const rel = path.relative(rootDir, filePath).replace(/\\/g, "/")
    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const m = line.match(/^#{1,3}\s+(.+)/)
      if (m) {
        const heading = m[1].trim()
        const context = lines.slice(i + 1, i + 4).join(" ").replace(/```[^`]*```/g, "").trim().slice(0, 200)
        findings.push({ id: `docs-${idx++}`, kind: "docs", source: rel, path: rel, line: i + 1, title: heading, summary: context || heading, confidence: 0.8, tags: inferTags(heading + " " + context) })
      }
      const trimmed = line.trim()
      if (trimmed.startsWith("quorum ") || trimmed.startsWith("npx quorum")) {
        findings.push({ id: `docs-cmd-${idx++}`, kind: "docs", source: rel, path: rel, line: i + 1, title: `CLI usage: ${trimmed.slice(0, 60)}`, summary: `Documented command: ${trimmed}`, confidence: 0.85, tags: ["cli", "command", ...inferTags(trimmed)] })
      }
    }
  }
  async function scanDir(dir) {
    let entries
    try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory() && !["node_modules",".git","dist"].includes(entry.name)) await scanDir(full)
      else if (entry.isFile() && entry.name.endsWith(".md")) await scanMd(full)
    }
  }
  for (const target of targets) {
    const full = path.join(rootDir, target)
    let stat
    try { stat = await fs.stat(full) } catch { continue }
    if (stat.isDirectory()) await scanDir(full)
    else await scanMd(full)
  }
  return area ? findings.filter(f => !area || f.tags.includes(area.toLowerCase()) || f.summary.toLowerCase().includes(area.toLowerCase())) : findings
}

async function scanPackage(rootDir) {
  const findings = []
  let idx = 0
  let pkg
  try { pkg = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8")) } catch { return findings }
  if (pkg.name) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package name", summary: `Published as: ${pkg.name}`, confidence: 1, tags: ["package","identity"] })
  if (pkg.description) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package description", summary: String(pkg.description), confidence: 1, tags: ["package","description"] })
  if (pkg.bin) for (const [name, entry] of Object.entries(pkg.bin)) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: `CLI binary: ${name}`, summary: `CLI binary '${name}' at ${entry}`, confidence: 1, tags: ["cli","binary"] })
  if (pkg.exports) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package exports", summary: `Exports: ${JSON.stringify(pkg.exports)}`, confidence: 0.95, tags: ["exports","api"] })
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) }
  if (Object.keys(deps).length > 0) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Runtime dependencies", summary: Object.keys(deps).join(", "), confidence: 0.9, tags: ["dependencies"] })
  return findings
}

async function scanCli(rootDir, area) {
  const findings = []
  let idx = 0
  const binDir = path.join(rootDir, "bin", "commands")
  let files
  try { files = (await fs.readdir(binDir)).filter(f => f.endsWith(".js")) } catch { return findings }
  for (const file of files) {
    const cmdName = file.replace(".js", "")
    let content
    try { content = await fs.readFile(path.join(binDir, file), "utf8") } catch { continue }
    const rel = `bin/commands/${file}`
    const subcmds = [...content.matchAll(/case ["']([a-z-]+)["']/g)].map(m => m[1])
    const flags = [...new Set([...content.matchAll(/["'](--[a-z-]+)["']/g)].map(m => m[1]))]
    const usesLLM = /llm|LLM|provider|model/.test(content)
    const readsChronicle = /readCommitted|findChronicleDir|committed/.test(content)
    findings.push({
      id: `cli-${idx++}`, kind: "cli", source: rel, path: rel, title: `Command: quorum ${cmdName}`,
      summary: [`quorum ${cmdName}`, subcmds.length ? `Subcommands: ${subcmds.join(", ")}` : "", flags.length ? `Flags: ${flags.slice(0,8).join(", ")}` : "", usesLLM ? "Uses LLM" : "No LLM", readsChronicle ? "Reads Chronicle" : ""].filter(Boolean).join(" | "),
      confidence: 0.9,
      tags: ["cli","command",cmdName,...subcmds.map(s => `subcommand:${s}`), usesLLM ? "llm" : "deterministic"].filter(Boolean),
    })
  }
  return area ? findings.filter(f => f.tags.includes(area.toLowerCase()) || f.summary.toLowerCase().includes(area.toLowerCase())) : findings
}

async function scanRepo(rootDir) {
  const findings = []
  let idx = 0
  const modulesDir = path.join(rootDir, "modules")
  try {
    const entries = await fs.readdir(modulesDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "shared") {
        findings.push({ id: `repo-module-${idx++}`, kind: "code", source: `modules/${entry.name}/`, path: `modules/${entry.name}/`, title: `Module: ${entry.name}`, summary: `TypeScript module: modules/${entry.name}/`, confidence: 0.85, tags: ["module", entry.name, "code"] })
      }
    }
  } catch { /* no modules dir */ }
  return findings
}

async function collectTerrain(rootDir, area) {
  const [docs, pkg, cli, repo] = await Promise.all([
    scanDocs(rootDir, area),
    scanPackage(rootDir),
    scanCli(rootDir, area),
    scanRepo(rootDir),
  ])
  return [...docs, ...pkg, ...cli, ...repo]
}

function formatTerrain(findings, limit = 40) {
  if (!findings.length) return "No product behaviour found in sources."
  const groups = {}
  for (const f of findings.slice(0, limit)) {
    groups[f.kind] = groups[f.kind] ?? []
    groups[f.kind].push(f)
  }
  return Object.entries(groups).map(([kind, items]) =>
    `### ${kind}\n${items.map(f => `  - ${f.summary.slice(0, 120)}`).join("\n")}`
  ).join("\n\n")
}

// ── Behaviour mapping ─────────────────────────────────────────────────────────

function inferArea(f) {
  const lower = (f.title + " " + f.summary).toLowerCase()
  for (const area of ["oracle","advisor","jury","council","sentinel","compass","chronicle","onboarding"]) {
    if (lower.includes(area)) return area
  }
  return f.tags?.find(t => !["cli","command","llm","deterministic","chronicle","module","code"].includes(t)) ?? "general"
}

function extractCommand(text) {
  const m = text.match(/quorum\s+(\w+)/)
  return m ? m[1] : ""
}

function findingToRef(f) {
  return { id: f.id, kind: f.kind, source: f.source, path: f.path ?? f.source, summary: f.summary, confidence: f.confidence }
}

function mapBehaviors(findings, area) {
  const behaviors = []
  const gaps = []

  const cliFindings = findings.filter(f => f.kind === "cli")
  for (const f of cliFindings) {
    behaviors.push({ id: `behavior-cli-${f.id}`, area: inferArea(f), name: f.title, current_behavior: f.summary, evidence: [findingToRef(f)], confidence: f.confidence })
  }

  const docsCliFindings = findings.filter(f => f.kind === "docs" && f.tags?.includes("cli"))
  for (const f of docsCliFindings) {
    const cmd = extractCommand(f.summary)
    const alreadyPresent = cmd.length > 3 && behaviors.some(b => b.current_behavior.toLowerCase().includes(cmd.toLowerCase()))
    if (!alreadyPresent && cmd) {
      behaviors.push({ id: `behavior-docs-${f.id}`, area: inferArea(f), name: `Documented: ${f.title}`, current_behavior: f.summary, evidence: [findingToRef(f)], confidence: f.confidence * 0.9 })
    }
  }

  const EXPECTED = ["onboarding","chronicle","advisor","review"]
  for (const expected of EXPECTED) {
    const has = behaviors.some(b => b.area === expected || b.name.toLowerCase().includes(expected))
    if (!has) {
      gaps.push({ id: `gap-${expected}`, area: expected, gap: `No first-class CLI command found for '${expected}'.`, why_it_matters: `'${expected}' appears in product docs but has no dedicated CLI surface.`, confidence: 0.7 })
    }
  }

  if (!behaviors.some(b => b.name.toLowerCase().includes("compass"))) {
    gaps.push({ id: "gap-product-direction", area: "product direction", gap: "No product behaviour mapping or direction module currently exists.", why_it_matters: "Quorum helps agents avoid repeating engineering mistakes, but has no module to help avoid repeating product-direction mistakes.", confidence: 0.93 })
  }

  const filtered = area ? behaviors.filter(b => b.area.toLowerCase().includes(area.toLowerCase()) || b.name.toLowerCase().includes(area.toLowerCase())) : behaviors
  const filteredGaps = area ? gaps.filter(g => g.area.toLowerCase().includes(area.toLowerCase())) : gaps
  const confidence = filtered.length ? filtered.reduce((s, b) => s + b.confidence, 0) / filtered.length : 0.5

  return { generated_at: new Date().toISOString(), area, behaviors: filtered, gaps: filteredGaps, contradictions: [], confidence: Math.round(confidence * 100) / 100 }
}

function summarizeBehaviorMap(map) {
  const lines = []
  if (map.behaviors.length) {
    lines.push("## Current behaviours")
    for (const b of map.behaviors.slice(0, 20)) lines.push(`  ✓ ${b.current_behavior.slice(0, 100)}`)
  }
  if (map.gaps.length) {
    lines.push("## Gaps")
    for (const g of map.gaps) lines.push(`  ? [${g.area}] ${g.gap}`)
  }
  return lines.join("\n") || "No behaviours mapped."
}

// ── Score computation ─────────────────────────────────────────────────────────

function computeScore(dims) {
  const raw =
    dims.strategic_fit         * 20 +
    dims.user_problem_clarity  * 15 +
    dims.evidence_strength     * 20 +
    dims.leverage              * 10 +
    dims.feasibility           * 15 +
    dims.time_to_signal        * 10 +
    dims.reversibility         * 10 -
    dims.complexity_penalty    * 10 -
    dims.dependency_penalty    *  8 -
    dims.contradiction_penalty * 15 -
    dims.evidence_gap_penalty  * 12
  return { ...dims, total: Math.max(0, Math.min(100, Math.round(raw))) }
}

// ── Prompts ───────────────────────────────────────────────────────────────────

const COMPASS_SYSTEM_PROMPT = `You are Quorum Compass, the product-direction module for an AI-assisted software team.

Your job is to help decide where the product should go next.

You are not a generic brainstormer.
You must ground every recommendation in provided evidence.

Evidence may come from:
- Chronicle memory (human-approved past decisions)
- current code behaviour
- docs
- tests
- package metadata
- CLI commands

Rules:
1. Separate known facts from inferences and assumptions.
2. Never claim user demand unless user evidence (analytics, support, issues) is provided.
3. Prefer small, reversible next moves unless asked for big bets.
4. Identify contradictions with Chronicle or current product behaviour.
5. Include assumptions, invalidation signals, and open questions.
6. Do not recommend implementation details beyond product-level guidance.
7. Return only valid JSON matching the requested schema.
8. When no analytics/support data is connected, always state: "No direct user signal connected."`

function buildBriefPrompt(chronicleCtx, behaviorCtx, area) {
  return `Produce a Compass Brief — a summary of current product direction.

${area ? `Focus area: ${area}\n` : ""}
## Chronicle evidence (approved project memory)
${chronicleCtx}

## Current product behaviour
${behaviorCtx}

Return ONLY valid JSON with this exact schema (no markdown fences, no explanation):
{
  "product_direction": "<one clear sentence>",
  "known_from_chronicle": ["<fact from Chronicle>"],
  "known_from_behavior": ["<fact from code/docs/tests>"],
  "inferred": ["<inference>"],
  "assumptions": ["<assumption>"],
  "unknowns": ["<unknown — include 'No analytics or support evidence connected' if no user data>"],
  "missing_evidence": ["<what would improve this brief>"],
  "recommended_next_step": "<specific quorum command or action>",
  "confidence": <number 0–1>
}`
}

function buildPathwaysPrompt(goal, horizon, appetite, chronicleCtx, behaviorCtx, area, limit) {
  return `Generate ${limit ?? 5} product pathways toward the following goal.

Goal: ${goal}
${horizon ? `Horizon: ${horizon}` : ""}
${appetite ? `Appetite: ${appetite}` : ""}
${area ? `Focus area: ${area}` : ""}

## Chronicle evidence
${chronicleCtx}

## Current product behaviour
${behaviorCtx}

Return ONLY valid JSON: { "pathways": [ { "id":"<slug>","kind":"product_pathway","title":"<title>","goal":"<goal>","target_user":"<who>","problem":"<problem>","current_behaviors":["<behaviour>"],"opportunity":"<gap>","why_now":"<why>","smallest_useful_version":"<mvp>","phases":[{"name":"<phase>","outcome":"<outcome>","user_value":"<value>","build_notes":["<note>"],"dependencies":["<dep>"],"risks":["<risk>"]}],"dependencies":["<dep>"],"risks":["<risk>"],"assumptions":["<assumption>"],"open_questions":["<question>"],"evidence":[{"id":"<id>","kind":"<kind>","source":"<source>","summary":"<summary>","confidence":<0-1>}],"scores":{"strategic_fit":<0-1>,"user_problem_clarity":<0-1>,"evidence_strength":<0-1>,"leverage":<0-1>,"feasibility":<0-1>,"time_to_signal":<0-1>,"reversibility":<0-1>,"complexity_penalty":<0-1>,"dependency_penalty":<0-1>,"contradiction_penalty":<0-1>,"evidence_gap_penalty":<0-1>,"total":<0-100>},"confidence":<0-1>,"time_to_signal":"<timeframe>","reversibility":"high|medium|low","suggested_next_step":"<step>" } ] }

Sort by scores.total descending. Assumptions must always be present.`
}

function buildBetsPrompt(horizon, goal, appetite, chronicleCtx, behaviorCtx) {
  return `Generate 2–3 strategic product bets.

${horizon ? `Horizon: ${horizon}` : ""}
${goal ? `Goal: ${goal}` : ""}
${appetite ? `Appetite: ${appetite}` : ""}

## Chronicle evidence
${chronicleCtx}

## Current product behaviour
${behaviorCtx}

Return ONLY valid JSON: { "bets": [ { "id":"<slug>","kind":"product_bet","title":"<title>","thesis":"<falsifiable hypothesis>","why_now":"<why>","target_user":"<who>","upside":"<best case>","downside":"<downside>","assumptions":["<assumption>"],"validation_signals":["<signal>"],"invalidation_signals":["<signal>"],"kill_criteria":["<criteria>"],"first_experiment":"<smallest test>","build_path":["<phase>"],"evidence":[{"id":"<id>","kind":"<kind>","source":"<source>","summary":"<summary>","confidence":<0-1>}],"scores":{"strategic_fit":<0-1>,"user_problem_clarity":<0-1>,"evidence_strength":<0-1>,"leverage":<0-1>,"feasibility":<0-1>,"time_to_signal":<0-1>,"reversibility":<0-1>,"complexity_penalty":<0-1>,"dependency_penalty":<0-1>,"contradiction_penalty":<0-1>,"evidence_gap_penalty":<0-1>,"total":<0-100>},"confidence":<0-1>,"time_to_signal":"<timeframe>","reversibility":"high|medium|low","appetite":"small|medium|large" } ] }

Kill criteria and invalidation_signals must be present. If no user evidence, evidence_strength ≤ 0.4.`
}

function buildScorePrompt(idea, chronicleCtx, behaviorCtx) {
  return `Evaluate this product idea.

Idea: ${idea}

## Chronicle evidence
${chronicleCtx}

## Current product behaviour
${behaviorCtx}

Return ONLY valid JSON: { "idea":"${idea}","summary":"<one sentence>","recommendation":"pursue|pursue-small-test|investigate-more|defer|avoid","scores":{"strategic_fit":<0-1>,"user_problem_clarity":<0-1>,"evidence_strength":<0-1>,"leverage":<0-1>,"feasibility":<0-1>,"time_to_signal":<0-1>,"reversibility":<0-1>,"complexity_penalty":<0-1>,"dependency_penalty":<0-1>,"contradiction_penalty":<0-1>,"evidence_gap_penalty":<0-1>,"total":<0-100>},"evidence":[{"id":"<id>","kind":"<kind>","source":"<source>","summary":"<summary>","confidence":<0-1>}],"supporting_reasons":["<reason>"],"risks":["<risk>"],"assumptions":["<assumption>"],"open_questions":["<question>"],"suggested_next_step":"<action>" }

Score total = strategic_fit*20 + user_problem_clarity*15 + evidence_strength*20 + leverage*10 + feasibility*15 + time_to_signal*10 + reversibility*10 - complexity_penalty*10 - dependency_penalty*8 - contradiction_penalty*15 - evidence_gap_penalty*12. Clamp 0–100.`
}

// ── LLM helper ────────────────────────────────────────────────────────────────

function parseLLMJson(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim()
  return JSON.parse(cleaned)
}

async function callLLM(llm, userPrompt) {
  if (!llm) throw new Error("LLM provider is required for this subcommand. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.")
  return llm([
    { role: "system", content: COMPASS_SYSTEM_PROMPT },
    { role: "user",   content: userPrompt },
  ])
}

// ── Proposal staging ──────────────────────────────────────────────────────────

async function stageProposal(chronicleDir, artifactKind, payload) {
  const title = payload.title ?? payload.idea ?? "Compass artifact"
  const decision = artifactKind === "product_bet"
    ? `Product bet: ${title}. Thesis: ${payload.thesis ?? ""}`.slice(0, 300)
    : artifactKind === "product_pathway"
    ? `Product pathway: ${title}. ${payload.opportunity ?? ""}`.slice(0, 300)
    : `Product idea scored: ${title}. Recommendation: ${payload.recommendation ?? ""}`.slice(0, 300)

  const entry = {
    schema_version: 2,
    topic: `product/${artifactKind.replace("product_", "")}/${title.slice(0, 40).replace(/\s+/g, "-").toLowerCase()}`,
    key_insight: decision.slice(0, 200),
    decision,
    scope: ["product", "compass", artifactKind.replace("product_", "")],
    affected_areas: [],
    status: "open",
    confidence: payload.confidence ?? 0.7,
    source_module: "compass",
    evidence_cited: [],
    alternatives_considered: [],
    rejected_reason: [],
    validation_plan: (payload.kill_criteria ?? []).slice(0, 3),
  }

  const id = randomUUID()
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })
  await fs.writeFile(path.join(proposalsDir, `${id}.json`), JSON.stringify(entry, null, 2), "utf8")
  return { proposal_id: id, message: `Staged Chronicle proposal ${id.slice(0, 8)} — run 'quorum commit --list' to review.` }
}

async function stageOutcome(chronicleDir, entryId, result, note) {
  const resultLabel = { validated: "has been validated", "partially-validated": "has been partially validated", invalidated: "has been invalidated", unclear: "outcome is unclear", superseded: "has been superseded" }
  const label = resultLabel[result] ?? result
  const decision = `Product bet/pathway ${entryId.slice(0, 8)} ${label}.${note ? " " + note : ""}`

  const entry = {
    schema_version: 2,
    topic: `product/outcome/${entryId.slice(0, 8)}`,
    key_insight: decision.slice(0, 200),
    decision,
    scope: ["product", "compass", "outcome"],
    affected_areas: [],
    status: "validated",
    confidence: result === "validated" ? 0.9 : result === "partially-validated" ? 0.7 : 0.6,
    source_module: "compass",
    evidence_cited: [entryId],
    alternatives_considered: [],
    rejected_reason: [],
    validation_plan: [],
    post_merge_result: result === "validated" ? "successful" : result === "invalidated" ? "rolled-back" : result === "partially-validated" ? "partial" : undefined,
  }

  const id = randomUUID()
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })
  await fs.writeFile(path.join(proposalsDir, `${id}.json`), JSON.stringify(entry, null, 2), "utf8")
  return { proposal_id: id, message: `Staged outcome proposal ${id.slice(0, 8)} — run 'quorum commit --list' to review.` }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function help() {
  console.log(`
${c.bold("quorum compass")} — product-direction synthesis

${c.bold("Usage:")}
  quorum compass <subcommand> [options]

${c.bold("Subcommands:")}
  brief                 Summarise current product direction (LLM)
  map                   Map current product behaviours from code + docs (no LLM)
  behavior              Answer a product-behaviour question
  opportunities         List gaps and opportunities from the behaviour map
  pathways              Generate product pathways toward a goal (LLM)
  bets                  Generate strategic big bets (LLM)
  score <idea>          Score a product idea (LLM)
  spec <title>          Generate a lightweight product brief (LLM)
  propose               Stage a Chronicle entry from a Compass artifact
  outcome               Record the outcome of a prior bet or pathway

${c.bold("Options:")}
  --area <tag>          Focus on a specific product area
  --goal <text>         Goal for pathways / bets
  --horizon <text>      Horizon for bets (e.g. "6 months")
  --appetite small|medium|large
  --limit <n>           Max results to return
  --json                Output raw JSON
  --help                Show this help

${c.bold("Examples:")}
  quorum compass brief
  quorum compass map
  quorum compass map --area advisor
  quorum compass pathways --goal "onboard new agents faster"
  quorum compass bets --horizon "6 months"
  quorum compass score "add Slack integration"
  quorum compass spec "Smart retry backoff"
  quorum compass opportunities --limit 5
  quorum compass propose --from-last
  quorum compass outcome --entry-id <id> --result validated`)
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderBrief(brief) {
  console.log(`\n${c.bold("Compass Brief")} ${c.dim(`(confidence: ${(brief.confidence * 100).toFixed(0)}%)`)}`)
  console.log(`\n${c.bold("Direction:")} ${brief.product_direction}`)

  if (brief.known_from_chronicle?.length) {
    console.log(`\n${c.bold("From Chronicle:")}`)
    brief.known_from_chronicle.forEach(item => console.log(`  ${c.green("✓")} ${item}`))
  }
  if (brief.known_from_behavior?.length) {
    console.log(`\n${c.bold("From code/docs:")}`)
    brief.known_from_behavior.slice(0, 6).forEach(item => console.log(`  ${c.green("✓")} ${item}`))
  }
  if (brief.inferred?.length) {
    console.log(`\n${c.bold("Inferred:")}`)
    brief.inferred.forEach(item => console.log(`  ${c.yellow("~")} ${item}`))
  }
  if (brief.unknowns?.length) {
    console.log(`\n${c.bold("Unknowns:")}`)
    brief.unknowns.forEach(item => console.log(`  ${c.dim("?")} ${item}`))
  }
  if (brief.opportunities?.length) {
    console.log(`\n${c.bold("Opportunities:")}`)
    brief.opportunities.slice(0, 4).forEach(o => console.log(`  ${c.cyan("→")} ${o.title}`))
  }
  if (brief.recommended_next_step) {
    console.log(`\n${c.bold("Next step:")} ${brief.recommended_next_step}`)
  }
}

function renderBehaviorMap(map) {
  console.log(`\n${c.bold("Behaviour Map")} ${map.area ? c.dim(`(area: ${map.area})`) : ""} ${c.dim(`(confidence: ${(map.confidence * 100).toFixed(0)}%)`)}`)

  if (map.behaviors.length > 0) {
    console.log(`\n${c.bold(`Behaviours (${map.behaviors.length}):`)}`)
    map.behaviors.slice(0, 20).forEach(b => {
      console.log(`  ${c.green("✓")} ${b.current_behavior.slice(0, 100)}`)
    })
  } else {
    console.log(`\n  ${c.dim("No behaviours found.")}`)
  }

  if (map.gaps.length > 0) {
    console.log(`\n${c.bold(`Gaps (${map.gaps.length}):`)}`)
    map.gaps.forEach(g => {
      console.log(`  ${c.yellow("?")} [${g.area}] ${g.gap}`)
    })
  }

  if (map.contradictions?.length) {
    console.log(`\n${c.bold(`Contradictions (${map.contradictions.length}):`)}`)
    map.contradictions.slice(0, 5).forEach(ct => {
      console.log(`  ${c.red("!")} ${ct.description ?? JSON.stringify(ct).slice(0, 80)}`)
    })
  }
}

function renderPathways(pathways) {
  console.log(`\n${c.bold(`Pathways (${pathways.length})`)}`)
  pathways.forEach((p, i) => {
    const score = p.scores?.total ?? "?"
    const label =
      score >= 85 ? c.green(`${score}`) :
      score >= 70 ? c.cyan(`${score}`) :
      score >= 55 ? c.yellow(`${score}`) :
      c.dim(`${score}`)

    console.log(`\n${c.bold(`${i + 1}. ${p.title}`)} ${c.dim("[")}${label}${c.dim("]")}`)
    if (p.opportunity) console.log(`   ${p.opportunity}`)
    if (p.smallest_useful_version) console.log(`   ${c.dim("Start:")} ${p.smallest_useful_version}`)
    if (p.suggested_next_step) console.log(`   ${c.dim("Next:")} ${p.suggested_next_step}`)
    if (p.assumptions?.length) {
      console.log(`   ${c.dim("Assumes:")} ${p.assumptions[0]}`)
    }
  })
}

function renderBets(bets) {
  console.log(`\n${c.bold(`Strategic Bets (${bets.length})`)}`)
  bets.forEach((b, i) => {
    const score = b.scores?.total ?? "?"
    console.log(`\n${c.bold(`${i + 1}. ${b.title}`)} ${c.dim(`[${score}]`)}`)
    console.log(`   ${c.dim("Thesis:")} ${b.thesis}`)
    if (b.first_experiment) console.log(`   ${c.dim("First test:")} ${b.first_experiment}`)
    if (b.kill_criteria?.length) console.log(`   ${c.red("Kill if:")} ${b.kill_criteria[0]}`)
    if (b.assumptions?.length) console.log(`   ${c.dim("Assumes:")} ${b.assumptions[0]}`)
  })
}

function renderScore(score) {
  const total = score.scores?.total ?? 0
  const label =
    total >= 85 ? c.green("Very strong — pursue") :
    total >= 70 ? c.cyan("Strong — pursue small test") :
    total >= 55 ? c.yellow("Plausible — investigate more") :
    total >= 40 ? c.dim("Weak — defer") :
    c.red("Avoid")

  console.log(`\n${c.bold(`Score: ${total}/100`)} — ${label}`)
  console.log(`Idea: ${score.idea}`)
  if (score.summary) console.log(`Summary: ${score.summary}`)

  if (score.supporting_reasons?.length) {
    console.log(`\n${c.bold("Strengths:")}`)
    score.supporting_reasons.forEach(r => console.log(`  ${c.green("+")} ${r}`))
  }
  if (score.risks?.length) {
    console.log(`\n${c.bold("Risks:")}`)
    score.risks.forEach(r => console.log(`  ${c.red("-")} ${r}`))
  }
  if (score.open_questions?.length) {
    console.log(`\n${c.bold("Open questions:")}`)
    score.open_questions.forEach(q => console.log(`  ${c.dim("?")} ${q}`))
  }
  if (score.suggested_next_step) {
    console.log(`\n${c.bold("Next step:")} ${score.suggested_next_step}`)
  }
}

function renderOpportunities(opps) {
  if (!opps.length) {
    console.log(c.dim("\nNo gaps or opportunities found from current sources."))
    return
  }
  console.log(`\n${c.bold(`Opportunities (${opps.length})`)}`)
  opps.forEach((o, i) => {
    const conf = `${(o.confidence * 100).toFixed(0)}%`
    console.log(`\n${c.bold(`${i + 1}. ${o.title}`)} ${c.dim(`[${o.area}] [${o.evidence_strength}] [${conf}]`)}`)
    if (o.why_it_matters) console.log(`   ${o.why_it_matters}`)
    if (o.suggested_next_step) console.log(`   ${c.dim("Next:")} ${o.suggested_next_step}`)
  })
}

function renderProductBrief(brief) {
  console.log(`\n${c.bold(`Product Brief: ${brief.title}`)}`)
  if (brief.problem) console.log(`\n${c.bold("Problem:")} ${brief.problem}`)
  if (brief.target_user) console.log(`${c.bold("Target user:")} ${brief.target_user}`)
  if (brief.recommended_solution) {
    console.log(`\n${c.bold("Recommended solution:")}`)
    console.log(`  ${brief.recommended_solution}`)
  }
  if (brief.smallest_useful_version) {
    console.log(`\n${c.bold("Smallest useful version:")}`)
    console.log(`  ${brief.smallest_useful_version}`)
  }
  if (brief.non_goals?.length) {
    console.log(`\n${c.bold("Non-goals:")}`)
    brief.non_goals.forEach(g => console.log(`  ${c.dim("✗")} ${g}`))
  }
  if (brief.risks?.length) {
    console.log(`\n${c.bold("Risks:")}`)
    brief.risks.forEach(r => console.log(`  ${c.red("-")} ${r}`))
  }
  if (brief.open_questions?.length) {
    console.log(`\n${c.bold("Open questions:")}`)
    brief.open_questions.forEach(q => console.log(`  ${c.dim("?")} ${q}`))
  }
  if (brief.suggested_quorum_checks?.length) {
    console.log(`\n${c.bold("Quorum checks:")}`)
    brief.suggested_quorum_checks.forEach(ch => console.log(`  ${c.cyan("$")} ${ch}`))
  }
}

// ── Last-run artifact cache (used by --from-last) ─────────────────────────────

let _lastArtifact = null

// ── Main ─────────────────────────────────────────────────────────────────────

export async function run(argv) {
  const [subcommand, ...rest] = argv

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    help()
    return
  }

  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a.startsWith("--")) {
      const key = a.slice(2)
      const val = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true
      flags[key] = val
    } else {
      positional.push(a)
    }
  }

  const area      = flags["area"]
  const goal      = flags["goal"]     || positional.join(" ") || undefined
  const horizon   = flags["horizon"]  || undefined
  const appetite  = flags["appetite"] || undefined
  const limitN    = flags["limit"]    ? parseInt(flags["limit"], 10) : undefined
  const jsonMode  = Boolean(flags["json"])
  const entryId   = flags["entry-id"] || flags["entryId"] || undefined
  const result    = flags["result"]   || undefined

  // ── Setup ─────────────────────────────────────────────────────────────────

  const rootDir      = process.cwd()
  const chronicleDir = findChronicleDir(rootDir)

  if (!chronicleDir) {
    console.error(c.red("Error: Chronicle not found. Run 'quorum init' first."))
    process.exit(1)
  }

  const NO_LLM_CMDS = new Set(["map", "opportunities"])
  const llm = NO_LLM_CMDS.has(subcommand) ? undefined : detectProvider()

  // ── Shared context helper ─────────────────────────────────────────────────

  async function getContext(areaFilter) {
    const [entries, findings] = await Promise.all([
      readCommitted(chronicleDir),
      collectTerrain(rootDir, areaFilter),
    ])
    const bearings = collectBearings(entries, areaFilter)
    const chronicleCtx = formatBearings(bearings)
    const behaviorCtx = formatTerrain(findings)
    const behaviorMap = mapBehaviors(findings, areaFilter)
    return { entries, findings, bearings, chronicleCtx, behaviorCtx, behaviorMap }
  }

  // ── Route subcommand ───────────────────────────────────────────────────────

  try {
    switch (subcommand) {
      case "brief": {
        const { chronicleCtx, behaviorCtx, behaviorMap } = await getContext(area)
        if (!llm) {
          const data = {
            product_direction: "Unable to synthesize direction — no LLM configured. See Chronicle and behaviour map for raw evidence.",
            known_from_chronicle: [],
            known_from_behavior: behaviorMap.behaviors.slice(0, 5).map(b => b.current_behavior),
            inferred: [],
            unknowns: ["LLM not configured — full synthesis unavailable."],
            recommended_next_step: "Run: quorum advisor brief",
            confidence: 0.4,
          }
          if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
          renderBrief(data)
          break
        }
        const raw = await callLLM(llm, buildBriefPrompt(chronicleCtx, behaviorCtx, area))
        let data
        try { data = parseLLMJson(raw) } catch { throw new Error(`Compass brief: LLM returned non-JSON. Raw: ${raw.slice(0, 300)}`) }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderBrief(data)
        break
      }

      case "map": {
        const findings = await collectTerrain(rootDir, area)
        const data = mapBehaviors(findings, area)
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderBehaviorMap(data)
        break
      }

      case "behavior": {
        const question = goal || positional.join(" ")
        if (!question) {
          console.error(c.red('Error: provide a question, e.g. quorum compass behavior "what does quorum do for onboarding?"'))
          process.exit(1)
        }
        const findings = await collectTerrain(rootDir, area)
        const behaviorMap = mapBehaviors(findings, area)
        const what_exists = behaviorMap.behaviors.slice(0, 6).map(b => b.current_behavior)
        const what_appears_missing = behaviorMap.gaps.slice(0, 4).map(g => g.gap)
        const data = {
          question,
          what_exists,
          what_appears_missing,
          product_implication: behaviorMap.gaps.length > 0
            ? `The area has ${behaviorMap.behaviors.length} documented behaviours but ${behaviorMap.gaps.length} notable gaps.`
            : `The area appears well-covered with ${behaviorMap.behaviors.length} documented behaviours.`,
          confidence: behaviorMap.confidence,
        }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        console.log(`\n${c.bold("Behaviour answer:")} ${data.product_implication}`)
        if (data.what_exists?.length) {
          console.log(`\n${c.bold("What exists:")}`)
          data.what_exists.forEach(e => console.log(`  ${c.green("✓")} ${e}`))
        }
        if (data.what_appears_missing?.length) {
          console.log(`\n${c.bold("Appears missing:")}`)
          data.what_appears_missing.forEach(m => console.log(`  ${c.yellow("?")} ${m}`))
        }
        break
      }

      case "opportunities": {
        const findings = await collectTerrain(rootDir, area)
        const behaviorMap = mapBehaviors(findings, area)
        let opps = behaviorMap.gaps.map((g, i) => ({
          id: `opp-${i}`, title: g.gap, area: g.area,
          why_it_matters: g.why_it_matters,
          evidence_strength: g.confidence >= 0.7 ? "strong" : g.confidence >= 0.5 ? "medium" : "inferred",
          suggested_next_step: `quorum compass pathways --goal "${g.gap.slice(0, 50)}"`,
          confidence: g.confidence,
        }))
        if (limitN) opps = opps.slice(0, limitN)
        if (goal) opps = opps.filter(o => o.title.toLowerCase().includes(goal.toLowerCase()) || o.area.toLowerCase().includes(goal.toLowerCase()))
        if (jsonMode) { console.log(JSON.stringify(opps, null, 2)); break }
        renderOpportunities(opps)
        break
      }

      case "pathways": {
        if (!goal) {
          console.error(c.red('Error: --goal is required. Example: quorum compass pathways --goal "onboard new agents faster"'))
          process.exit(1)
        }
        const { chronicleCtx, behaviorCtx } = await getContext(area)
        const raw = await callLLM(llm, buildPathwaysPrompt(goal, horizon, appetite, chronicleCtx, behaviorCtx, area, limitN))
        let parsed
        try { parsed = parseLLMJson(raw) } catch { throw new Error(`Compass pathways: LLM returned non-JSON. Raw: ${raw.slice(0, 300)}`) }
        const data = (parsed.pathways ?? []).map(p => ({ ...p, scores: computeScore(p.scores ?? {}) }))
        _lastArtifact = { kind: "product_pathway", items: data }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderPathways(data)
        console.log(c.dim("\nTip: run 'quorum compass propose --from-last' to stage a Chronicle entry."))
        break
      }

      case "bets": {
        const { chronicleCtx, behaviorCtx } = await getContext()
        const raw = await callLLM(llm, buildBetsPrompt(horizon, goal, appetite, chronicleCtx, behaviorCtx))
        let parsed
        try { parsed = parseLLMJson(raw) } catch { throw new Error(`Compass bets: LLM returned non-JSON. Raw: ${raw.slice(0, 300)}`) }
        const data = (parsed.bets ?? []).map(b => ({ ...b, scores: computeScore(b.scores ?? {}) }))
        _lastArtifact = { kind: "product_bet", items: data }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderBets(data)
        console.log(c.dim("\nTip: run 'quorum compass propose --from-last' to stage a Chronicle entry."))
        break
      }

      case "score": {
        const idea = goal || positional.join(" ")
        if (!idea) {
          console.error(c.red('Error: provide an idea. Example: quorum compass score "add Slack integration"'))
          process.exit(1)
        }
        const { chronicleCtx, behaviorCtx } = await getContext()
        const raw = await callLLM(llm, buildScorePrompt(idea, chronicleCtx, behaviorCtx))
        let data
        try { data = parseLLMJson(raw) } catch { throw new Error(`Compass score: LLM returned non-JSON. Raw: ${raw.slice(0, 300)}`) }
        if (data.scores) data.scores = computeScore(data.scores)
        _lastArtifact = { kind: "product_idea_score", items: [data] }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderScore(data)
        break
      }

      case "spec": {
        const title = goal || positional.join(" ")
        if (!title) {
          console.error(c.red('Error: provide a title. Example: quorum compass spec "Smart retry backoff"'))
          process.exit(1)
        }
        const { chronicleCtx, behaviorCtx } = await getContext()
        const specPrompt = `Generate a lightweight product brief for: ${title}

## Chronicle evidence
${chronicleCtx}

## Current product behaviour
${behaviorCtx}

Return ONLY valid JSON: { "title":"${title}","problem":"<problem>","target_user":"<user>","recommended_solution":"<solution>","smallest_useful_version":"<mvp>","non_goals":["<non-goal>"],"risks":["<risk>"],"open_questions":["<question>"],"suggested_quorum_checks":["<quorum command>"] }`
        const raw = await callLLM(llm, specPrompt)
        let data
        try { data = parseLLMJson(raw) } catch { throw new Error(`Compass spec: LLM returned non-JSON. Raw: ${raw.slice(0, 300)}`) }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderProductBrief(data)
        break
      }

      case "propose": {
        if (flags["from-last"]) {
          if (!_lastArtifact?.items?.length) {
            console.error(c.red("Error: no Compass artifact in memory. Run pathways/bets/score first in the same session."))
            process.exit(1)
          }
          const item = _lastArtifact.items[0]
          const res = await stageProposal(chronicleDir, _lastArtifact.kind, item)
          console.log(c.green(`\n✓ ${res.message}`))
          break
        }
        console.error(c.red('Error: provide --from-last. Example: quorum compass propose --from-last'))
        process.exit(1)
        break
      }

      case "outcome": {
        if (!entryId) {
          console.error(c.red("Error: --entry-id is required. Example: quorum compass outcome --entry-id abc123 --result validated"))
          process.exit(1)
        }
        if (!result) {
          console.error(c.red("Error: --result is required. Values: validated, partially-validated, invalidated, unclear, superseded"))
          process.exit(1)
        }
        const note = flags["note"] || undefined
        const data = await stageOutcome(chronicleDir, entryId, result, note)
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        console.log(c.green(`\n✓ ${data.message}`))
        break
      }

      default: {
        console.error(c.red(`Unknown subcommand: ${subcommand}`))
        help()
        process.exit(1)
      }
    }
  } catch (err) {
    if (err.message?.includes("LLM provider is required") || err.message?.includes("No LLM provider")) {
      console.error(c.red(`\nError: ${err.message}`))
      console.error(c.dim("Set ANTHROPIC_API_KEY or OPENAI_API_KEY to use this subcommand."))
    } else {
      console.error(c.red(`\nCompass error: ${err.message ?? err}`))
      if (process.env.DEBUG) console.error(err.stack)
    }
    process.exit(1)
  }
}
