import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"
import { exec } from "child_process"
import { promisify } from "util"
import type { ChronicleEntry } from "../shared/types"
import type { OracleDeps } from "./types"

const execAsync = promisify(exec)

/**
 * Propose a new Chronicle entry for human review.
 * Writes the entry to .chronicle/proposals/<id>.json — NOT yet indexed.
 * The proposal sits pending until a human calls commit() to approve it.
 */
export async function propose(
  entry: Omit<ChronicleEntry, "id" | "timestamp">,
  deps: OracleDeps,
): Promise<{ proposalId: string }> {
  const chronicleDir = deps.chronicleDir ?? ".chronicle"
  const proposalsDir = path.join(chronicleDir, "proposals")
  await fs.mkdir(proposalsDir, { recursive: true })

  const proposalId = randomUUID()
  const proposalPath = path.join(proposalsDir, `${proposalId}.json`)
  await fs.writeFile(proposalPath, JSON.stringify(entry, null, 2), "utf8")

  return { proposalId }
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
