import type { ChronicleEntry } from "../shared/types.js"

/**
 * Abstract vector store interface.
 * Swap implementations without changing Oracle logic.
 * Default implementation: LanceDB (see adapters/lance-db.ts).
 */
export interface VectorStore {
  /**
   * Upsert a Chronicle entry with its embedding vector.
   * If an entry with this ID already exists, it is replaced.
   */
  upsert: (id: string, vector: number[], metadata: ChronicleEntry) => Promise<void>
  /**
   * Return the top-K most similar entries to the given query vector.
   * Scores should be in [0, 1] (higher = more similar).
   */
  search: (
    vector: number[],
    limit: number,
  ) => Promise<Array<{ entry: ChronicleEntry; score: number }>>
  /** Return all stored entries (used for full-corpus BM25 if needed). */
  getAll: () => Promise<ChronicleEntry[]>
}

export interface OracleDeps {
  /** Converts text to a numeric embedding vector. */
  embedder: (text: string) => Promise<number[]>
  vectorStore: VectorStore
  /** Root directory for Chronicle data. Default: ".chronicle" */
  chronicleDir?: string
}
