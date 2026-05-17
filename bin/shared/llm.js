import { spawn, exec } from "child_process"
import { promisify } from "util"
import path from "path"

const execAsync = promisify(exec)

/**
 * Auto-detect all available LLM providers from the environment and return a
 * cascading provider that falls back automatically on quota / rate-limit errors.
 *
 * Detection order (highest priority first):
 *   1. ANTHROPIC_API_KEY            → Anthropic Claude
 *   2. OPENAI_API_KEY               → OpenAI (or compatible via OPENAI_BASE_URL)
 *   3. GEMINI_API_KEY               → Google Gemini (API)
 *   4. OPENAI_BASE_URL (no key)     → OpenAI-compatible endpoint (Azure, Groq, etc.)
 *   5. OLLAMA_HOST / localhost:11434 → Ollama (probed in parallel with the above)
 *   6. gemini CLI in PATH           → Google Gemini (CLI subprocess)
 *
 * All detected providers are tried in order. A 429 / quota / rate-limit error
 * from one provider causes a silent fallback to the next rather than a hard
 * failure. Only non-quota errors or exhausting all providers throws.
 *
 * Returns { llm, name } where name is the primary provider, or null if none found.
 */
export async function detectProvider() {
  const candidates = await gatherCandidates()
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  return {
    llm:  createCascadingLLM(candidates),
    name: candidates[0].name,
  }
}

/**
 * Collect every available provider — all that can be detected run in parallel.
 * Ollama is probed concurrently with API-key checks so it doesn't add latency.
 */
async function gatherCandidates() {
  // Probe async sources concurrently
  const [ollamaModel, geminiCLIAvail] = await Promise.all([
    probeOllama(process.env.OLLAMA_HOST || "http://localhost:11434"),
    probeGeminiCLI(),
  ])

  const candidates = []

  if (process.env.ANTHROPIC_API_KEY) {
    candidates.push({
      llm:  createAnthropicProvider(process.env.ANTHROPIC_API_KEY),
      name: "Anthropic",
    })
  }

  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL ?? "").replace(/\/$/, "")
    const name = base
      ? `OpenAI-compatible (${new URL(base).hostname})`
      : "OpenAI"
    candidates.push({
      llm:  createOpenAICompatProvider(process.env.OPENAI_API_KEY, base || "https://api.openai.com/v1"),
      name,
    })
  } else if (process.env.OPENAI_BASE_URL) {
    const base = process.env.OPENAI_BASE_URL.replace(/\/$/, "")
    candidates.push({
      llm:  createOpenAICompatProvider("", base),
      name: `OpenAI-compatible (${new URL(base).hostname})`,
    })
  }

  if (process.env.GEMINI_API_KEY) {
    candidates.push({
      llm:  createGeminiProvider(process.env.GEMINI_API_KEY),
      name: "Gemini",
    })
  }

  if (ollamaModel) {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434"
    candidates.push({
      llm:  createOpenAICompatProvider("", `${host}/v1`, ollamaModel),
      name: `Ollama (${ollamaModel})`,
    })
  }

  if (geminiCLIAvail) {
    candidates.push({
      llm:  createGeminiCLIProvider(),
      name: "Gemini CLI",
    })
  }

  return candidates
}

/**
 * Returns true if the error looks like a quota / rate-limit response
 * (HTTP 429, "quota exceeded", "rate limit", etc.).
 */
function isQuotaError(err) {
  return /429|quota|rate.?limit/i.test(String(err?.message ?? ""))
}

/**
 * Wraps multiple provider functions into a single LLM function.
 * On a quota error the next provider is tried automatically with a stderr notice.
 * All other errors are re-thrown immediately from the failing provider.
 */
function createCascadingLLM(candidates) {
  return async function llm(messages, model) {
    let lastErr
    for (let i = 0; i < candidates.length; i++) {
      try {
        return await candidates[i].llm(messages, model)
      } catch (err) {
        lastErr = err
        if (isQuotaError(err) && i < candidates.length - 1) {
          process.stderr.write(
            `\n  ⚠  ${candidates[i].name} quota/rate-limit — falling back to ${candidates[i + 1].name}\n\n`,
          )
          continue
        }
        throw err
      }
    }
    throw lastErr
  }
}

/** Convenience wrapper — returns the provider function or null. */
export async function detectLLM() {
  return (await detectProvider())?.llm ?? null
}

/** Convenience wrapper — returns the provider name or null. */
export async function detectLLMName() {
  return (await detectProvider())?.name ?? null
}

// ── Probe Ollama ───────────────────────────────────────────────────────────────

async function probeOllama(host) {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const data = await res.json()
    const model = process.env.OLLAMA_MODEL ?? data.models?.[0]?.name
    return model ?? null
  } catch {
    return null
  }
}

// ── Provider factories ─────────────────────────────────────────────────────────

function createAnthropicProvider(apiKey) {
  return async function llm(messages, model = "claude-3-5-sonnet-20241022") {
    const systemMsg    = messages.find(m => m.role === "system")?.content
    const userMessages = messages.filter(m => m.role !== "system")

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        ...(systemMsg ? { system: systemMsg } : {}),
        messages: userMessages,
      }),
    })

    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? ""
  }
}

/**
 * OpenAI and OpenAI-compatible endpoints (Azure, Groq, Together, Ollama, etc.).
 * Pass an empty apiKey for endpoints that don't require one.
 * Pass a fixedModel to pin the model (e.g. for Ollama where the model comes from probe).
 */
function createOpenAICompatProvider(apiKey, baseUrl, fixedModel) {
  return async function llm(messages, model = "gpt-4o") {
    const headers = { "content-type": "application/json" }
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model:    fixedModel ?? model,
        messages,
        max_tokens: 8192,
      }),
    })

    if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? ""
  }
}

function createGeminiProvider(apiKey) {
  const defaultModel = process.env.GEMINI_MODEL ?? "gemini-2.0-flash"

  return async function llm(messages, model = defaultModel) {
    const systemMsg = messages.find(m => m.role === "system")?.content
    const contents  = messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role:  m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }))

    const body = {
      contents,
      generationConfig: { maxOutputTokens: 2048 },
    }
    if (systemMsg) body.systemInstruction = { parts: [{ text: systemMsg }] }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    )

    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  }
}

async function probeGeminiCLI() {
  try {
    await execAsync("which gemini")
  } catch {
    return false
  }

  // Env vars that indicate Gemini CLI is authenticated
  if (process.env.GOOGLE_GENAI_USE_VERTEXAI || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return true
  }

  // Settings file with a configured auth type
  try {
    const { homedir } = await import("os")
    const { readFile } = await import("fs/promises")
    const raw    = await readFile(path.join(homedir(), ".gemini", "settings.json"), "utf8")
    const config = JSON.parse(raw)
    return !!config.selectedAuthType
  } catch {
    return false
  }
}

function createGeminiCLIProvider() {
  return function llm(messages) {
    return new Promise((resolve, reject) => {
      const system      = messages.find(m => m.role === "system")?.content ?? ""
      const userContent = messages.filter(m => m.role !== "system").map(m => m.content).join("\n\n")

      // Pass system instruction via -p; pipe user content via stdin
      const args = system ? ["-p", system] : []
      const child = spawn("gemini", args, { stdio: ["pipe", "pipe", "pipe"] })

      let out = "", err = ""
      child.stdout.on("data", d => { out += d })
      child.stderr.on("data", d => { err += d })
      child.on("error", reject)
      child.on("close", code => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(`gemini CLI exited ${code}: ${err.slice(0, 200)}`))
      })
      child.stdin.write(userContent)
      child.stdin.end()
    })
  }
}
