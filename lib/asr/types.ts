/** The speech-to-text backend interface.
 *
 * Deliberately narrow: one method, a plain result. The whole point is that the hosted service
 * behind it is swappable — the plan named Qwen3-ASR, the probe found it has no HF provider mapping
 * (400 "Model not supported by provider hf-inference"), and Whisper took its place without any
 * caller changing, because callers only ever see this type. */

/** One timestamped span of transcript. `confidence` is optional because most hosted ASR endpoints,
 * including HF serverless Whisper, do not return a per-segment score. */
export type AsrSegment = {
  startMs: number
  endMs: number
  text: string
  confidence?: number
}

export type AsrResult = {
  /** The full transcript, retained verbatim alongside any structured output derived from it. */
  text: string
  /** Timestamped spans, in time order. Audio provenance is resolved against these, so a backend
   * that cannot produce them yields field-level citations no more precise than "somewhere in this
   * recording". Empty is allowed and degrades gracefully. */
  segments: AsrSegment[]
  language: string | null
  /** The model that produced this, recorded on the document so a later re-transcription with a
   * different model is distinguishable from the original. */
  model: string
}

export type TranscribeOptions = {
  mimeType: string
  /** Domain vocabulary to bias recognition towards (lib/domains biasTerms).
   *
   * NOT ALL BACKENDS HONOUR THIS. Qwen3-ASR takes a context-biasing list natively; HF serverless
   * Whisper exposes no biasing parameter at all, so the huggingface backend accepts these and
   * cannot apply them. They are still carried through the interface because (a) a backend that
   * supports biasing needs them and (b) the structuring step downstream uses the same list to
   * recognise and correct obvious mis-transcriptions of domain terms. */
  biasTerms?: string[]
  /** Hint for the spoken language; null lets the backend detect it. */
  language?: string | null
}

export interface AsrBackend {
  readonly name: string
  /** True when this backend can also apply `biasTerms` at recognition time, so callers can tell an
   * honest "biasing applied" from an honest "biasing unavailable". */
  readonly supportsBiasTerms: boolean
  transcribe(audio: Buffer, options: TranscribeOptions): Promise<AsrResult>
}

/** Audio types the ingestion path accepts. Kept here so the three places that must agree — the
 * upload validator, the processing dispatcher, and the browser's accept list — all read one list. */
export const SUPPORTED_AUDIO_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
])

/** Magic-byte validation for the audio types above, mirroring isSupportedDocumentBuffer: a
 * declared Content-Type is a claim by the uploader, and the container's own header is the check. */
export function isSupportedAudioBuffer(buffer: Buffer, mimeType: string): boolean {
  if (!SUPPORTED_AUDIO_TYPES.has(mimeType)) return false
  const ascii = (start: number, end: number) => buffer.subarray(start, end).toString("ascii")
  // WebM and Matroska share the EBML magic 1A 45 DF A3.
  if (mimeType === "audio/webm") return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  if (mimeType === "audio/ogg") return ascii(0, 4) === "OggS"
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
  if (mimeType === "audio/flac") return ascii(0, 4) === "fLaC"
  // MP4/M4A: an ftyp box at offset 4.
  if (mimeType === "audio/mp4") return ascii(4, 8) === "ftyp"
  // MPEG audio is either an ID3 tag or a frame sync (0xFF 0xEx/0xFx).
  if (mimeType === "audio/mpeg") return ascii(0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
  return false
}
