/**
 * Auto-detect an available LLM provider from the environment.
 *
 * Priority:
 *   1. ANTHROPIC_API_KEY            → Anthropic Claude
 *   2. OPENAI_API_KEY               → OpenAI (or compatible via OPENAI_BASE_URL)
 *   3. GEMINI_API_KEY               → Google Gemini
 *   4. OPENAI_BASE_URL (no key)     → OpenAI-compatible endpoint (Azure, Groq, Ollama, etc.)
 *   5. OLLAMA_HOST env var          → Ollama (explicit host)
 *   6. localhost:11434 probe        → Ollama (auto-detect)
 *
 * Returns { llm: LLMProvider, name: string } or null.
 */
export async function detectProvider() {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      llm:  createAnthropicProvider(process.env.ANTHROPIC_API_KEY),
      name: "Anthropic",
    }
  }

  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.OPENAI_BASE_URL ?? "").replace(/\/$/, "")
    const name = base
      ? `OpenAI-compatible (${new URL(base).hostname})`
      : "OpenAI"
    return {
      llm:  createOpenAICompatProvider(process.env.OPENAI_API_KEY, base || "https://api.openai.com/v1"),
      name,
    }
  }

  if (process.env.GEMINI_API_KEY) {
    return {
      llm:  createGeminiProvider(process.env.GEMINI_API_KEY),
      name: "Gemini",
    }
  }

  if (process.env.OPENAI_BASE_URL) {
    const base = process.env.OPENAI_BASE_URL.replace(/\/$/, "")
    return {
      llm:  createOpenAICompatProvider("", base),
      name: `OpenAI-compatible (${new URL(base).hostname})`,
    }
  }

  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434"
  const ollamaModel = await probeOllama(ollamaHost)
  if (ollamaModel) {
    return {
      llm:  createOpenAICompatProvider("", `${ollamaHost}/v1`, ollamaModel),
      name: `Ollama (${ollamaModel})`,
    }
  }

  return null
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
        max_tokens: 2048,
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
        max_tokens: 2048,
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
