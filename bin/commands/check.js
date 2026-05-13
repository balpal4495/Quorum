import { createInterface } from "readline"
import { c } from "../shared/colors.js"
import { runPreflight, classifyRisk } from "../shared/patterns.js"

function parseArgs(argv) {
  const args = { outcome: "", design: "", json: false }
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === "--outcome" || argv[i] === "-o") && argv[i + 1]) { args.outcome = argv[++i]; continue }
    if ((argv[i] === "--design"  || argv[i] === "-d") && argv[i + 1]) { args.design  = argv[++i]; continue }
    if (argv[i] === "--json") { args.json = true; continue }
  }
  return args
}

async function readStdin() {
  if (process.stdin.isTTY) return null
  return new Promise((resolve) => {
    let data = ""
    const rl = createInterface({ input: process.stdin })
    rl.on("line",  (line) => { data += line + "\n" })
    rl.on("close", () => resolve(data.trim()))
  })
}

function riskColor(level) {
  switch (level) {
    case "low":      return c.green(level.toUpperCase())
    case "medium":   return c.yellow(level.toUpperCase())
    case "high":     return c.red(level.toUpperCase())
    case "critical": return `${c.bold(c.red("CRITICAL"))}`
    default:         return level.toUpperCase()
  }
}

function exitCodeForLevel(level) {
  if (level === "critical") return 2
  if (level === "high")     return 1
  return 0
}

export async function run(argv) {
  const args = parseArgs(argv)

  // Accept JSON from stdin if no flags provided
  if (!args.outcome && !args.design) {
    const stdin = await readStdin()
    if (stdin) {
      try {
        const parsed = JSON.parse(stdin)
        args.outcome = parsed.outcome ?? ""
        args.design  = parsed.design  ?? ""
      } catch {
        console.error(c.red("stdin: expected JSON with { outcome, design } or use --outcome / --design flags"))
        process.exit(1)
      }
    }
  }

  if (!args.outcome && !args.design) {
    console.error(`\n${c.bold("quorum check")} — run preflight and risk classifier (no LLM required)\n`)
    console.error("Usage:")
    console.error(`  quorum check --outcome "what you want to achieve" --design "how you plan to do it"`)
    console.error(`  echo '{"outcome":"...","design":"..."}' | quorum check`)
    console.error(`  quorum check --outcome "..." --design "..." --json\n`)
    console.error("Exit codes:  0 = low/medium risk   1 = high risk   2 = critical risk\n")
    process.exit(1)
  }

  const preflight = runPreflight(args.outcome, args.design)
  const risk      = classifyRisk(args.outcome, args.design)

  if (args.json) {
    console.log(JSON.stringify({ preflight, risk }, null, 2))
    process.exit(exitCodeForLevel(risk.level))
  }

  // ── Human-readable output ─────────────────────────────────────────────────
  console.log(`\n${c.bold("Preflight")}`)

  if (preflight.touches_sensitive_area) {
    console.log(`  ${c.yellow("⚠")}  Sensitive areas: ${c.yellow(preflight.sensitive_areas.join(", "))}`)
  } else {
    console.log(`  ${c.green("✓")}  No sensitive areas detected`)
  }

  console.log(preflight.rollback_mentioned
    ? `  ${c.green("✓")}  Rollback strategy mentioned`
    : `  ${c.dim("✗")}  No rollback strategy mentioned`)

  console.log(preflight.test_strategy_mentioned
    ? `  ${c.green("✓")}  Test strategy mentioned`
    : `  ${c.dim("✗")}  No test strategy mentioned`)

  console.log(`\n${c.bold("Risk")}`)
  console.log(`  Level:        ${riskColor(risk.level)}`)
  console.log(`  Council mode: ${c.dim(risk.council_mode)}`)

  if (risk.reasons.length > 0 && risk.reasons[0] !== "no sensitive patterns detected") {
    console.log(`  Reasons:`)
    for (const reason of risk.reasons) {
      console.log(`    ${c.dim("·")} ${reason}`)
    }
  }

  // ── Actionable guidance ───────────────────────────────────────────────────
  if (risk.level === "critical") {
    console.log(`\n  ${c.red("⚠  Critical risk — human architecture review required before proceeding.")}`)
    console.log(`  ${c.dim("   Run the full Jury + Council pipeline and get explicit approval.")}`)
  } else if (risk.level === "high") {
    console.log(`\n  ${c.yellow("⚠  High risk — full Council deliberation recommended.")}`)
    if (!preflight.rollback_mentioned) {
      console.log(`  ${c.dim("   Add a rollback strategy before submitting for review.")}`)
    }
  } else if (risk.level === "medium") {
    console.log(`\n  ${c.dim("   Medium risk — Jury + lite Council review.")}`)
  } else {
    console.log(`\n  ${c.dim("   Low risk — Jury-only review sufficient.")}`)
  }

  console.log("")
  process.exit(exitCodeForLevel(risk.level))
}
