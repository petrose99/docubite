import { embedTexts } from "@/lib/embeddings"
import config from "@/lib/config"
import { DICTATION_ROUTES, type DictationRoute } from "@/lib/dictation/intents"

/** Stage A — the embedding-based semantic router for agnostic dictation.
 *
 * Mirrors lib/query-router.ts's contract deliberately: THE ROUTER CAN ONLY EVER NARROW, NEVER
 * BREAK OR FORCE. Every failure path — feature off, no embeddings configured, an embedding call
 * failing, nothing clearing the confidence threshold — returns `{ intent: "general" }`, which is
 * exactly what a dictation with no router at all would get. There is no code path where a router
 * failure produces a worse outcome than not having a router. */

export type RoutedIntent = {
  intent: string
  route: DictationRoute | null
  score: number
  via: "template" | "disabled" | "not_configured" | "matched" | "below_threshold" | "embedding_failed"
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (!magA || !magB) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

/** One centroid vector per route: the mean of its examples' embeddings. A centroid, not a
 * per-example nearest-neighbour search, because it is a single cheap comparison per route and the
 * examples within one route are written to already cluster tightly (see intents.ts). */
type RouteCentroid = { route: DictationRoute; vector: number[] }

function averageVector(vectors: number[][]): number[] {
  const dims = vectors[0].length
  const sum = new Array(dims).fill(0)
  for (const vector of vectors) for (let i = 0; i < dims; i++) sum[i] += vector[i]
  return sum.map((value) => value / vectors.length)
}

// Embedded once per process and reused — the route examples never change at runtime, so re-
// embedding them on every dictation would be pure waste. A module-scope promise (not a plain
// value) so concurrent first calls share one in-flight embed rather than firing it twice.
let centroidsPromise: Promise<RouteCentroid[]> | null = null

async function getRouteCentroids(): Promise<RouteCentroid[]> {
  if (!centroidsPromise) {
    centroidsPromise = (async () => {
      const results: RouteCentroid[] = []
      for (const route of DICTATION_ROUTES) {
        const vectors = await embedTexts(route.examples, "document")
        if (vectors.length) results.push({ route, vector: averageVector(vectors) })
      }
      return results
    })().catch((error) => {
      // Let the next call retry rather than caching a permanent failure.
      centroidsPromise = null
      throw error
    })
  }
  return centroidsPromise
}

/** Routes one transcript. Never throws — see the contract above. */
export async function routeDictation(transcript: string): Promise<RoutedIntent> {
  const trimmed = transcript.trim()
  if (!config.dictation.routerEnabled) return { intent: "general", route: null, score: 0, via: "disabled" }
  if (!config.embeddings.enabled || !trimmed) return { intent: "general", route: null, score: 0, via: "not_configured" }

  try {
    const centroids = await getRouteCentroids()
    if (!centroids.length) return { intent: "general", route: null, score: 0, via: "not_configured" }

    const [queryVector] = await embedTexts([trimmed], "query")
    let best: RouteCentroid | null = null
    let bestScore = -1
    for (const centroid of centroids) {
      const score = cosineSimilarity(queryVector, centroid.vector)
      if (score > bestScore) { best = centroid; bestScore = score }
    }
    if (!best || bestScore < config.dictation.routeThreshold) {
      return { intent: "general", route: null, score: bestScore, via: "below_threshold" }
    }
    return { intent: best.route.name, route: best.route, score: bestScore, via: "matched" }
  } catch (error) {
    console.error("dictation router: falling back to general:", error instanceof Error ? error.message : error)
    return { intent: "general", route: null, score: 0, via: "embedding_failed" }
  }
}

/** Test-only: clears the module-scope centroid cache so a test can change the route set or mock
 * embedTexts differently between cases. */
export function __resetRouteCentroidsForTest() {
  centroidsPromise = null
}
