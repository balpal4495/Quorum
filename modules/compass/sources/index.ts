import type { ProductSource, ProductSourceFinding, ProductSourceScanInput } from "../types.js"

export function docsSource(): ProductSource {
  return {
    id: "docs",
    kind: "docs",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const findings: ProductSourceFinding[] = []
      let idx = 0
      const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".chronicle", "coverage", ".cache", ".turbo", ".vercel"])

      async function scanMarkdown(filePath: string): Promise<void> {
        let content: string
        try {
          content = await fs.readFile(filePath, "utf8")
        } catch {
          return
        }
        const rel = path.relative(input.rootDir, filePath).replace(/\\/g, "/")
        const lines = content.split("\n")

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const headingMatch = line.match(/^#{1,3}\s+(.+)/)
          if (headingMatch) {
            const heading = headingMatch[1].trim()
            const context = lines
              .slice(i + 1, i + 4)
              .join(" ")
              .replace(/```[^`]*```/g, "")
              .trim()
              .slice(0, 200)
            findings.push({
              id: `docs-${idx++}`,
              kind: "docs",
              source: rel,
              path: rel,
              line: i + 1,
              title: heading,
              summary: context || heading,
              confidence: 0.8,
              tags: inferTags(heading + " " + context),
            })
          }
        }
      }

      async function scanDir(dir: string): Promise<void> {
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
            await scanDir(full)
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            await scanMarkdown(full)
          }
        }
      }

      // Scan all .md files at project root (non-recursive)
      let rootEntries: import("fs").Dirent[] = []
      try { rootEntries = await fs.readdir(input.rootDir, { withFileTypes: true }) } catch { rootEntries = [] }
      for (const entry of rootEntries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          await scanMarkdown(path.join(input.rootDir, entry.name))
        }
      }

      // Scan standard documentation directories recursively
      for (const d of ["docs", "documentation", "doc", ".github", "wiki"]) {
        const full = path.join(input.rootDir, d)
        let stat
        try { stat = await fs.stat(full) } catch { continue }
        if (stat.isDirectory()) await scanDir(full)
      }

      return area(input.area, findings)
    },
  }
}

export function packageSource(): ProductSource {
  return {
    id: "package",
    kind: "package",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")
      const pkgPath = path.join(input.rootDir, "package.json")
      let pkg: Record<string, unknown>
      try {
        pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"))
      } catch {
        return []
      }

      const findings: ProductSourceFinding[] = []
      let idx = 0

      if (pkg.name) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package name", summary: `Published as: ${pkg.name}`, confidence: 1, tags: ["package", "identity"] })
      if (pkg.description) findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package description", summary: String(pkg.description), confidence: 1, tags: ["package", "description"] })
      if (pkg.bin) {
        for (const [name, entry] of Object.entries(pkg.bin as Record<string, string>)) {
          findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: `CLI binary: ${name}`, summary: `CLI binary '${name}' at ${entry}`, confidence: 1, tags: ["cli", "binary"] })
        }
      }
      if (pkg.scripts) {
        for (const [name, cmd] of Object.entries(pkg.scripts as Record<string, string>)) {
          findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: `Script: ${name}`, summary: `npm run ${name}: ${cmd}`, confidence: 0.9, tags: ["script", name] })
        }
      }
      if (pkg.exports) {
        findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Package exports", summary: `Exports: ${JSON.stringify(pkg.exports)}`, confidence: 0.95, tags: ["exports", "api"] })
      }
      if (pkg.engines) {
        findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Engine requirements", summary: `Node: ${(pkg.engines as Record<string, string>).node ?? "unspecified"}`, confidence: 1, tags: ["runtime", "engines"] })
      }
      const deps = { ...(pkg.dependencies as Record<string, string> ?? {}), ...(pkg.optionalDependencies as Record<string, string> ?? {}) }
      if (Object.keys(deps).length > 0) {
        findings.push({ id: `pkg-${idx++}`, kind: "package", source: "package.json", title: "Runtime dependencies", summary: Object.keys(deps).join(", "), confidence: 0.9, tags: ["dependencies"] })
      }

      return findings
    },
  }
}

export function cliSource(): ProductSource {
  return {
    id: "cli",
    kind: "cli",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const findings: ProductSourceFinding[] = []
      let idx = 0

      // ── CLI tool pattern ──────────────────────────────────────────────────
      for (const base of ["bin/commands", "bin", "src/commands", "src/cli"]) {
        const binDir = path.join(input.rootDir, base)
        let entries
        try { entries = await fs.readdir(binDir, { withFileTypes: true }) } catch { continue }
        const files = entries.filter((e: import("fs").Dirent) => e.isFile() && /\.(js|ts)$/.test(e.name))
        for (const entry of files) {
          let content: string
          try { content = await fs.readFile(path.join(binDir, entry.name), "utf8") } catch { continue }
          const cmdName = entry.name.replace(/\.(js|ts)$/, "")
          const relPath = `${base}/${entry.name}`
          const subcommands = [...content.matchAll(/case ["']([a-z-]+)["']/g)].map(m => m[1])
          const flags = [...new Set([...content.matchAll(/["'](--[a-z-]+)["']/g)].map(m => m[1]))]
          findings.push({
            id: `cli-${idx++}`,
            kind: "cli",
            source: relPath,
            path: relPath,
            title: `Command: ${cmdName}`,
            summary: [
              cmdName,
              subcommands.length ? `Subcommands: ${subcommands.join(", ")}` : "",
              flags.length ? `Flags: ${flags.slice(0, 8).join(", ")}` : "",
            ].filter(Boolean).join(" | "),
            confidence: 0.9,
            tags: ["cli", "command", cmdName, ...subcommands.map((s: string) => `subcommand:${s}`)].filter(Boolean),
          })
        }
        if (findings.length) break
      }

      // ── Web app route pattern (Next.js app/pages router) ──────────────────
      if (!findings.length) {
        const SKIP_ROUTE = new Set(["node_modules", "_components", "_lib", "_hooks"])

        async function walkRoutes(dir: string, prefix: string, isApiBase: boolean): Promise<void> {
          let entries
          try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
          for (const e of entries) {
            if (SKIP_ROUTE.has(e.name) || e.name.startsWith(".")) continue
            const full = path.join(dir, e.name)
            const rel = path.relative(input.rootDir, full).replace(/\\/g, "/")
            if (e.isDirectory()) {
              const seg = e.name.startsWith("(") ? "" : ("/" + e.name)
              await walkRoutes(full, prefix + seg, isApiBase || e.name === "api")
            } else if (e.isFile() && /\.(tsx?|jsx?)$/.test(e.name)) {
              const name = e.name.replace(/\.(tsx?|jsx?)$/, "")
              const isPage = ["page", "index"].includes(name) && !["_app", "_document", "_error"].includes(name)
              const isRoute = name === "route"
              if (!isPage && !isRoute) continue
              const route = prefix || "/"
              const isApi = isApiBase || isRoute || prefix.startsWith("/api")
              findings.push({
                id: `route-${idx++}`,
                kind: "code",
                source: rel,
                path: rel,
                title: isApi ? `API: ${route}` : `Page: ${route}`,
                summary: isApi ? `API route at ${route}` : `Page/screen at ${route}`,
                confidence: 0.85,
                tags: [isApi ? "api" : "ui", "route", ...inferTags(route + " " + rel)],
              })
            }
          }
        }

        for (const base of ["app", "pages", "src/app", "src/pages"]) {
          const routeBase = path.join(input.rootDir, base)
          try { await fs.stat(routeBase) } catch { continue }
          await walkRoutes(routeBase, "", base.includes("api"))
          if (findings.length) break
        }
      }

      return area(input.area, findings)
    },
  }
}

export function repoSource(): ProductSource {
  return {
    id: "repo",
    kind: "code",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const findings: ProductSourceFinding[] = []
      let idx = 0

      const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".chronicle", "coverage", ".cache", ".turbo", ".vercel", "public", "static", "assets", "images", "fonts"])
      const SOURCE_HINTS = new Set(["src", "lib", "app", "modules", "packages", "services", "components", "api", "server", "client", "core", "shared", "common", "utils", "hooks", "stores", "models", "types", "schemas", "db", "database"])

      let rootEntries
      try { rootEntries = await fs.readdir(input.rootDir, { withFileTypes: true }) } catch { return findings }

      for (const entry of rootEntries) {
        if (!entry.isDirectory() || SKIP.has(entry.name) || entry.name.startsWith(".")) continue
        const isSource = SOURCE_HINTS.has(entry.name)
        let subEntries: import("fs").Dirent[] = []
        try { subEntries = await fs.readdir(path.join(input.rootDir, entry.name), { withFileTypes: true }) } catch {}
        const subDirs = subEntries.filter((e: import("fs").Dirent) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith(".")).map((e: import("fs").Dirent) => e.name)
        const fileCount = subEntries.filter((e: import("fs").Dirent) => e.isFile()).length
        if (fileCount === 0 && subDirs.length === 0) continue
        const desc = subDirs.length
          ? `Contains: ${subDirs.slice(0, 6).join(", ")}${subDirs.length > 6 ? "\u2026" : ""}`
          : `${fileCount} files`
        findings.push({
          id: `repo-${idx++}`,
          kind: "code",
          source: `${entry.name}/`,
          path: `${entry.name}/`,
          title: `${isSource ? "Source" : "Directory"}: ${entry.name}/`,
          summary: desc,
          confidence: isSource ? 0.9 : 0.7,
          tags: ["code", entry.name, isSource ? "source" : "directory", ...inferTags(entry.name + " " + desc)],
        })
      }

      // GitHub Actions workflows
      const workflowsDir = path.join(input.rootDir, ".github", "workflows")
      try {
        const wfEntries = await fs.readdir(workflowsDir)
        for (const file of wfEntries.filter((f: string) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
          const content = await fs.readFile(path.join(workflowsDir, file), "utf8")
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          findings.push({
            id: `repo-workflow-${idx++}`,
            kind: "config",
            source: `.github/workflows/${file}`,
            path: `.github/workflows/${file}`,
            title: `Workflow: ${nameMatch?.[1]?.trim() ?? file}`,
            summary: `CI/CD workflow: ${nameMatch?.[1]?.trim() ?? file}`,
            confidence: 0.8,
            tags: ["workflow", "ci", "deploy"],
          })
        }
      } catch { /* no workflows */ }

      return area(input.area, findings)
    },
  }
}

export function testsSource(): ProductSource {
  return {
    id: "tests",
    kind: "tests",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const findings: ProductSourceFinding[] = []
      let idx = 0

      const SKIP_TEST = new Set(["node_modules", "dist", "build", ".next", ".cache", "coverage"])

      async function walkTests(dir: string): Promise<void> {
        let entries
        try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory() && !SKIP_TEST.has(entry.name) && !entry.name.startsWith(".")) {
            await walkTests(full)
          } else if (entry.isFile() && /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(entry.name)) {
            let content: string
            try { content = await fs.readFile(full, "utf8") } catch { continue }
            const rel = path.relative(input.rootDir, full).replace(/\\/g, "/")
            const describeMatches = [...content.matchAll(/(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)/g)]
            const behaviors = describeMatches.map(m => m[1]).slice(0, 5)
            if (behaviors.length > 0) {
              findings.push({
                id: `test-${idx++}`,
                kind: "tests",
                source: rel,
                path: rel,
                title: `Test: ${path.basename(entry.name).replace(/\.(test|spec)\.(ts|js|tsx|jsx)$/, "")}`,
                summary: `Regression-protected: ${behaviors.join("; ")}`,
                confidence: 0.85,
                tags: ["test", "guaranteed-behavior", ...inferTags(behaviors.join(" "))],
              })
            }
          }
        }
      }

      await walkTests(input.rootDir)

      return area(input.area, findings)
    },
  }
}

export function configSource(): ProductSource {
  return {
    id: "config",
    kind: "config",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const findings: ProductSourceFinding[] = []
      let idx = 0

      const configFiles = ["tsconfig.json", ".npmignore", ".gitignore"]
      for (const file of configFiles) {
        let content: string
        try { content = await fs.readFile(path.join(input.rootDir, file), "utf8") } catch { continue }
        findings.push({
          id: `cfg-${idx++}`,
          kind: "config",
          source: file,
          path: file,
          title: `Config: ${file}`,
          summary: `${file} — ${content.slice(0, 100).replace(/\n/g, " ").trim()}`,
          confidence: 0.75,
          tags: ["config", file.replace(/[^a-z]/gi, "-")],
        })
      }
      return findings
    },
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function inferTags(text: string): string[] {
  const tags: string[] = []
  const lower = text.toLowerCase()
  const patterns: [RegExp, string][] = [
    [/onboard|install|setup|get.?started/, "onboarding"],
    [/auth|jwt|session|login|token|oauth|saml/, "auth"],
    [/database|migration|sql|postgres|mysql|mongo|redis|prisma/, "database"],
    [/payment|stripe|billing|checkout|invoice|subscription/, "payments"],
    [/pii|privacy|gdpr|personal.?data/, "pii"],
    [/api|endpoint|rest|graphql|rpc|webhook/, "api"],
    [/component|page|view|screen|widget|layout/, "ui"],
    [/deploy|pipeline|release|ci|cd/, "deploy"],
    [/config|setting|env|environment|dotenv/, "config"],
    [/cli|command|terminal/, "cli"],
    [/test|spec|fixture/, "testing"],
    [/llm|gpt|claude|openai|anthropic|gemini|model/, "llm"],
    [/middleware|interceptor|guard|filter/, "middleware"],
    [/worker|job|queue|cron|schedule/, "service"],
  ]
  for (const [rx, tag] of patterns) {
    if (rx.test(lower)) tags.push(tag)
  }
  return tags
}

function area(filterArea: string | undefined, findings: ProductSourceFinding[]): ProductSourceFinding[] {
  if (!filterArea) return findings
  const lower = filterArea.toLowerCase()
  return findings.filter(f =>
    f.tags.some(t => t.toLowerCase().includes(lower)) ||
    f.summary.toLowerCase().includes(lower) ||
    f.title.toLowerCase().includes(lower),
  )
}

// Re-export all sources as a convenience default set
export function defaultSources(): ProductSource[] {
  return [
    docsSource(),
    packageSource(),
    cliSource(),
    repoSource(),
    testsSource(),
    configSource(),
  ]
}
