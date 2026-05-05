/**
 * Lightweight BM25 implementation for Pass 2 re-ranking.
 *
 * k1 = 1.5  (term frequency saturation)
 * b  = 0.75 (length normalization)
 *
 * Formula: score(q, d) = Σ IDF(qi) * f(qi, d) * (k1 + 1) / (f(qi, d) + k1 * (1 − b + b * |d| / avgdl))
 */

const K1 = 1.5
const B = 0.75

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/\b\w+\b/g) ?? []
}

/** Robertson–Sparck Jones IDF with smoothing. */
function computeIdf(N: number, df: number): number {
  return Math.log(1 + (N - df + 0.5) / (df + 0.5))
}

/**
 * Score each document string against the query using BM25.
 * Returns a score array parallel to `documents`.
 */
export function bm25Score(query: string, documents: string[]): number[] {
  if (documents.length === 0) return []

  const queryTokens = tokenize(query)
  const docTokenLists = documents.map(tokenize)
  const totalLength = docTokenLists.reduce((sum, d) => sum + d.length, 0)
  const avgdl = totalLength / docTokenLists.length
  const N = documents.length

  // Precompute document frequency for each unique query token
  const df = new Map<string, number>()
  for (const token of queryTokens) {
    if (!df.has(token)) {
      df.set(token, docTokenLists.filter(doc => doc.includes(token)).length)
    }
  }

  return docTokenLists.map(docTokenList => {
    const docLength = docTokenList.length

    const tf = new Map<string, number>()
    for (const token of docTokenList) {
      tf.set(token, (tf.get(token) ?? 0) + 1)
    }

    let score = 0
    for (const token of queryTokens) {
      const termFreq = tf.get(token) ?? 0
      if (termFreq === 0) continue
      const idfScore = computeIdf(N, df.get(token) ?? 0)
      const normTf =
        (termFreq * (K1 + 1)) /
        (termFreq + K1 * (1 - B + B * (docLength / avgdl)))
      score += idfScore * normTf
    }

    return score
  })
}

const BM25_STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "could", "may", "might", "shall", "can", "to", "of", "in", "for", "on",
  "with", "at", "by", "from", "as", "into", "through", "and", "or", "but",
  "if", "then", "this", "that", "these", "those", "it", "its", "we", "they",
  "their", "there", "when", "where", "what", "which", "who", "how", "not", "no",
])

/**
 * Extract domain terms from Chronicle key insights for Pass 2 query enrichment.
 * Bridges the vocabulary gap between natural language queries and technical identifiers.
 * Strips stop words, returns the most frequent distinctive tokens.
 */
export function extractDomainTerms(insights: string[]): string[] {
  const allTokens = insights.flatMap(s => tokenize(s))
  const freq = new Map<string, number>()
  for (const token of allTokens) {
    if (!BM25_STOP_WORDS.has(token) && token.length > 2) {
      freq.set(token, (freq.get(token) ?? 0) + 1)
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([token]) => token)
}
