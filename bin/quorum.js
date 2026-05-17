#!/usr/bin/env node
import { createRequire } from "module"
import { fileURLToPath } from "url"
import path from "path"

const _require = createRequire(import.meta.url)
const PKG_VERSION = _require("../package.json").version

const c = {
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  blue:  (s) => `\x1b[34m${s}\x1b[0m`,
  dim:   (s) => `\x1b[90m${s}\x1b[0m`,
  cyan:  (s) => `\x1b[36m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
}

function help() {
  console.log(`
${c.bold("quorum")} ${c.dim(`v${PKG_VERSION}`)} — portable reasoning layer for agentic codebases

${c.bold("Usage:")}
  ${c.cyan("quorum advisor")} ${c.dim('"question"')}             Ask a plain-language question (uses LLM)
  ${c.cyan("quorum advisor query")} ${c.dim('"topic"')}          Search Chronicle entries (no LLM)
  ${c.cyan("quorum advisor brief")}                 High-level Chronicle summary (no LLM)
  ${c.cyan("quorum init")}                          Scaffold Quorum into a project
  ${c.cyan("quorum status")}                        Show Chronicle health and pending proposals
  ${c.cyan("quorum check")} --outcome <x> --design <y>  Preflight + risk (no LLM)
  ${c.cyan("quorum commit")} <id>                   Approve and index a Chronicle proposal
  ${c.cyan("quorum sentinel")} [coverage]           Chronicle coverage of source files
  ${c.cyan("quorum growth")}                        Chronicle learning health and growth rate
  ${c.cyan("quorum evolve")}                        Consolidate and improve Chronicle entries (uses LLM)
  ${c.cyan("quorum compass")} <subcommand>          Product-direction synthesis (brief, map, pathways, bets, score)
  ${c.cyan("quorum serve")}                         Start web UI + MCP server (default port 3000)
  ${c.cyan("quorum sync")}                          Refresh Quorum instruction blocks after npm update
  ${c.cyan("quorum ingest")} <paths...>             Ingest files/folders as low-trust evidence
  ${c.cyan("quorum ingest-git")} [--since P90D]     Ingest git history as low-trust evidence
  ${c.cyan("quorum ingest-url")} <url...>           Ingest URLs as low-trust evidence
  ${c.cyan("quorum bootstrap")} --from-git          Cold-start Chronicle from git history
  ${c.cyan("quorum migrate-v2")}                    Migrate from v1 vendored quorum/modules/ to npm package
  ${c.cyan("quorum --version")}                     Print version

${c.bold("quorum advisor")} subcommands:
  ask ${c.dim('"question"')}       Ask with LLM synthesis + validation loop
  query ${c.dim('"topic"')}        Chronicle lookup (no LLM, instant)
  brief                Chronicle summary (no LLM, instant)

${c.bold("quorum check")} flags:
  --outcome  -o   What you want to achieve
  --design   -d   How you plan to do it
  --json          Machine-readable JSON output
  (also accepts JSON on stdin: ${c.dim('echo \'{"outcome":"…","design":"…"}\' | quorum check')})

${c.bold("quorum commit")} flags:
  --dry-run       Preview without writing
  --list          List pending proposals

${c.bold("quorum sentinel")} subcommands:
  coverage [--path <dir>]   Chronicle coverage for .ts files (default: cwd)
  drift                     (requires LLM — use sentinelAssertions() instead)
  --json                    Machine-readable output

${c.bold("quorum migrate-v2")} flags:
  --dry-run       Preview what would be removed without writing

${c.bold("quorum compass")} subcommands:
  brief               Summarise product direction (LLM)
  map                 Map behaviours from code + docs (no LLM)
  pathways --goal X   Product pathways toward a goal (LLM)
  bets                Strategic big bets (LLM)
  score <idea>        Score a product idea (LLM)
  spec <title>        Generate a product brief (LLM)
  opportunities       List gaps from behaviour map (no LLM)
  propose --from-last Stage a Chronicle entry from last artifact
  outcome --entry-id X --result Y  Record a bet/pathway outcome

${c.bold("quorum ingest")} flags:
  --recurse  -r   Walk directories recursively
  --propose       Also stage evidence as Chronicle proposals

${c.bold("quorum ingest-git")} flags:
  --since P90D    ISO 8601 duration: P30D, P6M, P1Y  [default: P90D]
  --propose       Also stage commits as Chronicle proposals

${c.bold("quorum ingest-url")} flags:
  --propose       Also stage URLs as Chronicle proposals

${c.bold("quorum bootstrap")} flags:
  --from-git      Bootstrap from git commit history
  --since P90D    ISO 8601 duration  [default: P90D]
  --propose       Also stage evidence as Chronicle proposals

${c.bold("Exit codes")} (quorum check):
  0  low / medium risk
  1  high risk
  2  critical risk
`)
}

async function cli() {
  const [,, command = "", ...rest] = process.argv

  if (!command || command === "help" || command === "--help" || command === "-h") {
    help(); return
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(PKG_VERSION); return
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url))

  if (command === "advisor") {
    const { run } = await import(path.join(__dirname, "commands/advisor.js"))
    await run(rest)
    return
  }

  if (command === "init") {
    const { run } = await import(path.join(__dirname, "commands/init.js"))
    await run(PKG_VERSION)
    return
  }

  if (command === "status") {
    const { run } = await import(path.join(__dirname, "commands/status.js"))
    await run(rest)
    return
  }

  if (command === "check") {
    const { run } = await import(path.join(__dirname, "commands/check.js"))
    await run(rest)
    return
  }

  if (command === "commit") {
    const { run } = await import(path.join(__dirname, "commands/commit.js"))
    await run(rest)
    return
  }

  if (command === "sentinel") {
    const { run } = await import(path.join(__dirname, "commands/sentinel.js"))
    await run(rest)
    return
  }

  if (command === "growth") {
    const { run } = await import(path.join(__dirname, "commands/growth.js"))
    await run(rest)
    return
  }

  if (command === "evolve") {
    const { run } = await import(path.join(__dirname, "commands/evolve.js"))
    await run(rest)
    return
  }

  if (command === "sync") {
    const { run } = await import(path.join(__dirname, "commands/sync.js"))
    await run(rest)
    return
  }

  if (command === "compass") {
    const { run } = await import(path.join(__dirname, "commands/compass.js"))
    await run(rest)
    return
  }

  if (command === "migrate-v2") {
    const { run } = await import(path.join(__dirname, "commands/migrate-v2.js"))
    await run(rest)
    return
  }

  if (command === "serve") {
    const { run } = await import(path.join(__dirname, "commands/serve.js"))
    await run(rest)
    return
  }

  if (command === "ingest") {
    const { run } = await import(path.join(__dirname, "commands/ingest.js"))
    await run(rest)
    return
  }

  if (command === "ingest-git") {
    const { run } = await import(path.join(__dirname, "commands/ingest-git.js"))
    await run(rest)
    return
  }

  if (command === "ingest-url") {
    const { run } = await import(path.join(__dirname, "commands/ingest-url.js"))
    await run(rest)
    return
  }

  if (command === "bootstrap") {
    const { run } = await import(path.join(__dirname, "commands/bootstrap.js"))
    await run(rest)
    return
  }

  console.error(`${c.red(`Unknown command: ${command}`)}`)
  console.error(`Run ${c.bold("quorum help")} for usage.`)
  process.exit(1)
}

cli().catch((err) => {
  console.error(`\x1b[31m\nQuorum failed:\x1b[0m ${err.message}`)
  process.exit(1)
})
