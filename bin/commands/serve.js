import { c } from "../shared/colors.js"
import { findChronicleDir } from "../shared/chronicle.js"
import { detectProvider } from "../shared/llm.js"
import { createServer } from "../mcp/server.js"

function parseArgs(argv) {
  const portIdx = argv.indexOf("--port")
  const port = portIdx !== -1
    ? Number(argv[portIdx + 1])
    : Number(argv.find(a => /^\d{2,5}$/.test(a)) ?? 3000)
  const hostIdx = argv.indexOf("--host")
  const host = hostIdx !== -1 ? argv[hostIdx + 1] : "localhost"
  return { port: isNaN(port) ? 3000 : port, host }
}

export async function run(argv) {
  const { port, host } = parseArgs(argv)

  const projectRoot  = process.cwd()
  const chronicleDir = await findChronicleDir(projectRoot)

  if (!chronicleDir) {
    console.error(`\n${c.red("No .chronicle/ directory found.")} Run ${c.bold("quorum init")} first.\n`)
    process.exit(1)
  }

  // Auto-detect LLM provider (non-blocking — serve still works without one)
  const provider = await detectProvider()
  const llm      = provider?.llm ?? null

  const server = await createServer({ projectRoot, chronicleDir, llm })

  server.listen(port, host, () => {
    const base = `http://${host}:${port}`
    console.log(`\n${c.bold("Quorum")}  ${c.dim(`serving ${projectRoot}`)}\n`)
    console.log(`  ${c.cyan("UI")}         ${c.dim(base + "/")}`)
    console.log(`  ${c.cyan("MCP")}        ${c.dim(base + "/mcp")}`)
    console.log(`  ${c.cyan("Chronicle")}  ${c.dim(chronicleDir)}`)
    console.log(`  ${c.cyan("Advisor")}    ${llm ? c.green(provider.name) : c.dim("no LLM — set ANTHROPIC_API_KEY or OPENAI_API_KEY")}\n`)
    console.log(c.bold("Claude Desktop") + c.dim(" — add to claude_desktop_config.json:"))
    console.log(c.dim(JSON.stringify({
      mcpServers: { quorum: { type: "streamable-http", url: `${base}/mcp` } }
    }, null, 2)))
    console.log(`\n${c.dim("Press Ctrl+C to stop.")}\n`)
  })

  server.on("error", err => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n${c.red(`Port ${port} is already in use.`)} Try ${c.bold(`quorum serve --port ${port + 1}`)}\n`)
    } else {
      console.error(`\n${c.red("Server error:")} ${err.message}\n`)
    }
    process.exit(1)
  })

  process.on("SIGINT",  () => { server.close(); process.exit(0) })
  process.on("SIGTERM", () => { server.close(); process.exit(0) })
}
