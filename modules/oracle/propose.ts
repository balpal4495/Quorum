import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { exec } from "child_process"
import { promisify } from "util"
import type { ChronicleEntry, SimilarityWarning } from "../shared/types"
import type { OracleDeps } from "./types"

const execAsync = promisify(exec)

const INSIGHT_MIN_LENGTH = 20
const INSIGHT_MAX_LENGTH = 200
const SIMILARITY_WARNING_THRESHOLD = 0.85

function validateEntry(entry: Omit<ChronicleEntry, "id" | "timestamp">): void {
  const insight = entry.key_insight?.trim() ?? ""
  if (insight.length < INSIGHT_MIN_LENGTH) {
    throw new Error(
      `key_insight too short (${insight.length} chars, min ${INSIGHT_MIN_LENGTH}). ` +
      `Write a specific, complete sentence naming the module or area affected.`,
    )
  }
  if (insight.length > INSIGHT_MAX_LENGTH) {
    throw new Error(
      `key_insight too long (${insight.length} chars, max ${INSIGHT_MAX_LENGTH}). ` +
      `Distil to a single clear sentence.`,
    )
  }
  if (!entry.affected_areas || entry.affected_areas.filter(a => a.trim()).length === 0) {
    throw new Error(`affected_areas must contain at least one non-empty entry.`)
  }
  if (entry.confidence < 0 || entry.confidence > 1) {
    throw new Error(`confidence must be between 0 and 1, got ${entry.confidence}.`)
  }
}

async function checkSimilarity(
  entry: Omit<ChronicleEntry, "id" | "timestamp">,
  deps: OracleDeps,
): Promise<SimilarityWarning | undefined> {
  try {
    const text = [entry.key_insight, ...entry.affected_areas].join(" ")
    const vector = await deps.embedder(text)
    const results = await deps.vectorStore.search(vector, 3)
    if (results.length === 0) return undefined
    const top = results[0]
    if (top.score < SIMILARITY_WARNING_THRESHOLD) return undefined
    return {
      entry: top.entry,
      score: top.score,
      // If the existing entry is validated, a near-duplicate is likely a correction
      warning: top.entry.status === "validated" ? "potential-supersession" : "potential-duplicate",
    }
  } catch {
    // Similarity check is best-effort — never block a proposal because of it
    return undefined
  }
}

/**
 * Propose a new Chronicle entry for human review.
 * Validates entry quality and checks for similar existing entries before writing.
 * Writes the entry to .chronicle/proposals/<id>.json — NOT yet indexed.
 * The proposal sits pending until a human calls commit() to approve it.
 *
 * Throws if key_insight is too short/long or affected_areas is empty.
 * Returns a SimilarityWarning if a near-identical entry already exists —
 * the human gate should surface this before approving the commit.
 */
export async function propose(
  entry: Omit<ChronicleEntry, "id" | "timestamp">,
  deps: OracleDeps,
): Promise<{ proposalId: string; similarity?: SimilarityWarning }> {
  validateEntry(entry)

  const similarity = await checkSimilarity(entry, deps)

  const chronicleDir = deps.chronicleDir ?? ".chronicle"
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })

  const proposalId = randomUUID()
  const proposalPath = path.join(proposalsDir, `${proposalId}.json`)
  await fs.writeFile(proposalPath, JSON.stringify(entry, null, 2), "utf8")

  return { proposalId, ...(similarity ? { similarity } : {}) }
}

/**
 * Commit a pending proposal after human approval.
 * Reads the proposal file, assigns an ID and timestamp, embeds the entry,
 * upserts it into the vector store, and deletes the proposal file.
 *
 * Throws if the proposal does not exist.
 */
export async function commit(
  proposalId: string,
  deps: OracleDeps,
): Promise<ChronicleEntry> {
  const chronicleDir = deps.chronicleDir ?? ".chronicle"
  const proposalPath = path.join(chronicleDir, "proposals", `${proposalId}.json`)

  let raw: string
  try {
    raw = await fs.readFile(proposalPath, "utf8")
  } catch {
    throw new Error(`Proposal not found: ${proposalId}`)
  }

  const partial = JSON.parse(raw) as Omit<ChronicleEntry, "id" | "timestamp">

  const entry: ChronicleEntry = {
    ...partial,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
  }

  // Embed the key insight (plus affected areas for richer retrieval)
  const embeddingText = [entry.key_insight, ...entry.affected_areas].join(" ")
  const vector = await deps.embedder(embeddingText)
  await deps.vectorStore.upsert(entry.id, vector, entry)

  // Write to committed/ — the git-tracked source of truth shared across the team
  const committedDir = path.join(chronicleDir, "committed")
  await fs.mkdir(committedDir, { recursive: true })
  const committedPath = path.join(committedDir, `${entry.id}.json`)
  await fs.writeFile(committedPath, JSON.stringify(entry, null, 2), "utf8")

  // Stage the committed entry for the next git commit — best-effort
  try {
    await execAsync(`git add "${committedPath}"`)
  } catch {
    // Not in a git repo, or git is unavailable — silently continue
  }

  // Remove the proposal — it has been committed
  await fs.unlink(proposalPath)

  return entry
}
