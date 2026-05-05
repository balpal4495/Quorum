/**
 * LanceDB vector store adapter.
 *
 * Required package: npm install vectordb
 *
 * Chronicle entries are stored in .chronicle/entries/ (LanceDB table directory).
 * Vectors are indexed with cosine metric — no need to pre-normalise embeddings.
 *
 * Note: this adapter targets the `vectordb` package (LanceDB v0.x).
 * If your project uses `@lancedb/lancedb` (v0.4+), the connect/createTable API
 * is nearly identical but table.query() replaces table.search() for non-vector queries.
 */

import type { VectorStore } from "../types"
import type { ChronicleEntry } from "../../shared/types"
import path from "path"

// eslint-disable-next-line @typescript-eslint/no-require-imports
const lancedb = require("vectordb")

interface LanceRow {
  id: string
  vector: number[]
  /** ChronicleEntry serialised as JSON string. */
  payload: string
  _distance?: number
}

export async function createLanceDBStore(chronicleDir: string): Promise<VectorStore> {
  const tableDir = path.join(chronicleDir, "entries")
  const db = await lancedb.connect(tableDir)
  let table: any = null

  async function getOrCreateTable(firstRow?: LanceRow): Promise<any> {
    if (table) return table
    const names: string[] = await db.tableNames()
    if (names.includes("entries")) {
      table = await db.openTable("entries")
    } else if (firstRow) {
      table = await db.createTable("entries", [firstRow], { metric: "cosine" })
    }
    return table
  }

  return {
    async upsert(id, vector, metadata) {
      const row: LanceRow = { id, vector, payload: JSON.stringify(metadata) }
      const t = await getOrCreateTable(row)
      if (t !== table) {
        // table was just created with this row — already inserted
        return
      }
      // LanceDB does not have native upsert — delete existing then insert
      await t.delete(`id = '${sanitiseId(id)}'`)
      await t.add([row])
    },

    async search(vector, limit) {
      const t = await getOrCreateTable()
      if (!t) return []
      const rows: LanceRow[] = await t.search(vector).limit(limit).execute()
      return rows.map(row => ({
        entry: JSON.parse(row.payload) as ChronicleEntry,
        // Convert L2 distance (cosine metric stores 1 - cosine_sim as distance)
        score: row._distance !== undefined ? 1 - row._distance : 0,
      }))
    },

    async getAll() {
      const t = await getOrCreateTable()
      if (!t) return []
      const rows: LanceRow[] = await t.query().execute()
      return rows.map(row => JSON.parse(row.payload) as ChronicleEntry)
    },
  }
}

/** Prevent SQL injection in the delete filter. LanceDB uses SQL-like WHERE clauses. */
function sanitiseId(id: string): string {
  return id.replace(/'/g, "''")
}
