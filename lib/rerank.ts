import config from "@/lib/config"

/** The reranker seam.
 *
 * A cross-encoder scores (query, passage) pairs jointly instead of comparing two independently
 * produced vectors, so it reorders far better than either retrieval channel can — at the cost of
 * one model call per candidate. That trade is only worth making if the current ordering is
 * measurably bad, which is what scripts/eval-retrieval.ts exists to establish.
 *
 * So this ships as the identity function. With RERANK_BASE_URL unset — the default — `rerank`
 * returns its input unchanged and makes no network call at all. Setting it turns on a standard
 * TEI-style `/rerank` endpoint. The point of the seam is that swapping in a reranker later is a
 * config change and a deploy, not a refactor of the retrieval path. */

/** The minimum a hit must carry to be reranked: an id and the text to score against the query. */
export type Rerankable = { id: string; text: string }

type RerankResponse = { index: number; score: number }[]

/** How many characters of a passage are sent for scoring. Cross-encoders truncate at their own
 * context limit anyway, and the head of a chunk is what carries its topic. */
const PASSAGE_CHARS = 1200

export function isRerankEnabled(): boolean {
  return config.retrieval.rerankEnabled
}

/** Reorders hits by cross-encoder relevance to the query.
 *
 * Identity when the reranker is not configured, when there are fewer than two hits to order, or on
 * ANY failure — a timeout, a non-200, a malformed body, or a response whose indices do not line up
 * with what was sent. A reranker that is down must degrade to the fused order, never to an error
 * and never to a partial reordering, so it can be enabled without becoming a new way for search to
 * fail. */
export async function rerank<T extends Rerankable>(query: string, hits: T[]): Promise<T[]> {
  if (!config.retrieval.rerankEnabled || hits.length < 2 || !query.trim()) return hits

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.retrieval.rerankTimeoutMs)
  try {
    const response = await fetch(`${config.retrieval.rerankBaseUrl}/rerank`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(config.retrieval.rerankApiKey ? { Authorization: `Bearer ${config.retrieval.rerankApiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.retrieval.rerankModelName,
        query,
        texts: hits.map((hit) => hit.text.slice(0, PASSAGE_CHARS)),
      }),
    })
    if (!response.ok) throw new Error(`rerank_http_${response.status}`)
    const scored = (await response.json()) as RerankResponse
    if (!Array.isArray(scored) || scored.length !== hits.length) throw new Error("rerank_length_mismatch")

    const ordered: T[] = []
    const seen = new Set<number>()
    for (const entry of [...scored].sort((a, b) => b.score - a.score)) {
      const hit = hits[entry.index]
      // A duplicated or out-of-range index means the response does not describe what was sent;
      // trusting it would silently drop or repeat results.
      if (!hit || seen.has(entry.index)) throw new Error("rerank_index_mismatch")
      seen.add(entry.index)
      ordered.push(hit)
    }
    return ordered
  } catch (error) {
    console.error("rerank: keeping fused order:", error instanceof Error ? error.message : error)
    return hits
  } finally {
    clearTimeout(timeout)
  }
}
