import path from "path"
import { promises as fs } from "fs"
import { createOracleClient } from "./oracle/index"
import { xenovaEmbed, warmEmbedder } from "./oracle/adapters/xenova-embedder"
import { createLanceDBStore } from "./oracle/adapters/lance-db"
import { evaluate } from "./jury/evaluate"
import { deliberate } from "./council/deliberate"
import { ask as advisorAsk } from "./advisor/ask"
import type { LLMProvider, OracleClient } from "./shared/types"
import { entryText } from "./shared/types"
import type { JuryInput, JuryOutput, JuryDeps } from "./jury/types"
import type { CouncilInput, CouncilOutput, CouncilDeps, CouncilModels } from "./council/types"
import type { AdvisorOutput } from "./advisor/types"

export interface SetupOptions {
  /**
   * Injectable LLM provider.
   * All modules that need an LLM receive this function.
   * Ignored by Oracle (which has no LLM dependency).
   */
  llm: LLMProvider

  /**
   * Root directory for Chronicle data.
   * Default: ".chronicle" (relative to process.cwd())
   */
  chronicleDir?: string

  /**
   * Model overrides for each reasoning step.
   * If omitted, the LLM provider's default model is used for all steps.
   */
  models?: {
    jury?: string
    council?: CouncilModels
  }

  /**
   * Pre-warm the local ONNX embedder during setup so the first query
   * is not slow. Set to false to skip (e.g. in test environments).
   * Default: true
   */
  warmEmbedder?: boolean

  /**
   * Swap the default embedder (Xenova all-MiniLM-L6-v2) for your own.
   * Must return a vector of consistent dimension.
   */
  embedder?: (text: string) => Promise<number[]>
}

export interface Modules {
  /**
   * Fully wired OracleClient.
   * Use oracle.query() to retrieve evidence.
   * Use oracle.propose() + oracle.commit() for the human-gated write path.
   */
  oracle: OracleClient

  /**
   * Evaluate a proposed design against Oracle evidence.
   * Returns a confidence score and the Council brief for the next step.
   */
  evaluate: (input: Omit<JuryInput, never>) => Promise<JuryOutput>

  /**
   * Run the full Council deliberation pipeline.
   * Proposes the verdict to Oracle automatically — a human must call
   * oracle.commit(proposalId) to index it into Chronicle.
   */
  deliberate: (
    input: Omit<CouncilInput, "jury_output"> & { jury_output: JuryOutput },
  ) => Promise<CouncilOutput>

  /**
   * Ask the Advisor a plain-language question.
   * Queries Oracle automatically, synthesises Chronicle evidence into a
   * human-readable answer, and retries internally until the answer meets
   * the confidence threshold (≥ 0.7, no blockers) or the retry budget runs out.
   */
  ask: (question: string) => Promise<AdvisorOutput>
}

/**
 * Wire up all three modules from a single call.
 *
 * @example
 * import { setup } from "./modules/setup"
 *
 * const { oracle, evaluate, deliberate } = await setup({
 *   llm: myLLMProvider,
 * })
 *
 * const evidence  = await oracle.query("authentication patterns")
 * const jury      = await evaluate({ outcome, design, evidence })
 * const verdict   = await deliberate({ outcome, design, evidence, jury_output: jury })
 *
 * if (verdict.satisfied) {
 *   // → human gate → Executor
 * }
 */
export async function setup(options: SetupOptions): Promise<Modules> {
  const {
    llm,
    chronicleDir = ".chronicle",
    models = {},
    warmEmbedder: shouldWarm = true,
    embedder = xenovaEmbed,
  } = options

  // Ensure Chronicle directories exist before anything tries to write to them
  await fs.mkdir(path.join(chronicleDir, "proposals"), { recursive: true })
  await fs.mkdir(path.join(chronicleDir, "committed"), { recursive: true })

  // Pre-warm the embedder if using the default (downloads model on first use)
  if (shouldWarm && embedder === xenovaEmbed) {
    await warmEmbedder()
  }

  const vectorStore = await createLanceDBStore(chronicleDir)

  // Rebuild local index from committed entries if any are missing.
  // This brings a fresh machine (or a post-git-pull state) up to date
  // without requiring any manual step.
  const committedDir = path.join(chronicleDir, "committed")
  const committedFiles = (await fs.readdir(committedDir)).filter(f => f.endsWith(".json"))

  if (committedFiles.length > 0) {
    const existing = await vectorStore.getAll()
    const existingIds = new Set(existing.map(e => e.id))
    const missing = committedFiles.filter(f => !existingIds.has(f.replace(".json", "")))

    if (missing.length > 0) {
      console.log(`[Chronicle] Rebuilding index from ${missing.length} committed ${missing.length === 1 ? "entry" : "entries"}…`)
      for (const file of missing) {
        const raw = await fs.readFile(path.join(committedDir, file), "utf8")
        const entry = JSON.parse(raw) as import("./shared/types").ChronicleEntry
        const embeddingText = [entryText(entry), ...entry.affected_areas, ...(entry.scope ?? [])].join(" ")
        const vector = await embedder(embeddingText)
        await vectorStore.upsert(entry.id, vector, entry)
      }
    }
  }

  const oracle = createOracleClient({
    embedder,
    vectorStore,
    chronicleDir,
  })

  return {
    oracle,

    evaluate: (input: JuryInput) =>
      evaluate(input, { llm, model: models.jury }),

    deliberate: (input: CouncilInput) =>
      deliberate(input, {
        llm,
        oracle,
        models: models.council,
      }),

    ask: async (question: string) => {
      const evidence = await oracle.query(question)
      return advisorAsk({ question, evidence }, { llm })
    },
  }
}
