import config from "@/lib/config"
import { HuggingFaceAsrBackend } from "@/lib/asr/huggingface"
import { DeepgramAsrBackend } from "@/lib/asr/deepgram"
import type { AsrBackend } from "@/lib/asr/types"

/** Backend selection. The switch exists so moving between hosted ASR providers, or to a
 * self-hosted model (the likely answer once real PHI is involved), is a config change and a new
 * file, not a change to any caller.
 *
 * The plan named Qwen/Qwen3-ASR-1.7B-hf. It was probed against HF serverless before this code was
 * written and returns 400 "Model not supported by provider hf-inference" — no provider mapping,
 * exactly the failure that ruled out nomic-embed for embeddings. openai/whisper-large-v3-turbo is
 * live there and returns segment timestamps, but exposes no biasing parameter. Deepgram supports
 * keyword biasing natively (lib/asr/deepgram.ts) — set ASR_BACKEND=deepgram and ASR_API_KEY to use
 * it instead. */
export function getAsrBackend(): AsrBackend {
  switch (config.asr.backend) {
    case "deepgram":
      return new DeepgramAsrBackend()
    case "huggingface":
    default:
      return new HuggingFaceAsrBackend()
  }
}

export { SUPPORTED_AUDIO_TYPES, isSupportedAudioBuffer } from "@/lib/asr/types"
export type { AsrBackend, AsrResult, AsrSegment, TranscribeOptions } from "@/lib/asr/types"
