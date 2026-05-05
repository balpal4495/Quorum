/**
 * Local ONNX embedder using @xenova/transformers (all-MiniLM-L6-v2).
 *
 * Required package: npm install @xenova/transformers
 *
 * Runs entirely locally — no API key, no network dependency after first use.
 * First call downloads and caches the model (~25 MB).
 * Produces 384-dimensional unit vectors (mean pooling + L2 normalisation).
 *
 * For production use, pre-warm the embedder on startup:
 *   import { warmEmbedder } from "./adapters/xenova-embedder"
 *   await warmEmbedder()
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { pipeline } = require("@xenova/transformers")

let embedderPipeline: any = null

async function getPipeline(): Promise<any> {
  if (!embedderPipeline) {
    embedderPipeline = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    )
  }
  return embedderPipeline
}

/**
 * Embed text using all-MiniLM-L6-v2.
 * Returns a 384-dimensional unit vector.
 */
export async function xenovaEmbed(text: string): Promise<number[]> {
  const embedder = await getPipeline()
  const output = await embedder(text, { pooling: "mean", normalize: true })
  return Array.from(output.data) as number[]
}

/** Pre-warm the model so the first real query is not slow. */
export async function warmEmbedder(): Promise<void> {
  await getPipeline()
}
