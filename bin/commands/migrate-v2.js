import { promises as fs } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createRequire } from "module"
import { c, log } from "../shared/colors.js"

const _require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const QUORUM_ROOT = path.resolve(__dirname, "../..")

async function exists(p) {
  return fs.access(p).then(() => true).catch(() => false)
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true })
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"))
}

async function detectV1Artifacts(target) {
  const artifacts = []
  const vendoredModules = path.join(target, "quorum", "modules")
  const vendoredEvals   = path.join(target, "quorum", "evals")
  if (await exists(vendoredModules)) artifacts.push({ path: vendoredModules, label: "quorum/modules/" })
  if (await exists(vendoredEvals))   artifacts.push({ path: vendoredEvals,   label: "quorum/evals/" })
  return artifacts
}

async function removeVendoredArtifacts(artifacts) {
  for (const artifact of artifacts) {
    await rmrf(artifact.path)
    log.ok(`Removed ${artifact.label}`)
  }
}

async function ensurePackageJsonDependency(target, version) {
  const pkgPath = path.join(target, "package.json")
  if (!await exists(pkgPath)) return
  const pkg = await readJson(pkgPath)
  const already = pkg.dependencies?.["@balpal4495/quorum"] || pkg.devDependencies?.["@balpal4495/quorum"]
  if (already) {
    log.skipped("package.json (@balpal4495/quorum already listed)")
    return
  }
  pkg.devDependencies = pkg.devDependencies ?? {}
  pkg.devDependencies["@balpal4495/quorum"] = `^${version}`
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8")
  log.appended(`package.json — added @balpal4495/quorum@^${version} to devDependencies`)
}

async function refreshHostDocs(target) {
  // Replace quorum/CLAUDE.md with the host-facing template (not module internals)
  const claudeSrc = path.join(QUORUM_ROOT, "bin", "templates", "CLAUDE.md")
  const claudeDest = path.join(target, "quorum", "CLAUDE.md")
  if (await exists(claudeSrc) && await exists(claudeDest)) {
    const current = await fs.readFile(claudeDest, "utf8")
    // Only replace if it looks like the old module-internal version
    if (current.includes("Key design decisions to preserve") || current.includes("Dependency injection throughout")) {
      await fs.copyFile(claudeSrc, claudeDest)
      log.ok("quorum/CLAUDE.md — replaced module-internal doc with host-facing operational guide")
    } else {
      log.skipped("quorum/CLAUDE.md (does not look like v1 module-internal doc — leaving as-is)")
    }
  }
}

async function writeVersionFile(target, version) {
  await fs.writeFile(path.join(target, ".quorum-version"), version + "\n", "utf8")
  log.ok(`.quorum-version — written (${version})`)
}

export async function run(argv) {
  const target = process.cwd()
  const dryRun = argv.includes("--dry-run")
  const pkg    = _require(path.join(QUORUM_ROOT, "package.json"))

  console.log(c.bold("\nQuorum migrate-v2") + c.dim(`  v${pkg.version}`) + (dryRun ? c.yellow("  [dry-run]") : ""))
  console.log(`Target: ${c.dim(target)}\n`)

  // ── Detect v1 artifacts ──────────────────────────────────────────────────
  log.section("Scanning for v1 artifacts")
  const artifacts = await detectV1Artifacts(target)

  if (artifacts.length === 0) {
    console.log(c.dim("\n  No v1 vendored artifacts found (quorum/modules/, quorum/evals/)."))
    console.log(c.dim("  This project may already be on v2, or was never on v1.\n"))

    const hasVersionFile = await exists(path.join(target, ".quorum-version"))
    if (!hasVersionFile) {
      console.log(c.yellow("  No .quorum-version file found. Run 'quorum init' to initialize properly.\n"))
    } else {
      const currentVersion = (await fs.readFile(path.join(target, ".quorum-version"), "utf8")).trim()
      console.log(c.green(`  .quorum-version: ${currentVersion}  ✓\n`))
    }
    return
  }

  console.log("")
  for (const a of artifacts) {
    console.log(`  ${c.yellow("⚠")}  Found: ${c.bold(a.label)}`)
  }
  console.log("")
  console.log(c.dim("  These directories were copied by quorum init in v1 and are no longer needed."))
  console.log(c.dim("  In v2, modules live in node_modules/@balpal4495/quorum."))

  if (dryRun) {
    console.log(c.yellow("\n  [dry-run] No changes made. Re-run without --dry-run to apply.\n"))
    return
  }

  // ── Remove vendored artifacts ────────────────────────────────────────────
  log.section("Removing v1 vendored artifacts")
  await removeVendoredArtifacts(artifacts)

  // ── Ensure package.json lists the dependency ─────────────────────────────
  log.section("Updating package.json")
  await ensurePackageJsonDependency(target, pkg.version)

  // ── Refresh host-facing docs ─────────────────────────────────────────────
  log.section("Refreshing host docs")
  await refreshHostDocs(target)

  // ── Write version marker ─────────────────────────────────────────────────
  log.section("Version marker")
  await writeVersionFile(target, pkg.version)

  console.log(`\n${c.green("✓ Migration complete.")}\n`)
  console.log("Next steps:")
  console.log(c.dim("  1. npm install             — install @balpal4495/quorum as a package dep"))
  console.log(c.dim("  2. quorum sync             — refresh instruction blocks"))
  console.log(c.dim("  3. git rm -r quorum/modules quorum/evals 2>/dev/null  — remove from git index if tracked"))
  console.log("")
}
