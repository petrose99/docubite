"use client"

import { Mic, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

/** Live dictation recorder.
 *
 * Records with MediaRecorder on a ~2s timeslice. Each slice is POSTed for an interim transcript
 * shown on screen, and every slice is ALSO kept locally; on stop the kept slices are reassembled
 * into the complete recording and handed to the caller for upload.
 *
 * The interim text is display only and is deliberately discarded on stop. What gets stored is the
 * full audio, transcribed in one pass by the transcribe job — a slice cut mid-word transcribes
 * worse than the same audio in context, and the clinical record must come from the better pass. */

const TIMESLICE_MS = 2000

/** Preference order for the recording container: Opus in WebM where available (every Chromium
 * browser), falling back to what Safari actually supports. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export type DictationResult = { blob: Blob; mimeType: string; durationMs: number }

export function DictationRecorder({ workspaceId, onComplete, disabled }: {
  workspaceId: string
  /** Called with the complete recording when the user stops. */
  onComplete: (result: DictationResult) => void | Promise<void>
  disabled?: boolean
}) {
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState("")
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)

  /** Releases the microphone. Called on stop AND on unmount — a recorder left running because the
   * panel closed would keep the browser's recording indicator lit indefinitely. */
  const teardown = useCallback(() => {
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => teardown(), [teardown])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250)
    return () => clearInterval(timer)
  }, [recording])

  /** Posts one slice for interim feedback. Fire-and-forget: a failed interim chunk must never
   * interrupt recording, because the audio itself is safe locally either way. */
  const postInterim = useCallback(async (chunk: Blob, mimeType: string) => {
    try {
      const response = await fetch(`/api/dictation/stream?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": mimeType.split(";")[0] },
        body: chunk,
      })
      if (!response.ok) return
      const body = (await response.json()) as { text?: string }
      if (body.text) setInterim((previous) => `${previous} ${body.text}`.trim().slice(-600))
    } catch {
      /* interim only — ignore */
    }
  }, [workspaceId])

  const start = useCallback(async () => {
    setError(null)
    const mimeType = pickMimeType()
    if (!mimeType) { setError("This browser cannot record audio."); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current = []
      startedAtRef.current = Date.now()
      setInterim("")
      setElapsedMs(0)

      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        // Kept for the authoritative pass, AND sent for interim display.
        chunksRef.current.push(event.data)
        void postInterim(event.data, mimeType)
      }
      recorder.start(TIMESLICE_MS)
      setRecording(true)
    } catch {
      setError("Microphone access was refused.")
      teardown()
    }
  }, [postInterim, teardown])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorder.onstop = () => {
      const mimeType = recorder.mimeType.split(";")[0]
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const durationMs = Date.now() - startedAtRef.current
      teardown()
      setRecording(false)
      if (blob.size) void onComplete({ blob, mimeType, durationMs })
    }
    recorder.stop()
  }, [onComplete, teardown])

  const seconds = Math.floor(elapsedMs / 1000)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={recording ? stop : start}
          className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-white disabled:opacity-50 ${recording ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
        >
          {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
          {recording ? "Stop and transcribe" : "Dictate"}
        </button>
        {recording && <span className="flex items-center gap-2 text-sm tabular-nums text-stone-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{clock}</span>}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {recording && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-400">Live preview — not saved</p>
          <p className="mt-1 max-h-24 overflow-y-auto text-sm text-stone-500">{interim || "Listening…"}</p>
          <p className="mt-2 text-xs text-stone-400">
            The full recording is transcribed again when you stop; this preview is only to confirm the microphone is working.
          </p>
        </div>
      )}

      {/* Says what actually happened, not what sounds reassuring. Stopping hands the audio to the
          staged-file list; nothing is transcribed until Extract is pressed, and a spinner claiming
          otherwise would have the user waiting for work that was never started. */}
      {!recording && !!elapsedMs && (
        <p className="mt-2 text-sm text-stone-500">
          Recording added below ({Math.max(1, Math.round(elapsedMs / 1000))}s). Press <span className="font-medium text-stone-700">Extract</span> to transcribe it.
        </p>
      )}
    </div>
  )
}
