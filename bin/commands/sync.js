import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { c, log } from "../shared/colors.js"
import { createRequire } from "module"

const _require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUORUM_ROOT = path.resolve(__dirname, "../..")

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false)
}

async function syncFile(target, destRelative, freshContent) {
  const dest = path.join(target, destRelative)
  if (!await exists(dest)) {
    log.skipped(`${destRelative} (not present — run quorum init first)`)
    return false
  }
  const existing = await fs.readFile(dest, "utf8")
  const startTag = "<!-- quorum:start -->"
  const endTag   = "<!-- quorum:end -->"
  const start = existing.indexOf(startTag)
  const end   = existing.indexOf(endTag)
  if (start === -1 || end === -1) {
    log.skipped(`${destRelative} (no quorum marker block found)`)
    return false
  }
  const fresh = `${startTag}\n${freshContent}\n${endTag}`
  const updated = existing.slice(0, start) + fresh + existing.slice(end + endTag.length)
  if (updated === existing) {
    log.skipped(`${destRelative} (already up to date)`)
    return false
  }
  await fs.writeFile(dest, updated, "utf8")
  log.appended(`${destRelative} (marker block refreshed)`)
  return true
}

async function syncCopilotInstructions(target) {
  const src = path.join(QUORUM_ROOT, ".github", "copilot-instructions.md")
  if (!await exists(src)) return
  const content = await fs.readFile(src, "utf8")
  await syncFile(target, ".github/copilot-instructions.md", content)
}

async function syncQuorumDocs(target) {
  // Replace quorum/CLAUDE.md and quorum/AGENTS.md wholesale — no marker blocks
  const claudeSrc  = path.join(QUORUM_ROOT, "bin", "templates", "CLAUDE.md")
  const agentsSrc  = path.join(QUORUM_ROOT, "modules", "AGENTS.md")
  const setupSrc   = path.join(QUORUM_ROOT, "SETUP.md")

  for (const [src, destName] of [[claudeSrc, "quorum/CLAUDE.md"], [agentsSrc, "quorum/AGENTS.md"], [setupSrc, "quorum/SETUP.md"]]) {
    const dest = path.join(target, destName)
    if (!await exists(src)) continue
    if (!await exists(dest)) { log.skipped(`${destName} (not present)`); continue }
    const [fresh, current] = await Promise.all([fs.readFile(src, "utf8"), fs.readFile(dest, "utf8")])
    if (fresh === current) { log.skipped(`${destName} (already up to date)`); continue }
    await fs.writeFile(dest, fresh, "utf8")
    log.appended(`${destName} (updated)`)
  }
}

async function syncVersionFile(target) {
  const pkg = _require(path.join(QUORUM_ROOT, "package.json"))
  const dest = path.join(target, ".quorum-version")
  const current = await exists(dest) ? (await fs.readFile(dest, "utf8")).trim() : null
  if (current === pkg.version) {
    log.skipped(`.quorum-version (already ${pkg.version})`)
    return
  }
  await fs.writeFile(dest, pkg.version + "\n", "utf8")
  log.appended(`.quorum-version — updated to ${pkg.version}`)
}

export async function run() {
  const target = process.cwd()
  const pkg = _require(path.join(QUORUM_ROOT, "package.json"))

  console.log(c.bold("\nQuorum sync") + c.dim(`  v${pkg.version}`))
  console.log(`Target: ${c.dim(target)}\n`)

  if (!await exists(path.join(target, ".quorum-version"))) {
    console.log(c.yellow("Quorum is not initialized here. Run 'quorum init' first.\n"))
    process.exit(1)
  }

  log.section("Refreshing instruction files")
  await syncCopilotInstructions(target)

  log.section("Refreshing quorum docs")
  await syncQuorumDocs(target)
  await syncVersionFile(target)

  console.log(`\n${c.green("✓ Sync complete.")}\n`)
}
