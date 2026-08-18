import config from "@/lib/config"

/** nomic-embed-text is trained with an asymmetric task prefix: the stored document text and the
 * query that retrieves it must be embedded under different prefixes or recall collapses. These are
 * applied here and never stored, so the same raw text always hashes the same way. */
const TASK_PREFIX = { document: "search_document: ", query: "search_query: " } as const

/** One request is tried this many times before giving up. Only transport failures and transient
 * HTTP statuses (408/429/5xx) are retried; a bad request or auth failure throws on the first. */
const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Exponential backoff with jitter, so a fleet of workers retrying a rate-limited endpoint does
 * not all come back in lockstep. */
function backoffMs(attempt: number) {
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * RETRY_BASE_MS)
}

/** HTTP statuses that will fail identically on every retry, mapped to the permanent error code the
 * embed job records. Everything else (408, 429, 5xx, transport errors) is left retryable. */
function permanentHttpCode(status: number): string | null {
  if (status === 400) return "embeddings_bad_request"
  if (status === 401 || status === 403) return "embeddings_auth_failed"
  return null
}

type OpenAiResponse = { data?: Array<{ index?: number; embedding?: number[] }> }

/** The URL and JSON body for one batch, in the shape the configured endpoint expects.
 *
 * - openai: `POST {base}/embeddings` with `{model, input}` (Ollama, HF TEI Inference Endpoints,
 *   most hosted providers).
 * - huggingface: `POST {base}/models/{model}/pipeline/feature-extraction` with `{inputs}` — HF's
 *   serverless Inference API. `normalize` is requested so the vectors are unit length. The nomic
 *   task prefix is already on each input, so HF's `prompt_name` is deliberately NOT used (it would
 *   double-prefix). */
function buildRequest(inputs: string[]): { url: string; body: string } {
  if (config.embeddings.format === "huggingface") {
    return {
      url: `${config.embeddings.baseUrl}/models/${config.embeddings.modelName}/pipeline/feature-extraction`,
      body: JSON.stringify({ inputs, normalize: true }),
    }
  }
  return {
    url: `${config.embeddings.baseUrl}/embeddings`,
    body: JSON.stringify({ model: config.embeddings.modelName, input: inputs }),
  }
}

/** Extracts the vectors, in input order, from whichever response shape the endpoint returned.
 * - openai: `{data: [{index, embedding}]}` — sorted by `index` so a provider that reorders cannot
 *   pair a vector with the wrong text.
 * - huggingface: a bare array of embeddings, already in input order. A single-input request can
 *   come back as one flat vector, which is wrapped so the caller always sees an array of vectors. */
function parseVectors(payload: unknown, count: number): unknown[] {
  if (config.embeddings.format === "huggingface") {
    const rows = Array.isArray(payload) ? payload : []
    if (count === 1 && rows.length > 0 && typeof rows[0] === "number") return [rows]
    return rows
  }
  const data = Array.isArray((payload as OpenAiResponse).data) ? (payload as OpenAiResponse).data! : []
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((row) => row.embedding)
}

/** Embeds one batch against the configured endpoint. Retries only what a retry could fix; a
 * dimension/count mismatch or a permanent HTTP status throws at once so the caller never stores a
 * vector that does not line up with its text or with the pgvector column. */
async function embedBatch(inputs: string[]): Promise<number[][]> {
  if (!config.embeddings.baseUrl) throw new Error("embeddings_not_configured")
  const request = buildRequest(inputs)
  let lastError = new Error("embeddings_request_failed")
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response
    try {
      response = await fetch(request.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Ollama needs no key; a hosted provider (and Hugging Face) does. Sent only when set so a
          // keyless local endpoint is not handed an empty bearer token.
          ...(config.embeddings.apiKey ? { Authorization: `Bearer ${config.embeddings.apiKey}` } : {}),
        },
        body: request.body,
        signal: AbortSignal.timeout(config.embeddings.timeoutMs),
      })
    } catch {
      // Network error or timeout — transient.
      lastError = new Error("embeddings_request_failed")
      if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt))
      continue
    }
    if (!response.ok) {
      const permanent = permanentHttpCode(response.status)
      if (permanent) throw new Error(permanent)
      // HF returns 503 while a serverless model cold-starts; that is transient and retried here,
      // and ultimately by the embed job's own backoff if the model is still warming.
      lastError = new Error(`embeddings_http_${response.status}`)
      if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt))
      continue
    }
    const ordered = parseVectors(await response.json(), inputs.length)
    if (ordered.length !== inputs.length || ordered.some((vec) => !Array.isArray(vec) || vec.length !== config.embeddings.dimensions)) {
      throw new Error("embedding_dims_mismatch")
    }
    return ordered as number[][]
  }
  throw lastError
}

/** Embeds a list of texts, applying nomic's task prefix for the given kind and batching by the
 * configured batch size. Returns one vector per input, in input order. */
export async function embedTexts(inputs: string[], kind: "document" | "query"): Promise<number[][]> {
  if (!inputs.length) return []
  const prefix = TASK_PREFIX[kind]
  const prefixed = inputs.map((text) => `${prefix}${text}`)
  const size = Math.max(1, config.embeddings.batchSize)
  const vectors: number[][] = []
  for (let start = 0; start < prefixed.length; start += size) {
    vectors.push(...(await embedBatch(prefixed.slice(start, start + size))))
  }
  return vectors
}

/** Formats a vector as the `[0.1,0.2,...]` literal pgvector accepts for a `::vector` bind. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`
}
