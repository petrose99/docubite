"use client"

import { getDocumentProcessingStatusAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export type TrackedDocumentStatus = { status: string; errorCode: string | null; filename: string; searchable: boolean; indexing: boolean }

const TERMINAL_STATUSES = new Set(["ready_for_review", "needs_review", "reviewed", "failed"])
const POLL_MS = 2500
/** Backstop only. Whether to keep polling a settled document is now driven by the real `indexing`
 * flag (an actual queued/processing embed job, models/documents.ts::getDocumentsStatus) — this cap
 * exists only in case that flag is somehow stuck on, so a disabled or wedged embed pipeline can
 * never keep the poller alive indefinitely (~60s at POLL_MS). */
const MAX_INDEX_TICKS = 24

/** Polls processing status for the documents of the current upload batch (plus any ids
 * seeded from rows that were still queued at page load). On each transition to a terminal
 * state it toasts and refreshes the route once, so extracted rows land in the grid without
 * a manual reload. Polling pauses while the tab is hidden and stops when nothing tracked
 * is still in flight. */
export function useExtractionProgress(workspaceId: string, seedIds: string[] = [], onSettled?: (documentIds: string[]) => void, trackSearchable = false) {
  const router = useRouter()
  // Held in a ref so a caller can pass an inline closure without restarting the poller.
  const settledRef = useRef(onSettled)
  useEffect(() => { settledRef.current = onSettled }, [onSettled])
  const [statuses, setStatuses] = useState<Record<string, TrackedDocumentStatus>>({})
  const tracked = useRef(new Set<string>(seedIds))
  const lastSeen = useRef<Record<string, string>>({})
  // The last searchable/indexing flags seen per document, and how many extra ticks each has spent
  // waiting — the backstop that lets polling stop even if the real `indexing` signal gets stuck.
  const lastSearchable = useRef<Record<string, boolean>>({})
  const lastIndexing = useRef<Record<string, boolean>>({})
  const indexTicks = useRef<Record<string, number>>({})
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const polling = useRef(false)

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  const tick = useCallback(async () => {
    if (polling.current || document.visibilityState === "hidden") return
    // A document is still worth polling while extraction is in flight, or — when tracking the
    // searchable flag — for a bounded run of ticks after a terminal success while it embeds.
    const isPending = (id: string) => {
      const status = lastSeen.current[id] || ""
      if (!TERMINAL_STATUSES.has(status)) return true
      if (!trackSearchable || status === "failed" || lastSearchable.current[id]) return false
      // Real signal first — an actual queued/processing embed job. The tick cap only backstops a
      // flag that is somehow stuck true; it doesn't decide when to stop under normal operation.
      if (lastIndexing.current[id] === false) return false
      return (indexTicks.current[id] ?? 0) < MAX_INDEX_TICKS
    }
    const pending = [...tracked.current].filter(isPending)
    if (!pending.length) return stopTimer()
    polling.current = true
    try {
      const result = await getDocumentProcessingStatusAction(workspaceId, pending)
      if (!result.success || !result.data) return
      let transitioned = false
      // Documents that just finished with data to show. Failures are excluded: there is no row
      // to append for one, only the toast below.
      const settled: string[] = []
      const next: Record<string, TrackedDocumentStatus> = {}
      for (const row of result.data) {
        next[row.id] = { status: row.status, errorCode: row.errorCode, filename: row.filename, searchable: row.searchable, indexing: row.indexing }
        const wasTerminal = TERMINAL_STATUSES.has(lastSeen.current[row.id] || "")
        if (!wasTerminal && TERMINAL_STATUSES.has(row.status)) {
          transitioned = true
          if (row.status !== "failed") settled.push(row.id)
          if (row.status === "failed") toast.error(`${row.filename} failed`, { description: row.errorCode?.replaceAll("_", " ") || "Extraction failed" })
          else if (row.status === "needs_review") toast.warning(`${row.filename} extracted`, { description: "Some fields need review" })
          else toast.success(`${row.filename} extracted`)
        }
        lastSeen.current[row.id] = row.status
        // The searchable flag flips silently — no toast. Count the ticks a settled document spends
        // still un-indexed so the bounded poll above eventually gives up on it.
        lastSearchable.current[row.id] = row.searchable
        lastIndexing.current[row.id] = row.indexing
        if (trackSearchable && TERMINAL_STATUSES.has(row.status) && row.status !== "failed" && !row.searchable) {
          indexTicks.current[row.id] = (indexTicks.current[row.id] ?? 0) + 1
        }
      }
      setStatuses((previous) => ({ ...previous, ...next }))
      if (settled.length) settledRef.current?.(settled)
      // Refreshes the surrounding page data — usage meter, row counts — but not the grid
      // itself, which the settled callback has already written to in place.
      if (transitioned) router.refresh()
    } catch {
      // A dropped poll is not worth a toast; the next tick retries.
    } finally {
      polling.current = false
    }
  }, [router, workspaceId, trackSearchable])

  const track = useCallback((ids: string[]) => {
    for (const id of ids) {
      tracked.current.add(id)
      delete lastSeen.current[id]
      delete lastSearchable.current[id]
      delete lastIndexing.current[id]
      delete indexTicks.current[id]
    }
    if (ids.length && !timer.current) {
      timer.current = setInterval(() => void tick(), POLL_MS)
      void tick()
    }
  }, [tick])

  useEffect(() => {
    if (tracked.current.size && !timer.current) {
      timer.current = setInterval(() => void tick(), POLL_MS)
      void tick()
    }
    return stopTimer
  }, [tick])

  return { statuses, track }
}
