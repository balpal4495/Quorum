import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { c } from "../shared/colors.js"
import { findChronicleDir, readCommitted, entryText } from "../shared/chronicle.js"
import { detectProvider } from "../shared/llm.js"

function parseArgs(argv) {
  const args = { dryRun: false, json: false }
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true
    if (arg === "--json")    args.json   = true
  }
  return args
}

const SYSTEM_PROMPT = `You are a Chronicle Analyst for Quorum — a persistent knowledge store that gives AI coding assistants long-term memory across sessions.

You will receive a list of committed Chronicle entries. Your task is to find quality improvements. Be conservative — it is correct to propose nothing when entries are all distinct and healthy. Never consolidate entries that are merely related; only merge when they are genuinely saying the same thing.

Three types of improvement:

CONSOLIDATE — two or more entries that cover the same ground, expressed redundantly or overlapping in scope. Propose merging into one sharper entry that supersedes them.

RESOLVE_CONTRADICTION — a validated entry that a newer entry implicitly supersedes or contradicts. Propose marking the older entry as refuted.

PROMOTE_OPEN — an entry with status "open" that other entries have since confirmed or validated. Propose elevating to "validated" with a justified confidence score.

Return ONLY valid JSON — no prose, no markdown fences — with this exact shape:
{
  "actions": [
    {
      "type": "consolidate",
      "entry_ids": ["full-uuid-1", "full-uuid-2"],
      "synthesised": {
        "topic": "short label",
        "decision": "One precise sentence: what was decided and why.",
        "key_insight": "same as decision",
        "affected_areas": ["path/to/file.ts"],
        "scope": ["tag1", "tag2"],
        "alternatives_considered": [],
        "rejected_reason": [],
        "status": "validated",
        "confidence": 0.9
      },
      "reason": "why these entries should be merged"
    },
    {
      "type": "resolve_contradiction",
      "stale_entry_id": "full-uuid",
      "superseding_entry_id": "full-uuid",
      "reason": "why the older entry is now superseded"
    },
    {
      "type": "promote_open",
      "entry_id": "full-uuid",
      "new_confidence": 0.85,
      "reason": "which other entries confirm this"
    }
  ],
  "no_action_reason": "brief note on why the rest need no change, or empty string"
}`

function formatEntries(entries) {
  return entries.map(e => {
    const lines = [
      `ID: ${e.id}`,
      `Topic: ${e.topic ?? "(none)"}`,
      `Status: ${e.status}`,
      `Confidence: ${e.confidence}`,
      `Decision: ${e.decision ?? e.key_insight}`,
      `Affected areas: ${(e.affected_areas ?? []).join(", ")}`,
      `Scope: ${(e.scope ?? []).join(", ")}`,
    ]
    if (e.alternatives_considered?.length) lines.push(`Alternatives considered: ${e.alternatives_considered.join("; ")}`)
    if (e.rejected_reason?.length)         lines.push(`Rejected reason: ${e.rejected_reason.join("; ")}`)
    if (e.supersedes)                       lines.push(`Supersedes: ${e.supersedes}`)
    if (e.superseded_by)                    lines.push(`Superseded by: ${e.superseded_by}`)
    return lines.join("\n")
  }).join("\n\n---\n\n")
}

function validateAction(action) {
  if (!action || typeof action.type !== "string") return false
  if (action.type === "consolidate")
    return Array.isArray(action.entry_ids) && action.entry_ids.length >= 2 && action.synthesised
  if (action.type === "resolve_contradiction")
    return typeof action.stale_entry_id === "string" && typeof action.superseding_entry_id === "string"
  if (action.type === "promote_open")
    return typeof action.entry_id === "string" && typeof action.new_confidence === "number"
  return false
}

function spinner(msg) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  let i = 0
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan(frames[i++ % frames.length])}  ${msg}`)
  }, 80)
  return { stop: (final) => { clearInterval(interval); process.stdout.write(`\r  ${final}\n`) } }
}

function renderEvolvePassthrough(entries) {
  console.log(`\n${c.bold("Chronicle evolution analysis")}  ${c.dim(`${entries.length} entries`)}\n`)
  console.log(c.dim("  No LLM configured — outputting Chronicle for agent analysis.\n"))
  console.log(formatEntries(entries))
  console.log(c.dim("─".repeat(60)))
  console.log(`\n${c.bold("Analysis request")}\n`)
  console.log("  Review the Chronicle entries above and identify quality improvements:")
  console.log("  · consolidate — entries covering the same ground (merge into one stronger entry)")
  console.log("  · resolve — a validated entry superseded or contradicted by a newer one")
  console.log("  · promote — an 'open' entry confirmed by other entries (elevate to validated)")
  console.log("")
  console.log("  For each improvement, create a proposal using the template in CLAUDE.md:")
  console.log(c.dim("  node -e \"const { randomUUID } = require('crypto'); ...\" (see CLAUDE.md)"))
  console.log(c.dim("  Then run: quorum commit --list\n"))
}

export async function run(argv) {
  const args = parseArgs(argv)

  const chronicleDir = await findChronicleDir(process.cwd())
  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  const entries = await readCommitted(chronicleDir)
  if (entries.length === 0) {
    console.log(`\n${c.dim("No committed entries — nothing to evolve.")}\n`)
    return
  }

  const provider = await detectProvider()
  if (!provider) {
    renderEvolvePassthrough(entries)
    return
  }
  const { llm, name: llmName } = provider

  console.log(`\n${c.bold("Quorum evolve")}  ${c.dim(`${entries.length} entries · via ${llmName}`)}\n`)

  const spin = spinner(`Analysing ${entries.length} Chronicle entries…`)

  let raw
  try {
    raw = await llm([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here are the ${entries.length} committed Chronicle entries:\n\n${formatEntries(entries)}\n\nAnalyse and return your proposed improvements as JSON.`,
      },
    ])
    spin.stop(`${c.green("✓")}  Analysis complete`)
  } catch (err) {
    spin.stop(`${c.red("✗")}  LLM call failed`)
    console.error(c.dim(`     ${err.message}\n`))
    process.exit(1)
  }

  let parsed
  try {
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim()
    parsed = JSON.parse(cleaned)
  } catch {
    console.error(`\n${c.red("Could not parse LLM response as JSON.")}\n`)
    console.error(c.dim(raw.slice(0, 500)))
    process.exit(1)
  }

  const actions = (parsed.actions ?? []).filter(validateAction)

  if (args.json) {
    console.log(JSON.stringify({ actions, no_action_reason: parsed.no_action_reason ?? "" }, null, 2))
    return
  }

  if (actions.length === 0) {
    console.log(`\n  ${c.green("✓")}  Chronicle is clean — no improvements identified.`)
    if (parsed.no_action_reason) console.log(`\n  ${c.dim(parsed.no_action_reason)}`)
    console.log("")
    return
  }

  console.log(`\n  ${c.bold(String(actions.length))} improvement${actions.length === 1 ? "" : "s"} found\n`)

  if (args.dryRun) {
    for (const action of actions) {
      if (action.type === "consolidate") {
        console.log(`  ${c.cyan("consolidate")}  ${action.entry_ids.map(id => id.slice(0, 8)).join(" + ")}`)
        console.log(`    ${c.dim(action.reason)}`)
        console.log(`    ${c.dim("→")} ${action.synthesised.decision ?? action.synthesised.key_insight}`)
      } else if (action.type === "resolve_contradiction") {
        console.log(`  ${c.yellow("resolve")}      ${action.stale_entry_id.slice(0, 8)} → refuted  (superseded by ${action.superseding_entry_id.slice(0, 8)})`)
        console.log(`    ${c.dim(action.reason)}`)
      } else if (action.type === "promote_open") {
        console.log(`  ${c.green("promote")}      ${action.entry_id.slice(0, 8)} → validated  (confidence ${action.new_confidence})`)
        console.log(`    ${c.dim(action.reason)}`)
      }
      console.log("")
    }
    console.log(c.dim("  (Dry run — no proposals written.)\n"))
    return
  }

  // Write proposals
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })

  const entryMap = new Map(entries.map(e => [e.id, e]))
  let stagedCount = 0

  for (const action of actions) {
    const proposalId = randomUUID()
    let proposal

    if (action.type === "consolidate") {
      const sources = action.entry_ids.map(eid => entryMap.get(eid)).filter(Boolean)
      const mergedAreas = [...new Set(sources.flatMap(e => e.affected_areas ?? []))]
      const mergedScope = [...new Set(sources.flatMap(e => e.scope ?? []))]
      proposal = {
        schema_version: 2,
        ...action.synthesised,
        affected_areas: action.synthesised.affected_areas?.length ? action.synthesised.affected_areas : mergedAreas,
        scope:          action.synthesised.scope?.length          ? action.synthesised.scope          : mergedScope,
        key_insight:    action.synthesised.decision ?? action.synthesised.key_insight,
        decision:       action.synthesised.decision ?? action.synthesised.key_insight,
        supersedes:     action.entry_ids,
        source_module:  "evolve",
        evidence_cited: action.entry_ids,
        _evolve_action: "consolidate",
        _evolve_reason: action.reason,
      }
    } else if (action.type === "resolve_contradiction") {
      const stale = entryMap.get(action.stale_entry_id)
      proposal = {
        schema_version: 2,
        key_insight:    stale ? entryText(stale) : action.stale_entry_id,
        decision:       stale ? entryText(stale) : action.stale_entry_id,
        topic:          stale?.topic ?? "contradiction-resolution",
        affected_areas: stale?.affected_areas ?? [],
        scope:          [...(stale?.scope ?? []), "evolution"],
        status:         "refuted",
        confidence:     stale?.confidence ?? 0.5,
        source_module:  "evolve",
        evidence_cited: [action.superseding_entry_id],
        supersedes:     action.stale_entry_id,
        _evolve_action: "resolve_contradiction",
        _evolve_reason: action.reason,
      }
    } else if (action.type === "promote_open") {
      const original = entryMap.get(action.entry_id)
      if (!original) continue
      const { id: _id, timestamp: _ts, ...rest } = original
      proposal = {
        ...rest,
        schema_version: 2,
        status:         "validated",
        confidence:     action.new_confidence,
        supersedes:     action.entry_id,
        source_module:  "evolve",
        _evolve_action: "promote_open",
        _evolve_reason: action.reason,
      }
    }

    if (!proposal) continue
    await fs.writeFile(path.join(proposalsDir, `${proposalId}.json`), JSON.stringify(proposal, null, 2))
    stagedCount++

    if (action.type === "consolidate") {
      console.log(`  ${c.green("✓")}  ${c.cyan("consolidate")}  ${action.entry_ids.map(id => id.slice(0, 8)).join(" + ")}`)
      console.log(`     ${c.dim(action.reason)}`)
    } else if (action.type === "resolve_contradiction") {
      console.log(`  ${c.green("✓")}  ${c.yellow("resolve")}      ${action.stale_entry_id.slice(0, 8)} → refuted`)
      console.log(`     ${c.dim(action.reason)}`)
    } else if (action.type === "promote_open") {
      console.log(`  ${c.green("✓")}  ${c.green("promote")}      ${action.entry_id.slice(0, 8)} → validated (${action.new_confidence})`)
      console.log(`     ${c.dim(action.reason)}`)
    }
    console.log("")
  }

  console.log(`  ${c.green(String(stagedCount))} proposal${stagedCount === 1 ? "" : "s"} staged — run ${c.bold("quorum commit --list")} to review\n`)
}
