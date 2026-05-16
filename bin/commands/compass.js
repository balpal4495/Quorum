#!/usr/bin/env node
import path from "path"
import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"
import { detectProvider } from "../shared/llm.js"

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

  // ── Load Compass module ────────────────────────────────────────────────────

  const rootDir      = process.cwd()
  const chronicleDir = findChronicleDir(rootDir)

  if (!chronicleDir) {
    console.error(c.red("Error: Chronicle not found. Run 'quorum init' first."))
    process.exit(1)
  }

  // Lazy import to keep CLI startup fast
  const { createCompass }  = await import("../../modules/compass/create.js")
  const { defaultSources } = await import("../../modules/compass/sources/index.js")
  const { createOracleClient } = await import("../../modules/oracle/index.js")
  const { createLanceDBStore } = await import("../../modules/oracle/adapters/lance-db.js")
  const { xenovaEmbed } = await import("../../modules/oracle/adapters/xenova-embedder.js")

  const vectorStore = await createLanceDBStore(chronicleDir)
  const oracle = createOracleClient({ embedder: xenovaEmbed, vectorStore, chronicleDir })

  // Only load LLM for subcommands that need it
  const NO_LLM_CMDS = new Set(["map", "opportunities"])
  const llm = NO_LLM_CMDS.has(subcommand) ? undefined : detectProvider()

  const compass = createCompass({
    oracle,
    llm,
    rootDir,
    chronicleDir,
    sources: defaultSources(),
  })

  // ── Route subcommand ───────────────────────────────────────────────────────

  try {
    switch (subcommand) {
      case "brief": {
        const data = await compass.brief({ area })
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderBrief(data)
        break
      }

      case "map": {
        const data = await compass.mapBehaviors({ area })
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
        const data = await compass.behavior({ question, area })
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
        const data = await compass.opportunities({ area, goal, limit: limitN })
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderOpportunities(data)
        break
      }

      case "pathways": {
        if (!goal) {
          console.error(c.red('Error: --goal is required. Example: quorum compass pathways --goal "onboard new agents faster"'))
          process.exit(1)
        }
        const data = await compass.pathways({ goal, horizon, appetite, area, limit: limitN })
        _lastArtifact = { kind: "product_pathway", items: data }
        if (jsonMode) { console.log(JSON.stringify(data, null, 2)); break }
        renderPathways(data)
        console.log(c.dim("\nTip: run 'quorum compass propose --from-last' to stage a Chronicle entry."))
        break
      }

      case "bets": {
        const data = await compass.bigBets({ horizon, goal, appetite })
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
        const data = await compass.scoreIdea({ idea })
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
        const data = await compass.productBrief({ title })
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
          const result = await compass.propose({ artifact_kind: _lastArtifact.kind, payload: item })
          console.log(c.green(`\n✓ ${result.message}`))
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
        const data = await compass.outcome({ entry_id: entryId, result, note })
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
