import config from "@/lib/config"
import { HuggingFaceAsrBackend } from "@/lib/asr/huggingface"
import type { AsrBackend } from "@/lib/asr/types"

/** Backend selection. One entry today; the switch exists so moving to a dedicated HF Inference
 * Endpoint, a different hosted ASR, or a self-hosted model (the likely answer once real PHI is
 * involved) is a config change and a new file, not a change to any caller.
 *
 * The plan named Qwen/Qwen3-ASR-1.7B-hf. It was probed against HF serverless before this code was
 * written and returns 400 "Model not supported by provider hf-inference" — no provider mapping,
 * exactly the failure that ruled out nomic-embed for embeddings. openai/whisper-large-v3-turbo is
 * live there, returns segment timestamps, and is the default. Nothing about that choice is
 * load-bearing beyond this function. */
export function getAsrBackend(): AsrBackend {
  switch (config.asr.backend) {
    case "huggingface":
    default:
      return new HuggingFaceAsrBackend()
  }
}

export { SUPPORTED_AUDIO_TYPES, isSupportedAudioBuffer } from "@/lib/asr/types"
export type { AsrBackend, AsrResult, AsrSegment, TranscribeOptions } from "@/lib/asr/types"
