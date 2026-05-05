import { promises as fs } from "fs"
import path from "path"

/**
 * Append a query log entry to .chronicle/query-log.jsonl.
 * Best-effort — callers should swallow errors from this.
 */
export async function appendQueryLog(
  entry: Record<string, unknown>,
  chronicleDir: string,
): Promise<void> {
  await fs.mkdir(chronicleDir, { recursive: true })
  const logPath = path.join(chronicleDir, "query-log.jsonl")
  await fs.appendFile(logPath, JSON.stringify(entry) + "\n", "utf8")
}
