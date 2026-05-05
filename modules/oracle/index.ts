export { query } from "./query"
export { propose, commit } from "./propose"
export type { OracleDeps, VectorStore } from "./types"
export type {
  OracleResult,
  QueryOptions,
  ChronicleEntry,
  OracleClient,
} from "../shared/types"

export { createLanceDBStore } from "./adapters/lance-db"
export { xenovaEmbed, warmEmbedder } from "./adapters/xenova-embedder"

import type { OracleClient } from "../shared/types"
import type { OracleDeps } from "./types"
import { query } from "./query"
import { propose, commit } from "./propose"

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
