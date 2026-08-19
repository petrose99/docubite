import config from "@/lib/config"
import type { AsrBackend, AsrResult, AsrSegment, TranscribeOptions } from "@/lib/asr/types"

/** Deepgram prerecorded transcription (https://api.deepgram.com/v1/listen).
 *
 * TODO: PHI/compliance before production — same caveat as the Hugging Face backend: dictated
 * clinical audio leaves this machine and is sent to a third-party provider. A BAA or equivalent is
 * needed before real patient audio goes through here.
 *
 * Unlike HF serverless Whisper, Deepgram:
 *  - takes raw audio bytes directly (Content-Type set to the actual mime type), not a JSON/base64
 *    envelope;
 *  - returns word-level timestamps unconditionally, and utterance-level segments when `utterances`
 *    is requested — utterances are used here because they're closer to the sentence-level spans
 *    the HF backend produces from Whisper's chunks;
 *  - supports keyword biasing natively via repeated `keywords` query params, so this backend can
 *    honestly report supportsBiasTerms = true.
 *
 * Retry/backoff mirrors the Hugging Face backend: only transport failures and transient statuses
 * are retried; 400/401/403/413 throw immediately. */

const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 500
const LISTEN_URL = "https://api.deepgram.com/v1/listen"

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

type DeepgramWord = { word?: string; punctuated_word?: string; start?: number; end?: number; confidence?: number }
type DeepgramUtterance = { transcript?: string; start?: number; end?: number; confidence?: number; words?: DeepgramWord[] }
type DeepgramResponse = {
  results?: {
    channels?: Array<{ alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }> }>
    utterances?: DeepgramUtterance[]
  }
  metadata?: { detected_language?: string }
}

/** Utterances give sentence-level spans; word-level timestamps are the fallback when the response
 * has no utterances at all (e.g. `utterances` wasn't honoured, or there was exactly one word). */
export function parseSegments(response: DeepgramResponse): AsrSegment[] {
  const utterances = response.results?.utterances
  if (Array.isArray(utterances) && utterances.length) {
    return utterances
      .map((u): AsrSegment | null => {
        const text = typeof u.transcript === "string" ? u.transcript.trim() : ""
        const start = u.start
        if (!text || typeof start !== "number" || !Number.isFinite(start)) return null
        const end = u.end
        const endMs = typeof end === "number" && Number.isFinite(end) && end >= start ? Math.round(end * 1000) : Math.round(start * 1000)
        return { startMs: Math.round(start * 1000), endMs, text }
      })
      .filter((s): s is AsrSegment => s !== null)
      .sort((a, b) => a.startMs - b.startMs)
  }

  const words = response.results?.channels?.[0]?.alternatives?.[0]?.words
  if (!Array.isArray(words)) return []
  return words
    .map((w): AsrSegment | null => {
      const text = (typeof w.punctuated_word === "string" ? w.punctuated_word : w.word)?.trim() ?? ""
      const start = w.start
      if (!text || typeof start !== "number" || !Number.isFinite(start)) return null
      const end = w.end
      const endMs = typeof end === "number" && Number.isFinite(end) && end >= start ? Math.round(end * 1000) : Math.round(start * 1000)
      return { startMs: Math.round(start * 1000), endMs, text }
    })
    .filter((s): s is AsrSegment => s !== null)
    .sort((a, b) => a.startMs - b.startMs)
}

export function parseAsrResponse(body: unknown, model: string): AsrResult {
  const response = (body ?? {}) as DeepgramResponse
  const text = (response.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim()
  return { text, segments: parseSegments(response), language: response.metadata?.detected_language ?? null, model }
}

export class DeepgramAsrBackend implements AsrBackend {
  readonly name = "deepgram"
  readonly supportsBiasTerms = true

  async transcribe(audio: Buffer, options: TranscribeOptions): Promise<AsrResult> {
    if (!config.asr.apiKey) throw new Error("asr_not_configured")
    if (!audio.length) throw new Error("asr_audio_empty")
    if (audio.length > config.asr.maxAudioBytes) throw new Error("asr_audio_too_large")

    const params = new URLSearchParams({
      model: config.asr.modelName,
      smart_format: "true",
      punctuate: "true",
      utterances: "true",
    })
    if (options.language) params.set("language", options.language)
    for (const term of options.biasTerms ?? []) params.append("keywords", term)

    const url = `${LISTEN_URL}?${params.toString()}`

    let lastError = new Error("asr_request_failed")
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let response: Response
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": options.mimeType,
            Authorization: `Token ${config.asr.apiKey}`,
          },
          // Buffer satisfies BodyInit at runtime (Node's fetch); the DOM lib's fetch typings just
          // don't know that, hence the cast.
          body: audio as unknown as BodyInit,
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
