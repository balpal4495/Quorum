#!/usr/bin/env node
/**
 * quorum init
 *
 * Drops Quorum into an existing Node.js project.
 * Run from the target project root:
 *
 *   npx github:balpal4495/Quorum init
 *
 * Zero external dependencies — uses only Node.js built-ins.
 * Requires Node.js 18+.
 */

import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUORUM_ROOT = path.resolve(__dirname, "..")
const TARGET = process.cwd()

// ── Deps Quorum requires in the host project ───────────────────────────────

const DEPS = {
  zod: "^3.23.0",
}

const OPTIONAL_DEPS = {
  vectordb: "^0.4.0",
  "@xenova/transformers": "^2.17.0",
}

// ── Logging ────────────────────────────────────────────────────────────────

const c = {
  bold:  (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  blue:  (s) => `\x1b[34m${s}\x1b[0m`,
  dim:   (s) => `\x1b[90m${s}\x1b[0m`,
  yellow:(s) => `\x1b[33m${s}\x1b[0m`,
  red:   (s) => `\x1b[31m${s}\x1b[0m`,
}

const log = {
  section: (title) => console.log(`\n${c.bold(title)}`),
  created: (file)  => console.log(`  ${c.green("+ created ")} ${file}`),
  appended:(file)  => console.log(`  ${c.blue("~ appended")} ${file}`),
  skipped: (file)  => console.log(`  ${c.dim("· skipped ")} ${file}`),
  warn:    (msg)   => console.log(`  ${c.yellow("⚠ " + msg)}`),
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false)
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

function geminiAvailable() {
  try {
    execSync("which gemini", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

// ── Steps ──────────────────────────────────────────────────────────────────

async function guardAlreadyInitialized() {
  if (await exists(path.join(TARGET, "quorum", "modules"))) {
    console.log(c.yellow("\nQuorum is already initialized in this project."))
    console.log("Remove quorum/ first if you want to reinitialize.\n")
    process.exit(0)
  }
}

async function copyModules() {
  log.section("Copying modules")

  const src  = path.join(QUORUM_ROOT, "modules")
  const dest = path.join(TARGET, "quorum", "modules")
  await fs.cp(src, dest, { recursive: true })
  log.created("quorum/modules/")

  await fs.copyFile(
    path.join(QUORUM_ROOT, "SETUP.md"),
    path.join(TARGET, "quorum", "SETUP.md"),
  )
  log.created("quorum/SETUP.md")
}

async function mergeCopilotInstructions() {
  log.section("Merging AI instruction files")

  const src     = path.join(QUORUM_ROOT, ".github", "copilot-instructions.md")
  const dest    = path.join(TARGET, ".github", "copilot-instructions.md")
  const content = await fs.readFile(src, "utf8")

  await fs.mkdir(path.join(TARGET, ".github"), { recursive: true })

  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("<!-- quorum -->")) {
      log.skipped(".github/copilot-instructions.md (already present)")
      return
    }
    await fs.appendFile(dest, `\n\n---\n\n<!-- quorum -->\n${content}`, "utf8")
    log.appended(".github/copilot-instructions.md")
  } else {
    await fs.writeFile(dest, content, "utf8")
    log.created(".github/copilot-instructions.md")
  }
}

async function mergeAgentsMd() {
  const dest    = path.join(TARGET, "AGENTS.md")
  const section = [
    "",
    "## Quorum modules",
    "",
    "See [quorum/modules/AGENTS.md](quorum/modules/AGENTS.md) for Oracle, Jury, and Council internals.",
    "See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.",
    "",
  ].join("\n")

  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("quorum/modules/AGENTS.md")) {
      log.skipped("AGENTS.md (already present)")
      return
    }
    await fs.appendFile(dest, section, "utf8")
    log.appended("AGENTS.md")
  } else {
    await fs.writeFile(dest, `# Agent Instructions\n${section}`, "utf8")
    log.created("AGENTS.md")
  }
}

async function mergeClaudeMd() {
  const dest = path.join(TARGET, "CLAUDE.md")
  const section = `
## Quorum modules

See [quorum/modules/CLAUDE.md](quorum/modules/CLAUDE.md) for Oracle, Jury, and Council internals.
See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.

## Gemini CLI (optional assistant)

Before attempting any Gemini call, check availability:

\`\`\`bash
which gemini 2>/dev/null
\`\`\`

If the command returns empty, skip this section entirely. The project is fully functional
without Gemini. Never try to install it or ask the user to install it mid-task.

If Gemini is available, use it as a large-context assistant for tasks that require
surveying many files at once — it can hold the entire codebase in a single context window.

\`\`\`bash
# Broad survey before narrowing
GEMINI_CLI_TRUST_WORKSPACE=true gemini -p "Summarise the public API across all modules"

# Second opinion on a design
GEMINI_CLI_TRUST_WORKSPACE=true gemini -p "I'm about to change X. What should I watch out for?"
\`\`\`

You reason about Gemini's output — it assists, you decide. Never pass its response to the
user unfiltered. If Gemini contradicts what you know from reading the code, trust your reading.
`

  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("quorum/modules/CLAUDE.md")) {
      log.skipped("CLAUDE.md (already present)")
      return
    }
    await fs.appendFile(dest, section, "utf8")
    log.appended("CLAUDE.md")
  } else {
    await fs.writeFile(dest, `# Claude Instructions\n${section}`, "utf8")
    log.created("CLAUDE.md")
  }
}

async function mergeGeminiMd() {
  const dest = path.join(TARGET, "GEMINI.md")

  if (await exists(dest)) {
    log.skipped("GEMINI.md (already present)")
    return
  }

  if (!geminiAvailable()) {
    log.skipped("GEMINI.md (Gemini CLI not detected — install it later to enable)")
    return
  }

  const src = path.join(QUORUM_ROOT, "GEMINI.md")
  if (await exists(src)) {
    await fs.copyFile(src, dest)
    log.created("GEMINI.md")
  }
}

async function updatePackageJson() {
  log.section("Updating package.json")

  const pkgPath = path.join(TARGET, "package.json")
  let pkg

  if (await exists(pkgPath)) {
    pkg = await readJson(pkgPath)
  } else {
    pkg = { name: path.basename(TARGET), version: "0.1.0", private: true }
    log.warn("No package.json found — creating a minimal one")
  }

  pkg.dependencies         = pkg.dependencies         ?? {}
  pkg.optionalDependencies = pkg.optionalDependencies ?? {}

  const added = []

  for (const [name, version] of Object.entries(DEPS)) {
    if (!pkg.dependencies[name]) {
      pkg.dependencies[name] = version
      added.push(name)
    }
  }

  for (const [name, version] of Object.entries(OPTIONAL_DEPS)) {
    if (!pkg.optionalDependencies[name]) {
      pkg.optionalDependencies[name] = version
      added.push(`${name} (optional)`)
    }
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")

  if (added.length > 0) {
    log.appended(`package.json — added: ${added.join(", ")}`)
  } else {
    log.skipped("package.json (all deps already present)")
  }
}

async function updateGitignore() {
  log.section("Updating .gitignore")

  const dest  = path.join(TARGET, ".gitignore")
  const block = [
    "",
    "# Quorum — Chronicle",
    "# entries/ is a binary vector store — do not commit",
    ".chronicle/entries/",
    ".chronicle/query-log.jsonl",
    "",
  ].join("\n")

  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes(".chronicle/entries/")) {
      log.skipped(".gitignore (already present)")
      return
    }
    await fs.appendFile(dest, block, "utf8")
    log.appended(".gitignore")
  } else {
    await fs.writeFile(dest, block.trimStart(), "utf8")
    log.created(".gitignore")
  }
}

async function createChronicle() {
  log.section("Creating Chronicle")

  const proposalsDir = path.join(TARGET, ".chronicle", "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })
  log.created(".chronicle/proposals/")
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold("\nQuorum init"))
  console.log(`Target: ${c.dim(TARGET)}\n`)

  if (TARGET === QUORUM_ROOT) {
    console.log(c.yellow("Run this from your project directory, not the Quorum repo itself."))
    process.exit(1)
  }

  await guardAlreadyInitialized()
  await copyModules()
  await mergeCopilotInstructions()
  await mergeAgentsMd()
  await mergeClaudeMd()
  await mergeGeminiMd()
  await updatePackageJson()
  await updateGitignore()
  await createChronicle()

  const hasGemini = geminiAvailable()

  console.log(`\n${c.green("✓ Quorum initialized.")}`)
  console.log("\nNext steps:")
  console.log("  1. npm install")
  console.log("  2. Wire setup() into your entry point:\n")
  console.log(c.dim('     import { setup } from "./quorum/modules/setup"'))
  console.log(c.dim('     const { oracle, evaluate, deliberate } = await setup({ llm: yourProvider })'))
  console.log("\n  Or tell your AI: \"follow quorum/SETUP.md\"")

  if (!hasGemini) {
    console.log(`\n  ${c.dim("Optional: install Gemini CLI for large-context assistance")}`)
    console.log(c.dim("  npm install -g @google/gemini-cli  +  set GEMINI_API_KEY"))
    console.log(c.dim("  See quorum/SETUP.md Step 10 for details."))
  } else {
    console.log(`\n  ${c.green("✓ Gemini CLI detected")} — GEMINI.md written. Set GEMINI_API_KEY if not already set.`)
  }

  console.log("")
}

main().catch((err) => {
  console.error(c.red("\nQuorum init failed:"), err.message)
  process.exit(1)
})
