"use client"

import { getCellProvenanceAction, getShapeDiffAction } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { SourcePreview, type ProvenanceTarget, type SourceDocument } from "@/components/viewer/source-preview"
import { Dialog } from "@/components/ui/dialog"
import type { RunDiff } from "@/lib/run-diff"
import { Crosshair, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

type DiffData = { shapeName: string; prevFilename: string; prevDocumentId: string; diff: RunDiff }

const show = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value))

/** The run diff for one document against the previous document of the same shape, in the same
 * pending-changes colour language the review flow uses: new fields emerald, changed amber with the
 * old value struck through, missing red. Each scalar row carries a crosshair that opens the source
 * document highlighted at that value — the current document for new/changed, the previous one for
 * what went missing, since that is where the value it is comparing against actually lives. */
export function RunDiffDialog({ workspaceId, documentId, onClose }: { workspaceId: string; documentId: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "none" | "ready" | "error">("loading")
  const [data, setData] = useState<DiffData | null>(null)
  const [source, setSource] = useState<SourceDocument | null>(null)
  const [target, setTarget] = useState<ProvenanceTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    getShapeDiffAction(workspaceId, documentId).then((result) => {
      if (cancelled) return
      if (!result.success) { setStatus("error"); return }
      if (!result.data) { setStatus("none"); return }
      setData(result.data)
      setStatus("ready")
    }).catch(() => { if (!cancelled) setStatus("error") })
    return () => { cancelled = true }
  }, [workspaceId, documentId])

  const openSource = async (targetDocumentId: string, fieldKey: string) => {
    const info = await getCellProvenanceAction(workspaceId, targetDocumentId, fieldKey, null, null).catch(() => null)
    if (!info?.success || !info.data) return
    setSource({ documentId: targetDocumentId, filename: info.data.filename, mimeType: info.data.mimeType })
    setTarget(info.data.ref ? { page: info.data.ref.page, bbox: info.data.ref.bbox, quote: info.data.ref.quote } : null)
  }

  const crosshair = (targetDocumentId: string, fieldKey: string) => (
    <button type="button" onClick={() => void openSource(targetDocumentId, fieldKey)} className="ml-auto shrink-0 rounded p-1 text-slate-400 hover:bg-white hover:text-emerald-700" title="Open source at this value"><Crosshair className="h-3.5 w-3.5" /></button>
  )

  const diff = data?.diff
  const nothing = diff && !diff.added.length && !diff.missing.length && !diff.changed.length && (!diff.items || (!diff.items.addedRows && !diff.items.removedRows && !diff.items.changedCells))

  return (
    <>
      <Dialog open title={status === "ready" && data ? `Changes vs last ${data.shapeName}` : "Run diff"} description={status === "ready" && data ? `Compared with ${data.prevFilename}` : undefined} width="max-w-lg" onClose={onClose}>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {status === "loading" && <div className="flex items-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Comparing…</div>}
          {status === "error" && <p className="text-slate-500">Could not build the diff.</p>}
          {status === "none" && <p className="text-slate-500">This is the first document of its shape — there is nothing to compare it against yet.</p>}
          {status === "ready" && diff && (
            <>
              {nothing && <p className="text-slate-500">Identical to the previous run — no fields changed.</p>}

              {diff.changed.map((change) => (
                // kept amber: diff legend uses emerald=added/red=removed/amber=changed
                <div key={`c-${change.key}`} className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1.5">
                  <span className="font-medium text-amber-900">{change.label}</span>
                  <span className="text-slate-400 line-through">{show(change.before)}</span>
                  <span className="font-semibold text-amber-900">{show(change.after)}</span>
                  {data && crosshair(documentId, change.key)}
                </div>
              ))}

              {diff.added.map((entry) => (
                <div key={`a-${entry.key}`} className="flex items-center gap-2 rounded-md bg-emerald-50 px-2.5 py-1.5">
                  <span className="font-medium text-emerald-900">{entry.label}</span>
                  <span className="rounded bg-white/70 px-1 text-emerald-800">new</span>
                  <span className="font-semibold text-emerald-900">{show(entry.after)}</span>
                  {data && crosshair(documentId, entry.key)}
                </div>
              ))}

              {diff.missing.map((entry) => (
                <div key={`m-${entry.key}`} className="flex items-center gap-2 rounded-md bg-red-50 px-2.5 py-1.5">
                  <span className="font-medium text-red-900">{entry.label}</span>
                  <span className="rounded bg-white/70 px-1 text-red-800">gone</span>
                  <span className="text-slate-500 line-through">{show(entry.before)}</span>
                  {data && crosshair(data.prevDocumentId, entry.key)}
                </div>
              ))}

              {diff.items && (diff.items.addedRows > 0 || diff.items.removedRows > 0 || diff.items.changedCells > 0) && (
                <div className="rounded-md bg-slate-100 px-2.5 py-1.5 text-slate-700">
                  Line items:{" "}
                  {[
                    diff.items.addedRows ? `+${diff.items.addedRows} row${diff.items.addedRows === 1 ? "" : "s"}` : null,
                    diff.items.removedRows ? `−${diff.items.removedRows} row${diff.items.removedRows === 1 ? "" : "s"}` : null,
                    diff.items.changedCells ? `${diff.items.changedCells} cell${diff.items.changedCells === 1 ? "" : "s"} changed` : null,
                  ].filter(Boolean).join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      </Dialog>
      {source && <SourcePreview source={source} target={target} onClose={() => { setSource(null); setTarget(null) }} />}
    </>
  )
}
