"use client"

import { Mic, Square } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

/** Live dictation recorder.
 *
 * Records with MediaRecorder on a ~2s timeslice. `chunksRef` is the authoritative buffer: on stop,
 * every kept slice is reassembled into the complete recording and handed to the caller for upload.
 *
 * The interim preview reuses those same slices but cannot just POST each one on its own: only the
 * FIRST slice of a WebM recording carries the container header, so slices 2..N are headerless
 * clusters a decoder can't read standalone. Each interim window instead resends the header slice
 * plus every cluster gathered since the last send — a small, self-contained, decodable WebM — on a
 * throttled, single-in-flight cadence so a slow/cold ASR backend can't pile up overlapping requests.
 *
 * The interim text is display only and is deliberately discarded on stop. What gets stored is the
 * full audio, transcribed in one pass by the transcribe job — a slice cut mid-word transcribes
 * worse than the same audio in context, and the clinical record must come from the better pass. */

const TIMESLICE_MS = 2000
/** Batch this many timeslices per interim send (~4-6s of audio) — fewer, larger ASR calls than
 * sending every 2s slice individually, and more context per window for the transcriber. */
const SLICES_PER_INTERIM = 2

/** Preference order for the recording container: Opus in WebM where available (every Chromium
 * browser), falling back to what Safari actually supports. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]

function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

export type DictationResult = { blob: Blob; mimeType: string; durationMs: number }

/** Must match MAX_AUDIO_BYTES in dictation-actions.ts — the server's authoritative cap. Recording
 * up to it locally and then having the upload rejected would throw away the whole take, so the
 * recorder auto-stops (and saves what it has) before ever reaching the server's limit. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024
const WARN_AT_BYTES = MAX_AUDIO_BYTES * 0.9

/** Number of bars in the live waveform, matching the canvas's `wave` control. */
const WAVE_BAR_COUNT = 28

export function DictationRecorder({ workspaceId, onComplete, disabled }: {
  workspaceId: string
  /** Called with the complete recording when the user stops. */
  onComplete: (result: DictationResult) => void | Promise<void>
  disabled?: boolean
}) {
  const [recording, setRecording] = useState(false)
  const [interim, setInterim] = useState("")
  const [elapsedMs, setElapsedMs] = useState(0)
  const [nearingLimit, setNearingLimit] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [levels, setLevels] = useState<number[]>(() => new Array(WAVE_BAR_COUNT).fill(0))

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const headerRef = useRef<Blob | null>(null)
  const lastSentIndexRef = useRef(0)
  const busyRef = useRef(false)
  const bytesRef = useRef(0)
  const startedAtRef = useRef(0)
  // ondataavailable is registered once per `start()` call and closes over whichever `stop` existed
  // at that point; a ref lets the auto-stop-at-cap path always call the CURRENT `stop` without
  // re-registering the handler.
  const stopRef = useRef<() => void>(() => {})

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)

  /** Stops the waveform's animation loop and releases the analyser's AudioContext. Does not touch
   * the MediaStream — that's `teardown`'s job — so the two can be called independently if the
   * visualizer ever needs to outlive the mic (it currently doesn't). */
  const stopVisualizer = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    void audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    setLevels(new Array(WAVE_BAR_COUNT).fill(0))
  }, [])

  /** Releases the microphone. Called on stop AND on unmount — a recorder left running because the
   * panel closed would keep the browser's recording indicator lit indefinitely. */
  const teardown = useCallback(() => {
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    stopVisualizer()
  }, [stopVisualizer])

  useEffect(() => () => teardown(), [teardown])

  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250)
    return () => clearInterval(timer)
  }, [recording])

  /** Sends every cluster gathered since the last send, prefixed with the header slice, as one
   * self-contained WebM window. Single-in-flight by construction (only called when !busyRef.current)
   * so a slow/cold ASR backend skips ticks rather than queueing overlapping requests — cost stays
   * bounded to roughly one small transcription per window, and words can never back up. */
  const sendInterimWindow = useCallback(async (mimeType: string) => {
    const header = headerRef.current
    const pending = chunksRef.current.slice(lastSentIndexRef.current)
    if (!header || !pending.length) return
    busyRef.current = true
    const sentUpTo = chunksRef.current.length
    try {
      const windowBlob = new Blob([header, ...pending], { type: mimeType })
      const response = await fetch(`/api/dictation/stream?workspaceId=${encodeURIComponent(workspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": mimeType.split(";")[0] },
        body: windowBlob,
      })
      if (!response.ok) return
      const body = (await response.json()) as { text?: string }
      if (body.text) setInterim((previous) => `${previous} ${body.text}`.trim().slice(-600))
      // Only advance past clusters that were actually sent — a failure leaves them for the next
      // window's retry instead of silently dropping that stretch of audio from the preview.
      lastSentIndexRef.current = sentUpTo
    } catch {
      /* interim only — ignore, retry next window */
    } finally {
      busyRef.current = false
    }
  }, [workspaceId])

  /** Wires an AnalyserNode to the same MediaStream already captured for recording, then drives
   * `levels` off it via rAF while recording. Not connected to `audioContext.destination` — this is
   * visualization only, never monitoring/echo. Safari needs the `webkitAudioContext` fallback; if
   * neither constructor exists, the visualizer is skipped and the text-only preview still works. */
  const startVisualizer = useCallback((stream: MediaStream) => {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    try {
      const audioContext = new Ctor()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      audioContext.createMediaStreamSource(stream).connect(analyser)
      audioContextRef.current = audioContext
      analyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        const currentAnalyser = analyserRef.current
        if (!currentAnalyser) return
        currentAnalyser.getByteFrequencyData(data)
        const bars = new Array(WAVE_BAR_COUNT)
        for (let i = 0; i < WAVE_BAR_COUNT; i++) {
          bars[i] = data[Math.floor((i / WAVE_BAR_COUNT) * data.length)] / 255
        }
        setLevels(bars)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch {
      /* visualizer is non-essential — the text-only interim preview still works without it */
    }
  }, [])

  const start = useCallback(async () => {
    setError(null)
    const mimeType = pickMimeType()
    if (!mimeType) { setError("This browser can't record audio."); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      startVisualizer(stream)
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current = []
      headerRef.current = null
      lastSentIndexRef.current = 0
      busyRef.current = false
      bytesRef.current = 0
      startedAtRef.current = Date.now()
      setInterim("")
      setElapsedMs(0)
      setNearingLimit(false)

      let sliceCount = 0
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        // Kept for the authoritative pass.
        chunksRef.current.push(event.data)
        if (!headerRef.current) headerRef.current = event.data
        bytesRef.current += event.data.size
        sliceCount += 1

        if (bytesRef.current >= MAX_AUDIO_BYTES) {
          // Auto-stop and save rather than let the upload get rejected server-side and lose the
          // whole take.
          stopRef.current?.()
          return
        }
        setNearingLimit(bytesRef.current >= WARN_AT_BYTES)

        if (sliceCount % SLICES_PER_INTERIM === 0 && !busyRef.current) {
          void sendInterimWindow(mimeType)
        }
      }
      recorder.start(TIMESLICE_MS)
      setRecording(true)
    } catch (caught) {
      const name = caught instanceof Error ? caught.name : ""
      if (name === "NotAllowedError" || name === "PermissionDeniedError") setError("Microphone access was denied. Allow it in your browser's site settings and try again.")
      else if (name === "NotFoundError" || name === "DevicesNotFoundError") setError("No microphone was found on this device.")
      else if (!navigator.mediaDevices) setError("This browser can't record audio.")
      else setError("Could not access the microphone.")
      teardown()
    }
  }, [sendInterimWindow, teardown, startVisualizer])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorder.onstop = () => {
      const mimeType = recorder.mimeType.split(";")[0]
      const blob = new Blob(chunksRef.current, { type: mimeType })
      const durationMs = Date.now() - startedAtRef.current
      teardown()
      setRecording(false)
      setNearingLimit(false)
      if (blob.size) void onComplete({ blob, mimeType, durationMs })
    }
    recorder.stop()
  }, [onComplete, teardown])

  useEffect(() => { stopRef.current = stop }, [stop])

  const seconds = Math.floor(elapsedMs / 1000)
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <div className="rounded-lg border border-slate-200 p-3">
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
        {recording && <span className="flex items-center gap-2 text-sm tabular-nums text-slate-600"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />{clock}</span>}
        {recording && <WaveBars levels={levels} />}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {recording && nearingLimit && (
        <p className="mt-2 text-sm text-indigo-600">Approaching the maximum recording length — this will stop and save automatically soon.</p>
      )}

      {recording && (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Live preview — not saved</p>
          <p className="mt-1 max-h-24 overflow-y-auto text-sm text-slate-500">{interim || "Listening…"}</p>
          <p className="mt-2 text-xs text-slate-400">
            The full recording is transcribed again when you stop; this preview is only to confirm the microphone is working.
          </p>
        </div>
      )}

      {/* Says what actually happened, not what sounds reassuring: stopping hands the complete
          recording to onComplete, and what happens next is the caller's business, not a claim this
          component is in a position to make. */}
      {!recording && !!elapsedMs && (
        <p className="mt-2 text-sm text-slate-500">Recorded {Math.max(1, Math.round(elapsedMs / 1000))}s.</p>
      )}
    </div>
  )
}

/** Fixed set of bars driven by live analyser amplitude. Idle bars sit at a low slate height;
 * active bars scale with amplitude in emerald — purely decorative, never blocks the text preview. */
function WaveBars({ levels }: { levels: number[] }) {
  return (
    <div className="flex h-6 flex-1 items-center gap-[3px]" aria-hidden="true">
      {levels.map((level, index) => (
        <span
          key={index}
          className="w-[3px] flex-1 rounded-full bg-slate-300 transition-[height] duration-75"
          style={{
            height: `${Math.max(15, level * 100)}%`,
            backgroundColor: level > 0.08 ? "#10B981" : undefined,
          }}
        />
      ))}
    </div>
  )
}
