import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { execSync } from "child_process"
import { createRequire } from "module"
import { c, log } from "../shared/colors.js"

const _require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUORUM_ROOT = path.resolve(__dirname, "../..")

const DEPS = { zod: "^3.23.0" }
const OPTIONAL_DEPS = {
  vectordb: "^0.4.0",
  "@xenova/transformers": "^2.17.0",
}

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
  if (await exists(path.join(target, "quorum", "modules"))) {
    console.log(c.yellow("\nQuorum is already initialized in this project."))
    console.log("Remove quorum/ first if you want to reinitialize.\n")
    process.exit(0)
  }
}

async function copyModules(target) {
  log.section("Copying modules")
  const src  = path.join(QUORUM_ROOT, "modules")
  const dest = path.join(target, "quorum", "modules")
  await fs.cp(src, dest, {
    recursive: true,
    filter: (src) =>
      !src.includes("__tests__") &&
      !src.includes(".test.ts") &&
      !src.includes(".spec.ts"),
  })
  log.created("quorum/modules/")
  await fs.copyFile(
    path.join(QUORUM_ROOT, "SETUP.md"),
    path.join(target, "quorum", "SETUP.md"),
  )
  log.created("quorum/SETUP.md")
}

async function mergeCopilotInstructions(target) {
  log.section("Merging AI instruction files")
  const src     = path.join(QUORUM_ROOT, ".github", "copilot-instructions.md")
  const dest    = path.join(target, ".github", "copilot-instructions.md")
  const content = await fs.readFile(src, "utf8")
  await fs.mkdir(path.join(target, ".github"), { recursive: true })
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("<!-- quorum -->")) { log.skipped(".github/copilot-instructions.md (already present)"); return }
    await fs.appendFile(dest, `\n\n---\n\n<!-- quorum -->\n${content}`, "utf8")
    log.appended(".github/copilot-instructions.md")
  } else {
    await fs.writeFile(dest, content, "utf8")
    log.created(".github/copilot-instructions.md")
  }
}

async function mergeAgentsMd(target) {
  const dest    = path.join(target, "AGENTS.md")
  const section = [
    "", "## Quorum modules", "",
    "See [quorum/modules/AGENTS.md](quorum/modules/AGENTS.md) for Oracle, Jury, and Council internals.",
    "See [.github/copilot-instructions.md](.github/copilot-instructions.md) for workflow rules.", "",
  ].join("\n")
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("quorum/modules/AGENTS.md")) { log.skipped("AGENTS.md (already present)"); return }
    await fs.appendFile(dest, section, "utf8")
    log.appended("AGENTS.md")
  } else {
    await fs.writeFile(dest, `# Agent Instructions\n${section}`, "utf8")
    log.created("AGENTS.md")
  }
}

async function mergeClaudeMd(target) {
  const dest = path.join(target, "CLAUDE.md")
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
# The Bash tool does not auto-source shell profiles — always prefix with source:
source ~/.zshrc && gemini -p "Summarise the public API across all modules"
source ~/.zshrc && gemini -p "I'm about to change X. What should I watch out for?"
\`\`\`

You reason about Gemini's output — it assists, you decide. Never pass its response to the
user unfiltered. If Gemini contradicts what you know from reading the code, trust your reading.
`
  if (await exists(dest)) {
    const existing = await fs.readFile(dest, "utf8")
    if (existing.includes("quorum/modules/CLAUDE.md")) { log.skipped("CLAUDE.md (already present)"); return }
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

async function updatePackageJson(target) {
  log.section("Updating package.json")
  const pkgPath = path.join(target, "package.json")
  let pkg
  if (await exists(pkgPath)) {
    pkg = await readJson(pkgPath)
  } else {
    pkg = { name: path.basename(target), version: "0.1.0", private: true }
    log.warn("No package.json found — creating a minimal one")
  }
  pkg.dependencies         = pkg.dependencies         ?? {}
  pkg.optionalDependencies = pkg.optionalDependencies ?? {}
  const added = []
  for (const [name, version] of Object.entries(DEPS)) {
    if (!pkg.dependencies[name]) { pkg.dependencies[name] = version; added.push(name) }
  }
  for (const [name, version] of Object.entries(OPTIONAL_DEPS)) {
    if (!pkg.optionalDependencies[name]) { pkg.optionalDependencies[name] = version; added.push(`${name} (optional)`) }
  }
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
  if (added.length > 0) {
    log.appended(`package.json — added: ${added.join(", ")}`)
  } else {
    log.skipped("package.json (all deps already present)")
  }
}

async function updateGitignore(target) {
  log.section("Updating .gitignore")
  const dest  = path.join(target, ".gitignore")
  const block = [
    "", "# Quorum — Chronicle",
    "# entries/ is a binary vector store — do not commit",
    ".chronicle/entries/", ".chronicle/query-log.jsonl", "",
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
  await fs.mkdir(path.join(target, ".chronicle", "proposals"),  { recursive: true })
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
  await copyModules(target)
  await mergeCopilotInstructions(target)
  await mergeAgentsMd(target)
  await mergeClaudeMd(target)
  await mergeGeminiMd(target)
  await updatePackageJson(target)
  await updateGitignore(target)
  await createChronicle(target)

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
