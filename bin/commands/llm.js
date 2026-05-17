import { probeAll, detectProvider } from "../shared/llm.js"
import { c } from "../shared/colors.js"

function row(detected, name, note, suffix = "") {
  const icon  = detected ? c.green("✓") : c.dim("·")
  const label = detected ? c.bold(name) : c.dim(name)
  const right  = detected
    ? (note ? c.dim(`  ${note}`) : "") + (suffix ? `  ${suffix}` : "")
    : (note ? `  ${c.dim(note)}` : "")
  return `  ${icon}  ${label.padEnd(26)}${right}`
}

export async function run(args) {
  const test = args.includes("--test")

  console.log("")
  console.log(`${c.bold("quorum llm")}  ${c.dim("— LLM provider status")}`)
  console.log("")

  // Run all probes in parallel with active provider detection
  const [providers, active] = await Promise.all([probeAll(), detectProvider()])
  const activeName = active?.name ?? null

  console.log("  Provider scan")
  console.log(c.dim("  ─────────────────────────────────────────────────────"))

  // Normalize names for active matching (gatherCandidates uses "Gemini", probeAll uses "Gemini API")
  const norm = n => n.replace(/ API$/, "").replace(/ \(.*?\)$/, "").toLowerCase()

  for (const p of providers) {
    const isActive = p.detected && !!activeName && norm(p.name) === norm(activeName)

    const badges = []
    if (isActive)                                  badges.push(c.green("← active"))
    if (p.detected && p.id === "ollama" && p.note) badges.push(c.dim(`(${p.note})`))
    const suffix = badges.join("  ")

    console.log(row(p.detected, p.name, null, suffix))
    if (!p.detected && p.note) {
      console.log(`       ${c.dim(p.note)}`)
    }
  }

  console.log("")

  if (!activeName) {
    console.log(`  ${c.yellow("No provider detected.")}`)
    console.log("")
    printSetupGuide()
    return
  }

  console.log(`  Active: ${c.bold(activeName)}`)
  console.log("")

  if (!test) {
    console.log(c.dim("  Run 'quorum llm --test' to send a live request and verify it works."))
    console.log("")
    return
  }

  // ── Live test ──────────────────────────────────────────────────────────────
  process.stdout.write(`  Testing ${c.bold(activeName)}… `)
  const t0 = Date.now()

  try {
    const result = await active.llm([
      { role: "user", content: "Respond with exactly the word OK and nothing else." },
    ])
    const ms = Date.now() - t0
    const ok = /\bOK\b/i.test(result?.trim() ?? "")
    if (ok) {
      console.log(`${c.green("✓")}  ${c.dim(`(${ms}ms)`)}`)
    } else {
      console.log(`${c.yellow("✓ (unexpected response)")}  ${c.dim(`(${ms}ms)`)}`)
      console.log(c.dim(`     → ${(result ?? "").slice(0, 120)}`))
    }
  } catch (err) {
    console.log(c.red("✗"))
    console.log(`     ${c.red(err.message?.slice(0, 200) ?? String(err))}`)
    console.log("")
    console.log(`  ${c.yellow("The detected provider failed.")} Check that you're signed in, then retry.`)
  }
  console.log("")
}

function printSetupGuide() {
  console.log("  Quickest options:")
  console.log("")
  console.log(`  ${c.bold("A")}  ${c.bold("Claude Code CLI")}  ${c.dim("(no API key needed)")}`)
  console.log(c.dim("     Install and sign in: https://claude.ai/code"))
  console.log(c.dim("     Quorum auto-detects it once you're signed in."))
  console.log("")
  console.log(`  ${c.bold("B")}  ${c.bold("GitHub Copilot CLI")}  ${c.dim("(no API key needed)")}`)
  console.log(c.dim("     Install VS Code + GitHub Copilot Chat extension, then sign in."))
  console.log(c.dim("     Quorum auto-detects it once a session exists."))
  console.log("")
  console.log(`  ${c.bold("C")}  ${c.bold("API key")}  ${c.dim("(Anthropic, OpenAI, or Gemini)")}`)
  console.log(c.dim("     export ANTHROPIC_API_KEY=sk-ant-…"))
  console.log(c.dim("     export OPENAI_API_KEY=sk-…"))
  console.log(c.dim("     export GEMINI_API_KEY=…"))
  console.log("")
  console.log(`  ${c.bold("D")}  ${c.bold("Ollama")}  ${c.dim("(local, free)")}`)
  console.log(c.dim("     brew install ollama && ollama serve && ollama pull llama3.2"))
  console.log("")
  console.log(`  ${c.dim("After setup, run 'quorum llm' again to confirm detection.")}`)
  console.log("")
}
