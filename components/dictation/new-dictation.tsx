"use client"

import { createDictationAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import { DictationRecorder, type DictationResult } from "@/components/dictation/dictation-recorder"
import { Loader2, Upload } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { toast } from "sonner"

/** Must stay in sync with SUPPORTED_AUDIO_TYPES (lib/asr/types.ts). */
const AUDIO_TYPES = "audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/flac"

/** Start a dictation: pick what you are dictating, then talk.
 *
 * The template is chosen BEFORE recording rather than after, because it decides the ASR domain
 * vocabulary and the fields the transcript is sorted into. Asking afterwards would mean either
 * re-running the whole pipeline on a change of mind, or quietly using the wrong one. */
export function NewDictation({ workspaceId, templates }: {
  workspaceId: string
  templates: { code: string; name: string }[]
}) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [templateCode, setTemplateCode] = useState(templates[0]?.code ?? "")
  const [saving, setSaving] = useState(false)

  const upload = async (audio: File, note: string) => {
    setSaving(true)
    try {
      const formData = new FormData()
      formData.append("audio", audio)
      formData.append("templateCode", templateCode)
      // No slashes or colons: cleanFilename runs path.basename over this, so a locale date like
      // "19/08/2026, 4:38:20 pm" is truncated to its last path segment and the report type is lost
      // from the title entirely. Formatted piecewise for that reason.
      const now = new Date()
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`
      formData.append("filename", `${templates.find((template) => template.code === templateCode)?.name ?? "Dictation"} — ${stamp}`)

      const result = await createDictationAction(workspaceId, formData)
      if (!result.success || !result.data) {
        toast.error(result.error ?? "Could not save that recording")
        return
      }
      // Straight to the verify screen. Transcription is still running; that page shows it running
      // rather than making the user watch a list and guess when to click in.
      toast.success(`${note} Transcribing…`)
      router.push(`/workspaces/${workspaceId}/dictation/${result.data.documentId}`)
    } finally {
      setSaving(false)
    }
  }

  const submit = ({ blob, mimeType, durationMs }: DictationResult) => {
    const extension = mimeType.split("/")[1]?.replace("x-", "") || "webm"
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    return upload(
      new File([blob], `dictation-${stamp}.${extension}`, { type: mimeType }),
      `Recording saved (${Math.max(1, Math.round(durationMs / 1000))}s).`,
    )
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-stone-900">New dictation</h2>
          <p className="mt-0.5 text-xs text-stone-500">Choose the report type first — it sets the vocabulary and the fields.</p>
        </div>
        <label className="flex items-center gap-2 text-xs font-medium text-stone-600">
          Report type
          <select
            value={templateCode}
            disabled={saving}
            onChange={(event) => setTemplateCode(event.target.value)}
            className="rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-900 focus:border-emerald-400 focus:outline-none disabled:opacity-50">
            {templates.map((template) => <option key={template.code} value={template.code}>{template.name}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3">
        {saving
          ? <p className="flex items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm text-stone-600">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-700" />Saving the recording…
            </p>
          : <>
              <DictationRecorder workspaceId={workspaceId} disabled={!templateCode} onComplete={submit} />
              {/* Not everything is dictated at a desk. A recording made on a handheld dictaphone or
                  a phone is the same audio taking the same transcribe job, and with audio removed
                  from the extract panel this page is now the only place it can be brought in. */}
              <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
                <span>Already have a recording?</span>
                <button
                  type="button"
                  disabled={!templateCode}
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline disabled:opacity-50">
                  <Upload className="h-3.5 w-3.5" />Upload an audio file
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={AUDIO_TYPES}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ""
                    if (file) void upload(file, `${file.name} uploaded.`)
                  }} />
              </div>
            </>}
      </div>
    </section>
  )
}
