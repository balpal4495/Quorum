import { promises as fs } from "fs"
import path from "path"
import { c } from "../shared/colors.js"
import { findChronicleDir, readCommitted } from "../shared/chronicle.js"

// Mirrors the ignored dirs in modules/sentinel/coverage.ts
const IGNORED_DIRS = new Set(["node_modules", "dist", ".git", ".chronicle", "coverage", "__tests__"])
const TEST_SUFFIXES = [".test.ts", ".spec.ts", ".test.js", ".spec.js"]

function parseArgs(argv) {
  const args = { subcommand: "coverage", codebasePath: process.cwd(), json: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "coverage" || argv[i] === "drift") { args.subcommand = argv[i]; continue }
    if ((argv[i] === "--path" || argv[i] === "-p") && argv[i + 1]) { args.codebasePath = argv[++i]; continue }
    if (argv[i] === "--json") { args.json = true; continue }
  }
  return args
}

async function walkFiles(dir, extensions, excludeTestFiles) {
  const results = []
  async function recurse(current) {
    let entries
    try { entries = await fs.readdir(current, { withFileTypes: true, encoding: "utf8" }) } catch { return }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await recurse(path.join(current, entry.name))
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        if (excludeTestFiles && TEST_SUFFIXES.some(s => entry.name.endsWith(s))) continue
        results.push(path.join(current, entry.name))
      }
    }
  }
  await recurse(dir)
  return results
}

function isCovered(relativePath, entries) {
  const matched = []
  const normalised = relativePath.replace(/\\/g, "/")
  for (const entry of entries) {
    const hits = (entry.affected_areas ?? []).some(area => {
      const normArea = area.replace(/\\/g, "/")
      return normalised.includes(normArea) || normArea.includes(normalised)
    })
    if (hits) matched.push(entry.id)
  }
  return { covered: matched.length > 0, entryIds: matched }
}

function barChart(pct, width = 20) {
  const filled = Math.round((pct / 100) * width)
  const bar    = "█".repeat(filled) + "░".repeat(width - filled)
  const color  = pct === 0 ? c.red : pct < 50 ? c.yellow : c.green
  return color(bar)
}

async function runCoverage(args) {
  const extensions = [".ts"]
  const chronicleDir  = await findChronicleDir(process.cwd())
  const codebasePath  = path.resolve(args.codebasePath)

  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  const [entries, files] = await Promise.all([
    readCommitted(chronicleDir),
    walkFiles(codebasePath, extensions, true),
  ])

  const coverageByFile = files.map(absolute => {
    const relative = path.relative(codebasePath, absolute).replace(/\\/g, "/")
    const { covered, entryIds } = isCovered(relative, entries)
    return { file: relative, covered, entryIds }
  })

  const covered   = coverageByFile.filter(f => f.covered)
  const uncovered = coverageByFile.filter(f => !f.covered)
  const pct       = files.length === 0 ? 0 : Math.round((covered.length / files.length) * 100)

  if (args.json) {
    console.log(JSON.stringify({
      totalFiles: files.length,
      coveredFiles: covered.length,
      uncoveredFiles: uncovered.map(f => f.file),
      coverageByFile,
      percentage: pct,
    }, null, 2))
    return
  }

  // ── Header ─────────────────────────────────────────────────────────────────
  console.log(`\n${c.bold("Chronicle coverage")}  ${c.dim(codebasePath)}\n`)
  console.log(`  ${barChart(pct)}  ${pct}%  (${covered.length}/${files.length} files)\n`)

  if (entries.length === 0) {
    console.log(c.dim("  No committed Chronicle entries — nothing to match against.\n"))
    return
  }

  if (files.length === 0) {
    console.log(c.dim(`  No .ts files found under ${codebasePath}\n`))
    console.log(c.dim(`  Tip: quorum sentinel coverage --path ./modules\n`))
    return
  }

  // ── Covered files ──────────────────────────────────────────────────────────
  if (covered.length > 0) {
    console.log(c.bold("Covered"))
    for (const f of covered) {
      console.log(`  ${c.green("✓")}  ${f.file}  ${c.dim(`(${f.entryIds.length} ${f.entryIds.length === 1 ? "entry" : "entries"})`)}`)
    }
    console.log("")
  }

  // ── Uncovered files ────────────────────────────────────────────────────────
  if (uncovered.length > 0) {
    console.log(c.bold("Uncovered") + c.dim("  (no Chronicle entries reference these files)"))
    const show = uncovered.slice(0, 20)
    for (const f of show) {
      console.log(`  ${c.dim("✗")}  ${f.file}`)
    }
    if (uncovered.length > 20) {
      console.log(`  ${c.dim(`… and ${uncovered.length - 20} more`)}`)
    }
    console.log("")
  }

  // ── Tip ────────────────────────────────────────────────────────────────────
  if (pct < 100) {
    console.log(c.dim(`  Tip: add Chronicle entries for uncovered files via oracle.propose() in your app,`))
    console.log(c.dim(`       then run quorum commit <id> to index them.\n`))
  }
}

export async function run(argv) {
  const args = parseArgs(argv)

  if (args.subcommand === "drift") {
    console.log(`\n${c.yellow("quorum sentinel drift")} requires an LLM provider and is not available as a standalone CLI command.`)
    console.log(c.dim("\nUse the sentinelAssertions() helper in your test suite instead:"))
    console.log(c.dim("\n  import { sentinelAssertions } from \"./quorum/modules/sentinel\""))
    console.log(c.dim("  const assertions = sentinelAssertions({ llm: yourProvider })"))
    console.log(c.dim("  describe(\"sentinel\", () => { assertions.forEach(a => a()) })\n"))
    process.exit(0)
  }

  if (args.subcommand === "coverage" || !argv.length) {
    await runCoverage(args)
    return
  }

  console.error(`\n${c.bold("quorum sentinel")} — Chronicle analysis\n`)
  console.error("Subcommands:")
  console.error(`  quorum sentinel coverage [--path <dir>]  Chronicle coverage of source files`)
  console.error(`  quorum sentinel coverage --json          Machine-readable output`)
  console.error(`  quorum sentinel drift                    (requires LLM — use sentinelAssertions() instead)\n`)
}
