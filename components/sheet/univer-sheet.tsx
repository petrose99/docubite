"use client"

import "@univerjs/preset-sheets-core/lib/index.css"

import type { FUniver, IWorkbookData } from "@univerjs/presets"
import { CommandType, createUniver, LifecycleStages, LocaleType, mergeLocales } from "@univerjs/presets"
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core"
import sheetsCoreEnUS from "@univerjs/preset-sheets-core/locales/en-US"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { docubiteUniverTheme } from "./univer-theme"

/** How long the grid stays quiet before a save goes out. Univer fires a command per keystroke
 * in the formula bar, so saving per command would mean one POST per character. */
const SAVE_DEBOUNCE_MS = 2000

/** How long an immediate save will wait for an in-flight debounced save to finish first. */
const SAVE_NOW_ATTEMPTS = 10
const SAVE_NOW_RETRY_MS = 300

/** Which commands mean "the workbook changed". Two filters, because either alone lets noise
 * through:
 *
 * - MUTATION is Univer's own word for a change that lands in the snapshot; an OPERATION
 *   (selection, scroll, zoom, sidebar state) never does.
 * - `sheet.` scopes it to the workbook. The cell editor and the formula bar are Univer *doc*
 *   units, so merely clicking a cell fires `doc.mutation.rich-text-editing` — a real mutation,
 *   of the editor's document rather than of the sheet. Without this, opening a file and
 *   clicking around would re-POST the entire workbook.
 *
 * Selection is the one sheet mutation that carries no cell data, so it is named explicitly. */
const isPersistedChange = (event: { id: string; type: CommandType }) =>
  event.type === CommandType.MUTATION && event.id.startsWith("sheet.mutation.") && !event.id.startsWith("sheet.mutation.set-selections")

export type SaveState = "idle" | "saving" | "saved" | "error"

export type UniverSheetProps = {
  fileId: string
  /** The stored workbook, or null for a file that has never been opened in the grid. */
  snapshot: IWorkbookData | null
  rev: number
  /** Locks the grid: cells cannot be typed into at all. */
  readOnly?: boolean
  /** Whether edits are saved back. False gives a live but throwaway grid — the "interact"
   * sharing level, where a guest may try changes on a copy that is never written back. */
  persist?: boolean
  onSaveStateChange?: (state: SaveState) => void
  /** The revision this grid last wrote, so the page can tell its own saves apart from someone
   * else's when it sees a newer revision arrive from the server. */
  onRevChange?: (rev: number) => void
  /** A revision the page knows this grid should carry on from, because the server moved ahead
   * for a reason that is not another editor — the extraction reconcile writing the same rows
   * this tab just appended. Adopting it lets the next save succeed instead of 409ing. */
  adoptRev?: number | null
  /** Handed the facade once the grid is live, for the extraction bridge and the assistant. */
  onReady?: (api: FUniver) => void
  /** Handed a "save right now, and tell me whether it worked" function.
   *
   * The debounced autosave is fine for typing, where a failure just retries on the next
   * keystroke. It is not enough for the extraction bridge, which has to know the rows reached
   * the server before it marks the documents as applied. */
  onSaveHandle?: (saveNow: () => Promise<boolean>) => void
}

/** The Univer grid itself: canvas cells, formula bar, toolbar, context menu — mounted
 * imperatively into a container div, because Univer owns its own render loop and React only
 * ever supplies the box it draws into.
 *
 * Always rendered through univer-sheet-loader.tsx: this module reaches for `window` at import
 * time and must never be pulled into the server bundle. */
export function UniverSheet({ fileId, snapshot, rev, readOnly = false, persist = true, onSaveStateChange, onRevChange, onReady, onSaveHandle, adoptRev }: UniverSheetProps) {
  const frozen = readOnly || !persist
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<FUniver | null>(null)
  const revRef = useRef(rev)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Univer runs a burst of its own commands while it boots. Counting those as edits would save
  // — and so bump the revision and the file's "last updated" — every time someone merely opens
  // the sheet, so dirty tracking only starts once the grid has settled.
  const liveRef = useRef(false)
  // Latest values without re-running the mount effect, which would tear down the whole grid.
  // "frozen" is what the save path checks: a locked grid and a throwaway one both mean no POST.
  const frozenRef = useRef(frozen)
  const stateRef = useRef(onSaveStateChange)
  const revChangeRef = useRef(onRevChange)
  useEffect(() => {
    frozenRef.current = frozen
    stateRef.current = onSaveStateChange
    revChangeRef.current = onRevChange
  }, [frozen, onSaveStateChange, onRevChange])

  const [stale, setStale] = useState(false)

  // Catching up to a revision the page vouched for. The grid keeps its own contents — they are
  // the same rows, plus anything typed since — so this only restores its right to save them.
  useEffect(() => {
    if (adoptRev === null || adoptRev === undefined || adoptRev <= revRef.current) return
    revRef.current = adoptRev
    setStale(false)
  }, [adoptRev])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Univer mounts into a host of its own rather than straight into the React-owned div. Its
    // teardown is deferred (see the cleanup below), so under StrictMode's mount-unmount-mount a
    // second instance is alive before the first has gone; separate hosts keep them from
    // dismantling each other's DOM.
    const host = document.createElement("div")
    host.style.cssText = "position:absolute;inset:0"
    container.appendChild(host)

    const { univer, univerAPI } = createUniverInstance(host)
    apiRef.current = univerAPI
    // An empty object is a valid workbook: Univer fills in one blank sheet, which is what a
    // brand-new file should open as.
    const workbook = univerAPI.createWorkbook(snapshot ?? {})
    // A read-only viewer must not be able to type into cells at all. Skipping the save alone
    // would let them edit a grid whose changes quietly evaporate on reload.
    if (readOnly) workbook.setEditable(false)
    onReady?.(univerAPI)

    const save = async (): Promise<boolean> => {
      const api = apiRef.current
      if (!api || savingRef.current || frozenRef.current) return false
      const workbook = api.getActiveWorkbook()
      if (!workbook) return false
      savingRef.current = true
      dirtyRef.current = false
      stateRef.current?.("saving")
      try {
        const response = await fetch(`/api/files/${fileId}/workbook`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rev: revRef.current, snapshot: workbook.save() }),
        })
        if (response.status === 409) {
          // Someone else's tab saved over the revision this one loaded. Continuing would
          // silently discard their work, so the grid stops saving and asks for a reload.
          setStale(true)
          stateRef.current?.("error")
          toast.error("This sheet was changed in another tab. Reload to see the latest version.")
          return false
        }
        if (!response.ok) throw new Error(String(response.status))
        const body = (await response.json()) as { rev: number }
        revRef.current = body.rev
        revChangeRef.current?.(body.rev)
        stateRef.current?.("saved")
        return true
      } catch {
        // Keep the workbook dirty so the next command retries rather than losing the edit.
        dirtyRef.current = true
        stateRef.current?.("error")
        return false
      } finally {
        savingRef.current = false
      }
    }

    /** Save now, waiting out a debounced save that is already in flight rather than reporting a
     * failure the caller cannot distinguish from a real one. */
    const saveNow = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < SAVE_NOW_ATTEMPTS; attempt += 1) {
        if (!savingRef.current) return save()
        await new Promise((resolve) => setTimeout(resolve, SAVE_NOW_RETRY_MS))
      }
      return false
    }
    onSaveHandle?.(saveNow)

    const lifecycle = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, (event) => {
      if (event.stage === LifecycleStages.Steady) liveRef.current = true
    })

    const disposable = univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
      if (!liveRef.current || frozenRef.current || !isPersistedChange(event)) return
      dirtyRef.current = true
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void save(), SAVE_DEBOUNCE_MS)
    })

    return () => {
      lifecycle.dispose()
      disposable.dispose()
      liveRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      // A pending edit would otherwise be lost on navigation: `keepalive` lets the request
      // outlive the page, and the snapshot is read before the instance is disposed.
      if (dirtyRef.current && !frozenRef.current) {
        const workbook = univerAPI.getActiveWorkbook()
        if (workbook) {
          navigator.sendBeacon?.(
            `/api/files/${fileId}/workbook`,
            new Blob([JSON.stringify({ rev: revRef.current, snapshot: workbook.save() })], { type: "application/json" }),
          )
        }
      }
      apiRef.current = null
      // Deferred: dispose() synchronously unmounts Univer's own React root, and React refuses to
      // do that from inside a cleanup that is itself running during a render (which is exactly
      // what StrictMode's double-mount does). A macrotask puts it safely outside that window.
      setTimeout(() => {
        univer.dispose()
        host.remove()
      }, 0)
    }
    // Remounting on a new snapshot would throw away in-flight edits; the workbook is seeded
    // once and every later change flows through Univer itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId])

  return (
    <div className="docubite-sheet relative min-h-0 min-w-0 flex-1">
      <div ref={containerRef} className="absolute inset-0" />
      {stale && (
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>This sheet changed elsewhere. Your recent edits here are not being saved.</span>
          <button className="rounded-md bg-amber-900 px-2 py-1 text-xs font-medium text-amber-50" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </div>
  )
}

function createUniverInstance(container: HTMLElement) {
  return createUniver({
    locale: LocaleType.EN_US,
    locales: { [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS) },
    theme: docubiteUniverTheme,
    presets: [UniverSheetsCorePreset({ container })],
  })
}
