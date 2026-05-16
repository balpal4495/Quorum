import type { ProductSource, ProductSourceFinding, ProductSourceScanInput } from "../types"

export function docsSource(): ProductSource {
  return {
    id: "docs",
    kind: "docs",
    async scan(input: ProductSourceScanInput): Promise<ProductSourceFinding[]> {
      const { promises: fs } = await import("fs")
      const path = await import("path")

      const targets = [
        "README.md",
        "SETUP.md",
        "CLAUDE.md",
        "AGENTS.md",
        "GEMINI.md",
        "modules/README.md",
        "quorum/CLAUDE.md",
        "quorum/SETUP.md",
        "docs",
      ]

      const findings: ProductSourceFinding[] = []
      let idx = 0

      async function scanMarkdown(filePath: string): Promise<void> {
        let content: string
        try {
          content = await fs.readFile(filePath, "utf8")
        } catch {
          return
        }
        const rel = path.relative(input.rootDir, filePath).replace(/\\/g, "/")
        const lines = content.split("\n")

        // Extract headings as structural claims
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]
          const headingMatch = line.match(/^#{1,3}\s+(.+)/)
          if (headingMatch) {
            const heading = headingMatch[1].trim()
            // Grab up to 3 lines of context below
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

          // Extract CLI code blocks (``` lines starting with quorum)
          if (line.trim().startsWith("quorum ") || line.trim().startsWith("npx quorum")) {
            const cmd = line.trim()
            findings.push({
              id: `docs-cmd-${idx++}`,
              kind: "docs",
              source: rel,
              path: rel,
              line: i + 1,
              title: `CLI usage: ${cmd.slice(0, 60)}`,
              summary: `Documented command: ${cmd}`,
              confidence: 0.85,
              tags: ["cli", "command", ...inferTags(cmd)],
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
          if (entry.isDirectory() && !["node_modules", ".git", "dist"].includes(entry.name)) {
            await scanDir(full)
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            await scanMarkdown(full)
          }
        }
      }

      for (const target of targets) {
        const full = path.join(input.rootDir, target)
        let stat
        try { stat = await fs.stat(full) } catch { continue }
        if (stat.isDirectory()) {
          await scanDir(full)
        } else {
          await scanMarkdown(full)
        }
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

      const binDir = path.join(input.rootDir, "bin", "commands")
      let commandFiles: string[] = []
      try {
        commandFiles = (await fs.readdir(binDir)).filter(f => f.endsWith(".js"))
      } catch {
        return []
      }

      for (const file of commandFiles) {
        const cmdName = file.replace(".js", "")
        const filePath = path.join(binDir, file)
        let content: string
        try { content = await fs.readFile(filePath, "utf8") } catch { continue }

        const relPath = `bin/commands/${file}`

        // Detect subcommands from switch/if patterns
        const subcmdMatches = [...content.matchAll(/case ["']([a-z-]+)["']/g)]
        const subcommands = subcmdMatches.map(m => m[1])

        // Detect flags
        const flagMatches = [...content.matchAll(/["'](--[a-z-]+)["']/g)]
        const flags = [...new Set(flagMatches.map(m => m[1]))]

        // Detect LLM usage
        const usesLLM = /llm|LLM|provider|model/.test(content)

        // Detect Chronicle reads/writes
        const readsChronicle = /readCommitted|findChronicleDir|committed/.test(content)
        const writesChronicle = /writeFile.*proposals|proposals.*writeFile|oracle\.propose/.test(content)

        findings.push({
          id: `cli-${idx++}`,
          kind: "cli",
          source: relPath,
          path: relPath,
          title: `Command: quorum ${cmdName}`,
          summary: [
            `quorum ${cmdName}`,
            subcommands.length > 0 ? `Subcommands: ${subcommands.join(", ")}` : "",
            flags.length > 0 ? `Flags: ${flags.slice(0, 8).join(", ")}` : "",
            usesLLM ? "Uses LLM" : "No LLM required",
            readsChronicle ? "Reads Chronicle" : "",
            writesChronicle ? "Writes Chronicle proposals" : "",
          ].filter(Boolean).join(" | "),
          confidence: 0.9,
          tags: [
            "cli", "command", cmdName,
            ...subcommands.map(s => `subcommand:${s}`),
            usesLLM ? "llm" : "deterministic",
            readsChronicle ? "chronicle" : "",
          ].filter(Boolean),
        })
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

      // Scan modules/
      const modulesDir = path.join(input.rootDir, "modules")
      try {
        const entries = await fs.readdir(modulesDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith("_") && !["shared"].includes(entry.name)) {
            findings.push({
              id: `repo-module-${idx++}`,
              kind: "code",
              source: `modules/${entry.name}/`,
              path: `modules/${entry.name}/`,
              title: `Module: ${entry.name}`,
              summary: `TypeScript module: modules/${entry.name}/`,
              confidence: 0.85,
              tags: ["module", entry.name, "code"],
            })
          }
        }
      } catch { /* no modules dir */ }

      // Scan workflows
      const workflowsDir = path.join(input.rootDir, ".github", "workflows")
      try {
        const entries = await fs.readdir(workflowsDir)
        for (const file of entries.filter(f => f.endsWith(".yml"))) {
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
            tags: ["workflow", "ci", "github-actions"],
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

      async function walkTests(dir: string): Promise<void> {
        let entries
        try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory() && !["node_modules", "dist"].includes(entry.name)) {
            await walkTests(full)
          } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.js"))) {
            let content: string
            try { content = await fs.readFile(full, "utf8") } catch { continue }
            const rel = path.relative(input.rootDir, full).replace(/\\/g, "/")
            // Extract describe/it/test names
            const describeMatches = [...content.matchAll(/(?:describe|it|test)\s*\(\s*["'`]([^"'`]+)/g)]
            const behaviors = describeMatches.map(m => m[1]).slice(0, 5)
            if (behaviors.length > 0) {
              findings.push({
                id: `test-${idx++}`,
                kind: "tests",
                source: rel,
                path: rel,
                title: `Test: ${path.basename(entry.name, ".test.ts")}`,
                summary: `Regression-protected: ${behaviors.join("; ")}`,
                confidence: 0.85,
                tags: ["test", "guaranteed-behavior", ...inferTags(behaviors.join(" "))],
              })
            }
          }
        }
      }

      await walkTests(path.join(input.rootDir, "modules"))
      await walkTests(path.join(input.rootDir, "evals"))

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
    [/onboard|init|install|setup|get.?started/, "onboarding"],
    [/auth|jwt|session|login|token/, "auth"],
    [/database|migration|sql|postgres|mysql/, "database"],
    [/payment|stripe|billing|checkout/, "payments"],
    [/pii|privacy|gdpr|personal.?data/, "pii"],
    [/commit|proposal|review|approve|memory/, "chronicle"],
    [/advisor|brief|query/, "advisor"],
    [/sentinel|coverage|drift/, "sentinel"],
    [/jury|evaluate|score/, "jury"],
    [/council|deliberate|validate/, "council"],
    [/compass|pathway|bet|direction/, "compass"],
    [/cli|command|terminal/, "cli"],
    [/test|eval|spec/, "testing"],
    [/llm|gpt|claude|openai|anthropic|gemini/, "llm"],
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
