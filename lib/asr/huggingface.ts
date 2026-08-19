import config from "@/lib/config"
import type { AsrBackend, AsrResult, AsrSegment, TranscribeOptions } from "@/lib/asr/types"

/** Hugging Face serverless ASR.
 *
 * TODO: PHI/compliance before production. Dictated clinical audio leaves this machine and is sent
 * to a third-party inference provider. That is already true of document text (MinerU, Gemini,
 * Hugging Face embeddings), but audio of a clinician describing a named patient is a materially
 * different disclosure. Before any real patient data goes through here: a BAA or equivalent with
 * the provider, or a self-hosted backend behind this same interface.
 *
 * Request shape, established by probing the live endpoint rather than from documentation:
 *   POST {base}/models/{model}  Content-Type: application/json
 *   {"inputs": "<base64 audio>", "parameters": {"return_timestamps": true}}
 *   -> {"text": "...", "chunks": [{"timestamp": [start, end], "text": "..."}]}
 *
 * The JSON body form is used rather than posting raw audio bytes because only it can carry
 * `parameters`, and `return_timestamps` is what makes audio provenance possible at all.
 *
 * Retry/backoff mirrors lib/embeddings.embedBatch: only transport failures and transient statuses
 * are retried; a 400/401/403 throws immediately so the job fails fast instead of burning attempts. */

const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 500

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function backoffMs(attempt: number) {
  return RETRY_BASE_MS * 2 ** (attempt - 1) + Math.floor(Math.random() * RETRY_BASE_MS)
}

function permanentHttpCode(status: number): string | null {
  if (status === 400) return "asr_bad_request"
  if (status === 401 || status === 403) return "asr_auth_failed"
  if (status === 413) return "asr_audio_too_large"
  return null
}

type HuggingFaceAsrResponse = {
  text?: string
  chunks?: Array<{ text?: string; timestamp?: [number | null, number | null] }>
}

/** Reads HF's `chunks` into ordered segments.
 *
 * Tolerant by design: word-level timestamps come back with a null end on the final chunk, and a
 * segment with no usable start is dropped rather than stored at 0 — a wrong timestamp would point
 * an audio citation at the wrong moment, which is worse than having no citation. */
export function parseSegments(chunks: HuggingFaceAsrResponse["chunks"]): AsrSegment[] {
  if (!Array.isArray(chunks)) return []
  const segments: AsrSegment[] = []
  for (const chunk of chunks) {
    const text = typeof chunk?.text === "string" ? chunk.text.trim() : ""
    const start = chunk?.timestamp?.[0]
    const end = chunk?.timestamp?.[1]
    if (!text || typeof start !== "number" || !Number.isFinite(start)) continue
    // A null/absent end (the last chunk of a word-level response) becomes a zero-length span at the
    // start time: the position is real, the duration simply is not known.
    const endMs = typeof end === "number" && Number.isFinite(end) && end >= start ? Math.round(end * 1000) : Math.round(start * 1000)
    segments.push({ startMs: Math.round(start * 1000), endMs, text })
  }
  return segments.sort((a, b) => a.startMs - b.startMs)
}

/** Falls back to one segment spanning the whole recording when the endpoint returned no chunks, so
 * downstream code always has at least a coarse anchor rather than an empty list. */
export function parseAsrResponse(body: unknown, model: string): AsrResult {
  const response = (body ?? {}) as HuggingFaceAsrResponse
  const text = typeof response.text === "string" ? response.text.trim() : ""
  return { text, segments: parseSegments(response.chunks), language: null, model }
}

export class HuggingFaceAsrBackend implements AsrBackend {
  readonly name = "huggingface"
  /** Whisper on HF serverless exposes no biasing or initial-prompt parameter. Reported honestly so
   * callers do not claim the domain vocabulary was applied at recognition time when it was not. */
  readonly supportsBiasTerms = false

  async transcribe(audio: Buffer, options: TranscribeOptions): Promise<AsrResult> {
    if (!config.asr.baseUrl) throw new Error("asr_not_configured")
    if (!audio.length) throw new Error("asr_audio_empty")
    if (audio.length > config.asr.maxAudioBytes) throw new Error("asr_audio_too_large")

    const url = `${config.asr.baseUrl}/models/${config.asr.modelName}`
    // The language hint goes in `generate_kwargs`, NOT alongside return_timestamps. Passing it at
    // the top of `parameters` is rejected outright:
    //   400 "AutomaticSpeechRecognitionPipeline._sanitize_parameters() got an unexpected keyword
    //        argument 'language'"
    // `task: "transcribe"` pins it to transcription; without it Whisper may translate non-English
    // speech into English, silently changing the words a clinical record is built from.
    const body = JSON.stringify({
      inputs: audio.toString("base64"),
      parameters: {
        return_timestamps: true,
        ...(options.language ? { generate_kwargs: { language: options.language, task: "transcribe" } } : {}),
      },
    })

    let lastError = new Error("asr_request_failed")
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(config.asr.apiKey ? { Authorization: `Bearer ${config.asr.apiKey}` } : {}),
          },
          body,
          signal: AbortSignal.timeout(config.asr.timeoutMs),
        })
      } catch {
        lastError = new Error("asr_request_failed")
        if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt))
        continue
      }
      if (!response.ok) {
        const permanent = permanentHttpCode(response.status)
        if (permanent) throw new Error(permanent)
        // 503 while a serverless model cold-starts is transient — retried here, and ultimately by
        // the transcribe job's own backoff if the model is still warming.
        lastError = new Error(`asr_http_${response.status}`)
        if (attempt < MAX_ATTEMPTS) await sleep(backoffMs(attempt))
        continue
      }
      const result = parseAsrResponse(await response.json(), config.asr.modelName)
      if (!result.text) throw new Error("asr_empty_transcript")
      return result
    }
    throw lastError
  }
}
