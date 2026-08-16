"use client"

import { getDocumentProcessingStatusAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

export type TrackedDocumentStatus = { status: string; errorCode: string | null; filename: string }

const TERMINAL_STATUSES = new Set(["ready_for_review", "needs_review", "reviewed", "failed"])
const POLL_MS = 2500

/** Polls processing status for the documents of the current upload batch (plus any ids
 * seeded from rows that were still queued at page load). On each transition to a terminal
 * state it toasts and refreshes the route once, so extracted rows land in the grid without
 * a manual reload. Polling pauses while the tab is hidden and stops when nothing tracked
 * is still in flight. */
export function useExtractionProgress(workspaceId: string, seedIds: string[] = [], onSettled?: (documentIds: string[]) => void) {
  const router = useRouter()
  // Held in a ref so a caller can pass an inline closure without restarting the poller.
  const settledRef = useRef(onSettled)
  useEffect(() => { settledRef.current = onSettled }, [onSettled])
  const [statuses, setStatuses] = useState<Record<string, TrackedDocumentStatus>>({})
  const tracked = useRef(new Set<string>(seedIds))
  const lastSeen = useRef<Record<string, string>>({})
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const polling = useRef(false)

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  const tick = useCallback(async () => {
    if (polling.current || document.visibilityState === "hidden") return
    const pending = [...tracked.current].filter((id) => !TERMINAL_STATUSES.has(lastSeen.current[id] || ""))
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
        next[row.id] = { status: row.status, errorCode: row.errorCode, filename: row.filename }
        const wasTerminal = TERMINAL_STATUSES.has(lastSeen.current[row.id] || "")
        if (!wasTerminal && TERMINAL_STATUSES.has(row.status)) {
          transitioned = true
          if (row.status !== "failed") settled.push(row.id)
          if (row.status === "failed") toast.error(`${row.filename} failed`, { description: row.errorCode?.replaceAll("_", " ") || "Extraction failed" })
          else if (row.status === "needs_review") toast.warning(`${row.filename} extracted`, { description: "Some fields need review" })
          else toast.success(`${row.filename} extracted`)
        }
        lastSeen.current[row.id] = row.status
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
  }, [router, workspaceId])

  const track = useCallback((ids: string[]) => {
    for (const id of ids) {
      tracked.current.add(id)
      delete lastSeen.current[id]
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
