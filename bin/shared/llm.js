/**
 * Auto-detect an LLM provider from environment variables.
 * Returns a provider function compatible with the Quorum LLMProvider type,
 * or null if no API key is configured.
 *
 * Priority: ANTHROPIC_API_KEY → OPENAI_API_KEY
 */
export async function detectLLM() {
  if (process.env.ANTHROPIC_API_KEY) {
    return createAnthropicProvider(process.env.ANTHROPIC_API_KEY)
  }
  if (process.env.OPENAI_API_KEY) {
    return createOpenAIProvider(process.env.OPENAI_API_KEY)
  }
  return null
}

/** Which provider was detected — used for display purposes. */
export function detectLLMName() {
  if (process.env.ANTHROPIC_API_KEY) return "Anthropic"
  if (process.env.OPENAI_API_KEY)    return "OpenAI"
  return null
}

function createAnthropicProvider(apiKey) {
  return async function llm(messages, model = "claude-3-5-sonnet-20241022") {
    const systemMsg = messages.find(m => m.role === "system")?.content
    const userMessages = messages.filter(m => m.role !== "system")

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
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

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API ${response.status}: ${err.slice(0, 200)}`)
    }

    const data = await response.json()
    return data.content?.[0]?.text ?? ""
  }
}

function createOpenAIProvider(apiKey) {
  return async function llm(messages, model = "gpt-4o") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "content-type":  "application/json",
      },
      body: JSON.stringify({ model, max_tokens: 2048, messages }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI API ${response.status}: ${err.slice(0, 200)}`)
    }

    const data = await response.json()
    return data.choices?.[0]?.message?.content ?? ""
  }
}
