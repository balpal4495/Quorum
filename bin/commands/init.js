import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import { createRequire } from "module"
import { c, log } from "../shared/colors.js"

const _require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUORUM_ROOT = path.resolve(__dirname, "../..")

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false)
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

function geminiAvailable() {
  try { execSync("which gemini", { stdio: "ignore" }); return true } catch { return false }
}

async function guardAlreadyInitialized(target) {
  if (await exists(path.join(target, ".quorum-version"))) {
    console.log(c.yellow("\nQuorum is already initialized in this project."))
    console.log("Run 'npm update @balpal4495/quorum' to upgrade to the latest version.\n")
    process.exit(0)
  }
}

async function writeQuorumDocs(target) {
  log.section("Writing Quorum docs")
  await fs.mkdir(path.join(target, "quorum"), { recursive: true })
  // Host-facing CLAUDE.md — CLI-first operational guide, not module internals
  const claudeSrc = path.join(QUORUM_ROOT, "bin", "templates", "CLAUDE.md")
  const claudeDest = path.join(target, "quorum", "CLAUDE.md")
  if (await exists(claudeSrc)) {
    await fs.copyFile(claudeSrc, claudeDest)
    log.created("quorum/CLAUDE.md")
  }
  // AGENTS.md — module file ownership map
  const agentsSrc = path.join(QUORUM_ROOT, "modules", "AGENTS.md")
  const agentsDest = path.join(target, "quorum", "AGENTS.md")
  if (await exists(agentsSrc)) {
    await fs.copyFile(agentsSrc, agentsDest)
    log.created("quorum/AGENTS.md")
  }
  await fs.copyFile(
    path.join(QUORUM_ROOT, "SETUP.md"),
    path.join(target, "quorum", "SETUP.md"),
  )
  log.created("quorum/SETUP.md")
}

async function writeQuorumVersion(target, version) {
  await fs.writeFile(path.join(target, ".quorum-version"), version + "\n", "utf8")
  log.created(".quorum-version")
}

async function mergeCopilotInstructions(target) {
  log.section("Merging AI instruction files")
  const src     = path.join(QUORUM_ROOT, ".github", "copilot-instructions.md")
  const dest    = path.join(target, ".github", "copilot-instructions.md")
  const content = await fs.readFile(src, "utf8")
  const block   = `<!-- quorum:start -->\n${content}\n<!-- quorum:end -->`
  await fs.mkdir(path.join(target, ".github"), { recursive: true })
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("<!-- quorum:start -->")) { log.skipped(".github/copilot-instructions.md (already present)"); return }
    await fs.appendFile(dest, `\n\n---\n\n${block}`, "utf8")
    log.appended(".github/copilot-instructions.md")
  } else {
    await fs.writeFile(dest, block, "utf8")
    log.created(".github/copilot-instructions.md")
  }
}

async function mergeAgentsMd(target) {
  const dest    = path.join(target, "AGENTS.md")
  const section = [
    "",
    "<!-- quorum:start -->",
    "## Quorum",
    "",
    "See [quorum/AGENTS.md](quorum/AGENTS.md) for module file ownership and internals.",
    "See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.",
    "<!-- quorum:end -->",
    "",
  ].join("\n")
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("<!-- quorum:start -->")) { log.skipped("AGENTS.md (already present)"); return }
    await fs.appendFile(dest, section, "utf8")
    log.appended("AGENTS.md")
  } else {
    await fs.writeFile(dest, `# Agent Instructions\n${section}`, "utf8")
    log.created("AGENTS.md")
  }
}

async function mergeClaudeMd(target) {
  const dest    = path.join(target, "CLAUDE.md")
  const section = `
<!-- quorum:start -->
## Quorum

See [quorum/CLAUDE.md](quorum/CLAUDE.md) for design decisions and invariants.
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
# The Bash tool does not auto-source shell profiles — always prefix with source:
source ~/.zshrc && gemini -p "Summarise the public API across all modules"
source ~/.zshrc && gemini -p "I'm about to change X. What should I watch out for?"
\`\`\`

You reason about Gemini's output — it assists, you decide. Never pass its response to the
user unfiltered. If Gemini contradicts what you know from reading the code, trust your reading.
<!-- quorum:end -->
`
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("<!-- quorum:start -->")) { log.skipped("CLAUDE.md (already present)"); return }
    await fs.appendFile(dest, section, "utf8")
    log.appended("CLAUDE.md")
  } else {
    await fs.writeFile(dest, `# Claude Instructions\n${section}`, "utf8")
    log.created("CLAUDE.md")
  }
}

async function mergeGeminiMd(target) {
  const dest = path.join(target, "GEMINI.md")
  if (await exists(dest)) { log.skipped("GEMINI.md (already present)"); return }
  if (!geminiAvailable()) { log.skipped("GEMINI.md (Gemini CLI not detected — install it later to enable)"); return }
  const src = path.join(QUORUM_ROOT, "GEMINI.md")
  if (await exists(src)) { await fs.copyFile(src, dest); log.created("GEMINI.md") }
}

async function updatePackageJson(target, version) {
  log.section("Updating package.json")
  const pkgPath = path.join(target, "package.json")
  let pkg
  if (await exists(pkgPath)) {
    pkg = await readJson(pkgPath)
  } else {
    pkg = { name: path.basename(target), version: "0.1.0", private: true }
    log.warn("No package.json found — creating a minimal one")
  }
  pkg.devDependencies = pkg.devDependencies ?? {}
  const quorumRange = `^${version}`
  if (pkg.devDependencies["@balpal4495/quorum"] || pkg.dependencies?.["@balpal4495/quorum"]) {
    log.skipped("package.json (@balpal4495/quorum already present)")
    return
  }
  pkg.devDependencies["@balpal4495/quorum"] = quorumRange
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
  log.appended(`package.json — added @balpal4495/quorum@${quorumRange} to devDependencies`)
}

async function updateGitignore(target) {
  log.section("Updating .gitignore")
  const dest  = path.join(target, ".gitignore")
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
    if (existing.includes(".chronicle/entries/")) { log.skipped(".gitignore (already present)"); return }
    await fs.appendFile(dest, block, "utf8")
    log.appended(".gitignore")
  } else {
    await fs.writeFile(dest, block.trimStart(), "utf8")
    log.created(".gitignore")
  }
}

async function createChronicle(target) {
  log.section("Creating Chronicle")
  await fs.mkdir(path.join(target, ".chronicle", "proposals"), { recursive: true })
  log.created(".chronicle/proposals/")
  await fs.mkdir(path.join(target, ".chronicle", "committed"), { recursive: true })
  log.created(".chronicle/committed/")
}

export async function run(PKG_VERSION) {
  const target = process.cwd()

  console.log(c.bold("\nQuorum init"))
  console.log(`Target: ${c.dim(target)}\n`)

  if (target === QUORUM_ROOT) {
    console.log(c.yellow("Run this from your project directory, not the Quorum repo itself."))
    process.exit(1)
  }

  await guardAlreadyInitialized(target)
  await writeQuorumDocs(target)
  await mergeCopilotInstructions(target)
  await mergeAgentsMd(target)
  await mergeClaudeMd(target)
  await mergeGeminiMd(target)
  await updatePackageJson(target, PKG_VERSION)
  await updateGitignore(target)
  await createChronicle(target)
  await writeQuorumVersion(target, PKG_VERSION)

  const hasGemini = geminiAvailable()

  console.log(`\n${c.green("✓ Quorum initialized.")} ${c.dim(`(v${PKG_VERSION})`)}`)
  console.log("\nNext steps:")
  console.log("  1. npm install")
  console.log("  2. Use the CLI:")
  console.log(c.dim("     quorum advisor brief"))
  console.log(c.dim('     quorum advisor "what has the team decided about X?"'))
  console.log(c.dim("     quorum check --outcome '...' --design '...'"))
  console.log("\n  For programmatic use:")
  console.log(c.dim('     import { setup } from "@balpal4495/quorum"'))
  console.log(c.dim('     const { oracle, evaluate, deliberate } = await setup({ llm: yourProvider })'))
  console.log("\n  Or tell your AI: \"follow quorum/SETUP.md\"")

  if (!hasGemini) {
    console.log(`\n  ${c.dim("Optional: install Gemini CLI for large-context assistance")}`)
    console.log(c.dim("  npm install -g @google/gemini-cli  +  set GEMINI_API_KEY"))
  } else {
    console.log(`\n  ${c.green("✓ Gemini CLI detected")} — GEMINI.md written. Set GEMINI_API_KEY if not already set.`)
  }
  console.log("")
}
