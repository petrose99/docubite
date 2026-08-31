"use client"

import { updateTranscriptAction } from "@/app/(app)/workspaces/[workspaceId]/dictation-actions"
import type { DictationDocument } from "@/components/dictation/dictation-workspace"
import { Check, Loader2, PencilLine, X } from "lucide-react"
import { useEffect, useRef, useState, type RefObject } from "react"
import { toast } from "sonner"

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

/** The audio and what the machine heard, kept together.
 *
 * The segments are clickable so a reviewer can jump to any phrase and hear it, and the segment
 * under the playhead is highlighted as it plays. That pairing is the verification: reading a
 * transcript tells you what the model decided, and only the audio tells you whether it was right.
 *
 * Editing replaces the flat transcript, not the segments. The timestamps belong to the recording
 * and stay true to it; a corrected phrase simply stops matching any of them, which is why an edited
 * field loses its audio pin rather than acquiring a false one. */
export function TranscriptPane({ workspaceId, document, audioRef, transcribing, readOnly, onSaved }: {
  workspaceId: string
  document: DictationDocument
  audioRef: RefObject<HTMLAudioElement | null>
  transcribing: boolean
  readOnly: boolean
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(document.transcript)
  const [saving, setSaving] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const activeRef = useRef<HTMLButtonElement>(null)

  // Adjusted during render rather than in an effect (the pattern React documents for "reset state
  // when a prop changes"). An effect would repaint the pane, and a `key` would remount the <audio>
  // element with it — losing the playback position at the exact moment someone has just corrected
  // a word and wants to hear that passage again.
  const [lastTranscript, setLastTranscript] = useState(document.transcript)
  if (lastTranscript !== document.transcript) {
    setLastTranscript(document.transcript)
    setText(document.transcript)
  }

  // Follow the playhead, but only while it is inside the pane's own scroll box — a page-level
  // scrollIntoView while someone is reading the fields column would yank the screen from under them.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [positionMs])

  const activeIndex = document.segments.findIndex((segment) => positionMs >= segment.startMs && positionMs < segment.endMs)
  const showSegments = document.segments.length > 0 && !document.transcriptEditedAt

  const save = async () => {
    setSaving(true)
    try {
      const result = await updateTranscriptAction(workspaceId, document.id, text)
      if (!result.success) {
        toast.error(result.error ?? "Could not save that transcript")
        return
      }
      setEditing(false)
      toast.success("Transcript saved. Fields re-read from the corrected text.")
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="flex w-[22rem] shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Recording</h2>
          {!readOnly && !transcribing && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
              <PencilLine className="h-3.5 w-3.5" />Correct
            </button>
          )}
        </div>

        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={`/api/documents/${document.id}/source`}
          onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
          className="mt-2.5 w-full" />

        <p className="mt-2 text-xs text-slate-400">
          {document.transcriptModel ? `Transcribed by ${document.transcriptModel}` : "Not transcribed yet"}
        </p>

        {/* Stated, not hidden. A report drawn from a transcript someone typed into is a different
            claim from one drawn from an untouched ASR pass, and the person signing it should be
            the one deciding whether that matters. */}
        {document.transcriptEditedAt && (
          <p className="mt-1.5 rounded-md bg-indigo-50 px-2 py-1.5 text-xs text-indigo-900">
            Transcript corrected by {document.transcriptEditedBy ?? "a member"} on{" "}
            {new Date(document.transcriptEditedAt).toLocaleString()} — it is no longer only what the microphone heard.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {transcribing && (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Transcribing the recording…</p>
        )}

        {!transcribing && editing && (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={18}
              className="w-full resize-y rounded-md border border-slate-200 p-2.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-emerald-400 focus:outline-none" />
            <p className="text-xs text-slate-500">Saving re-reads the fields from the corrected text. The audio is not changed.</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving || !text.trim()}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save and re-read
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { setText(document.transcript); setEditing(false) }}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50">
                <X className="h-3.5 w-3.5" />Cancel
              </button>
            </div>
          </div>
        )}

        {!transcribing && !editing && showSegments && (
          <ol className="space-y-0.5">
            {document.segments.map((segment, index) => (
              <li key={index}>
                <button
                  ref={index === activeIndex ? activeRef : undefined}
                  type="button"
                  onClick={() => {
                    const audio = audioRef.current
                    if (!audio) return
                    audio.currentTime = segment.startMs / 1000
                    void audio.play().catch(() => {})
                  }}
                  className={`flex w-full gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${index === activeIndex ? "bg-emerald-50 text-slate-900" : "text-slate-700 hover:bg-slate-100"}`}>
                  <span className="shrink-0 pt-0.5 text-xs tabular-nums text-slate-400">{clock(segment.startMs)}</span>
                  <span className="min-w-0">{segment.text}</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {/* A transcript with no usable timestamps still has to be readable — either because the
            backend returned none (allowed by the AsrResult contract) or because a correction has
            made the stored segments describe text that is no longer on screen. Showing the old
            segments as though they were the transcript would be the one genuinely misleading
            option, so the corrected text is shown flat instead. */}
        {!transcribing && !editing && !showSegments && (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {document.transcript || "No transcript."}
            </p>
            {document.transcriptEditedAt && !!document.segments.length && (
              <p className="mt-3 text-xs text-slate-400">
                Timestamps are hidden because the text was corrected — the stored spans still describe the original transcription, not what you see here.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
