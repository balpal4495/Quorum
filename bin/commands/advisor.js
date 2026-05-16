import { c } from "../shared/colors.js"
import { findChronicleDir, readCommitted } from "../shared/chronicle.js"
import { detectLLM, detectLLMName } from "../shared/llm.js"

const SATISFACTION_THRESHOLD = 0.7
const MAX_RETRIES = 2

// ── Evidence helpers ──────────────────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
}

function scoreEntry(query, entry) {
  const qTokens = new Set(tokenize(query))
  const text = [
    entry.key_insight ?? "",
    entry.decision    ?? "",
    ...(entry.affected_areas ?? []),
    ...(entry.scope          ?? []),
  ].join(" ")
  const eTokens = tokenize(text)
  const overlap = eTokens.filter(t => qTokens.has(t)).length
  return overlap / Math.sqrt(qTokens.size * eTokens.length + 1)
}

function entryText(entry) {
  return (entry.decision ?? entry.key_insight ?? "").trim()
}

function findRelevant(entries, query, limit = 6) {
  return entries
    .map(e => ({ entry: e, score: scoreEntry(query, e) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry)
}

function formatEvidenceForLLM(entries) {
  if (entries.length === 0) return "Chronicle has no prior entries on this topic."
  return entries.map(e => {
    const statusTag =
      e.status === "refuted"   ? " [REJECTED]"  :
      e.status === "validated" ? " [VALIDATED]" : ""
    return `[${(e.id ?? "").slice(0, 8)}]${statusTag} ${entryText(e)}\n  Areas: ${(e.affected_areas ?? []).join(", ")}`
  }).join("\n\n")
}

// ── LLM + validation loop ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Quorum Advisor — the plain-language interface to a team's collective knowledge.

You receive a question from a developer or engineering manager, along with relevant Chronicle evidence.
Synthesise that evidence into a clear, concise answer a human can act on.

Rules:
- Write for a human who does not know what "Chronicle entries" or "vector search" mean.
- Be direct. One clear recommendation.
- If Chronicle has relevant evidence, reference it plainly: "the team already decided X".
- If Chronicle has no evidence, say so honestly — do not invent history.
- Blockers are hard blockers only — things that MUST be resolved before moving forward.

Return ONLY valid JSON matching this schema (no markdown fences, no explanation):
{
  "confidence": <number 0–1>,
  "what_we_know": <string — what Chronicle knows, plain English, 1–3 sentences>,
  "risks": [<string>],
  "blockers": [<string — hard blockers only, empty array if none>],
  "recommendation": <string — one clear action>,
  "next_step": <string — specific next step or quorum command>
}`

async function callLLM(llm, question, evidence, attempt, previous) {
  let userPrompt = `## Question\n${question}\n\n## Chronicle Evidence\n${formatEvidenceForLLM(evidence)}`

  if (attempt > 0 && previous) {
    const lines = [
      "",
      `## Previous Answer (attempt ${attempt} — quality threshold not met)`,
      `Confidence: ${previous.confidence.toFixed(2)} (need ≥ ${SATISFACTION_THRESHOLD})`,
    ]
    if (previous.blockers?.length > 0) {
      lines.push(`Unresolved blockers: ${previous.blockers.join("; ")}`)
    }
    lines.push("Please produce a more specific and concrete answer.")
    userPrompt += lines.join("\n")
  }

  const raw = await llm([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user",   content: userPrompt },
  ])

  let parsed
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`LLM returned non-JSON. Raw: ${raw.slice(0, 200)}`)
  }

  if (typeof parsed.confidence !== "number" || !parsed.what_we_know || !parsed.recommendation) {
    throw new Error("LLM response missing required fields (confidence, what_we_know, recommendation)")
  }

  return parsed
}

async function runAdvisor(llm, question, evidence) {
  let last = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const answer = await callLLM(llm, question, evidence, attempt, last)
    last = answer
    const satisfied = answer.confidence >= SATISFACTION_THRESHOLD && (answer.blockers?.length ?? 0) === 0
    if (satisfied || attempt === MAX_RETRIES) return { ...answer, retries: attempt }
  }
  return { ...last, retries: MAX_RETRIES }
}

// ── Output renderers ──────────────────────────────────────────────────────────

function renderAsk(question, result) {
  console.log(`\n${c.bold("Advisor")}\n`)
  console.log(`  ${c.dim("Question:")} ${question}\n`)

  console.log(`${c.bold("What we know")}`)
  console.log(`  ${result.what_we_know}\n`)

  if (result.blockers?.length > 0) {
    console.log(`${c.bold(c.red("Blockers"))}`)
    for (const b of result.blockers) console.log(`  ${c.red("✗")}  ${b}`)
    console.log("")
  }

  if (result.risks?.length > 0) {
    console.log(`${c.bold("Risks")}`)
    for (const r of result.risks) console.log(`  ${c.yellow("⚠")}  ${r}`)
    console.log("")
  }

  console.log(`${c.bold("Recommendation")}`)
  console.log(`  ${result.recommendation}\n`)

  console.log(`${c.bold("Next step")}`)
  console.log(`  ${c.cyan(result.next_step)}\n`)

  if (result.retries > 0) {
    console.log(c.dim(`  (Refined over ${result.retries + 1} attempts)\n`))
  }
}

function renderQuery(topic, entries) {
  console.log(`\n${c.bold("Chronicle")}  ${c.dim(`query: "${topic}"`)}\n`)

  if (entries.length === 0) {
    console.log(`  ${c.dim("No matching entries found.")}\n`)
    return
  }

  for (const e of entries) {
    const statusColor =
      e.status === "validated" ? c.green :
      e.status === "refuted"   ? c.red   : c.dim
    console.log(`  ${c.cyan((e.id ?? "").slice(0, 8))}  ${statusColor(`[${e.status}]`)}  ${entryText(e)}`)
    if (e.affected_areas?.length) console.log(`           ${c.dim(e.affected_areas.join(", "))}`)
    console.log("")
  }
}

function renderBrief(allEntries) {
  const validated = allEntries.filter(e => e.status === "validated")
  const refuted   = allEntries.filter(e => e.status === "refuted")
  const open      = allEntries.filter(e => e.status === "open")
  const recent    = allEntries.slice(0, 5)

  console.log(`\n${c.bold("Chronicle Brief")}\n`)
  console.log(`  ${c.green(validated.length)}  validated   ${c.red(refuted.length)}  refuted   ${c.dim(open.length + "  open")}\n`)

  if (recent.length > 0) {
    console.log(`${c.bold("Recent entries")}`)
    for (const e of recent) {
      const statusColor =
        e.status === "validated" ? c.green :
        e.status === "refuted"   ? c.red   : c.dim
      console.log(`  ${c.cyan((e.id ?? "").slice(0, 8))}  ${statusColor(e.status)}  ${entryText(e).slice(0, 70)}`)
    }
    console.log("")
  }
}

// ── Subcommand handlers ───────────────────────────────────────────────────────

async function cmdAsk(question, chronicleDir) {
  const llm = await detectLLM()
  if (!llm) {
    console.error(`\n${c.red("No LLM configured.")} Set ${c.bold("ANTHROPIC_API_KEY")} or ${c.bold("OPENAI_API_KEY")}.\n`)
    process.exit(1)
  }
  const allEntries = await readCommitted(chronicleDir)
  const evidence   = findRelevant(allEntries, question)

  process.stdout.write(c.dim(`\n  Thinking (${detectLLMName()})…`))
  try {
    const result = await runAdvisor(llm, question, evidence)
    process.stdout.write("\r" + " ".repeat(50) + "\r")
    renderAsk(question, result)
  } catch (err) {
    process.stdout.write("\r" + " ".repeat(50) + "\r")
    console.error(`\n${c.red("Advisor failed:")} ${err.message}\n`)
    process.exit(1)
  }
}

async function cmdQuery(topic, chronicleDir) {
  const allEntries = await readCommitted(chronicleDir)
  const matches    = findRelevant(allEntries, topic, 8)
  renderQuery(topic, matches)
}

async function cmdBrief(chronicleDir) {
  const allEntries = await readCommitted(chronicleDir)
  renderBrief(allEntries)
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function run(argv) {
  const [subOrQuestion, ...rest] = argv

  const chronicleDir = await findChronicleDir(process.cwd())
  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  // `quorum advisor ask "..."` or `quorum advisor "..."` (default to ask)
  if (subOrQuestion === "ask") {
    const question = rest.join(" ").trim()
    if (!question) return printUsage()
    return cmdAsk(question, chronicleDir)
  }

  // `quorum advisor query "topic"` — Chronicle lookup, no LLM
  if (subOrQuestion === "query") {
    const topic = rest.join(" ").trim()
    if (!topic) return printUsage()
    return cmdQuery(topic, chronicleDir)
  }

  // `quorum advisor brief` — high-level Chronicle summary
  if (subOrQuestion === "brief") {
    return cmdBrief(chronicleDir)
  }

  // No subcommand — treat the whole argv as a question (default: ask)
  const question = argv.join(" ").trim()
  if (!question) return printUsage()
  return cmdAsk(question, chronicleDir)
}

function printUsage() {
  console.log(`
${c.bold("quorum advisor")} — ask plain-language questions about your codebase

${c.bold("Subcommands:")}
  ${c.cyan("quorum advisor")} ${c.dim('"question"')}              Ask a question (default — uses LLM)
  ${c.cyan("quorum advisor ask")} ${c.dim('"question"')}          Ask explicitly
  ${c.cyan("quorum advisor query")} ${c.dim('"topic"')}           Search Chronicle entries (no LLM)
  ${c.cyan("quorum advisor brief")}                  High-level Chronicle summary (no LLM)

${c.bold("Examples:")}
  quorum advisor "what happens if we change the auth system?"
  quorum advisor ask "is it safe to add a NOT NULL column to users?"
  quorum advisor query "authentication"
  quorum advisor brief

${c.dim("ask requires ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.")}
`)
  process.exit(1)
}
