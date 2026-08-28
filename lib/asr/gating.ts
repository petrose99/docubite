import config from "@/lib/config"

export type AsrGateWorkspace = { industry: string; hipaaMode: boolean; asrExternalAllowed: boolean }

/** Whether this workspace may use the deployment's ASR backend at all.
 *
 * `config.asr.enabled` alone answers "is a backend configured", the same question every other
 * caller of it asks. That is not enough for a healthcare, hipaaMode workspace: Whisper-via-HF and
 * Deepgram are third parties, and sending them a dictation without a signed BAA covering that
 * specific processor is a HIPAA violation regardless of how well the feature otherwise works. A
 * non-healthcare or non-hipaaMode workspace has made no such presumption, so it is unaffected —
 * this only narrows the healthcare+hipaaMode case, never widens any other one. */
export function isAsrAllowed(workspace: AsrGateWorkspace): boolean {
  if (!config.asr.enabled) return false
  if (workspace.industry !== "healthcare") return true
  if (!workspace.hipaaMode) return true
  return workspace.asrExternalAllowed
}
