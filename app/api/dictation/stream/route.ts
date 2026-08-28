import { getAsrBackend } from "@/lib/asr"
import { isAsrAllowed } from "@/lib/asr/gating"
import { SUPPORTED_AUDIO_TYPES } from "@/lib/asr/types"
import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { getWorkspaceCapabilities } from "@/lib/modules/capabilities"
import { getWorkspaceMembership } from "@/models/workspaces"

/** Interim transcription for live dictation feedback.
 *
 * ONE POST PER CHUNK, not a WebSocket. Vercel's serverless runtime cannot hold a long-lived socket
 * open, so a socket-based design would work locally and fail in production; per-chunk POSTs are the
 * shape that actually deploys.
 *
 * What comes back here is DISPLAY ONLY. It exists so the speaker can see that recording is working
 * and roughly what is being heard. It is never stored and never structured: on stop, the complete
 * audio is saved as a Document and the normal transcribe job produces the authoritative transcript
 * from the whole recording. That matters because a 2-second slice cut mid-word transcribes worse
 * than the same audio in context, and a clinical record must not be assembled from the worse one. */

/** Interim chunks are small by construction; anything larger is not a live chunk. */
const MAX_CHUNK_BYTES = 2 * 1024 * 1024

export async function POST(request: Request) {
  if (!config.asr.enabled) return Response.json({ error: "dictation_not_configured" }, { status: 503 })

  const user = await getCurrentUser()
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")
  const membership = workspaceId ? await getWorkspaceMembership(workspaceId, user.id) : null
  if (!membership) return Response.json({ error: "forbidden" }, { status: 403 })
  if (!(await getWorkspaceCapabilities(workspaceId!)).has("dictation")) return Response.json({ error: "dictation_not_configured" }, { status: 503 })
  // Distinct from the mode check above: this workspace IS healthcare, it just has no confirmed BAA
  // yet for the configured external ASR provider — see lib/asr/gating.ts.
  if (!isAsrAllowed(membership.workspace)) return Response.json({ error: "baa_required" }, { status: 403 })

  const mimeType = (request.headers.get("content-type") || "").split(";")[0].trim()
  if (!SUPPORTED_AUDIO_TYPES.has(mimeType)) return Response.json({ error: "unsupported_audio_type" }, { status: 415 })

  const audio = Buffer.from(await request.arrayBuffer())
  if (!audio.length) return Response.json({ error: "empty_chunk" }, { status: 400 })
  if (audio.length > MAX_CHUNK_BYTES) return Response.json({ error: "chunk_too_large" }, { status: 413 })

  try {
    const result = await getAsrBackend().transcribe(audio, { mimeType })
    // `interim: true` is part of the contract, so no client can mistake this for the stored
    // transcript. No quota is consumed: the authoritative pass on stop is what gets billed.
    return Response.json({ interim: true, text: result.text })
  } catch (error) {
    // A failed interim chunk costs the speaker a moment of feedback and nothing else — the full
    // recording is still transcribed on stop. Never surfaced as an error that stops recording.
    return Response.json({ interim: true, text: "", error: error instanceof Error ? error.message : "asr_failed" }, { status: 200 })
  }
}
