export { query } from "./query.js"
export { propose, commit } from "./propose.js"
export type { OracleDeps, VectorStore } from "./types.js"
export type {
  OracleResult,
  QueryOptions,
  ChronicleEntry,
  OracleClient,
} from "../shared/types.js"

export { createLanceDBStore } from "./adapters/lance-db.js"
export { xenovaEmbed, warmEmbedder } from "./adapters/xenova-embedder.js"

import type { OracleClient } from "../shared/types.js"
import type { OracleDeps } from "./types.js"
import { query } from "./query.js"
import { propose, commit } from "./propose.js"

/**
 * Create a bound OracleClient from injected deps.
 * Pass this to Jury and Council — they only need the OracleClient interface,
 * not the raw Oracle functions.
 *
 * @example
 * const oracle = createOracleClient({
 *   embedder: xenovaEmbed,
 *   vectorStore: await createLanceDBStore(".chronicle"),
 * })
 */
export function createOracleClient(deps: OracleDeps): OracleClient {
  return {
    query: (text, options) => query(text, options ?? {}, deps),
    propose: entry => propose(entry, deps),
    commit: proposalId => commit(proposalId, deps),
  }
}
