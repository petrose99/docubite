"use client"

import { getCellProvenanceAction, getFolderReportAction, summarizeFolderReportAction } from "@/app/(app)/workspaces/[workspaceId]/sheet-actions"
import { SourcePreview, type ProvenanceTarget, type SourceDocument } from "@/components/viewer/source-preview"
import type { FolderReport as FolderReportData } from "@/components/extract/types"
import { Dialog } from "@/components/ui/dialog"
import { normalizeStatus } from "@/lib/documents/stages"
import { Crosshair, Loader2, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

const statusDot = (status: string) => {
  const normalized = normalizeStatus(status)
  if (normalized === "failed") return "bg-red-500"
  if (normalized === "needs_review") return "bg-amber-500"
  if (normalized === "ready_for_review" || normalized === "reviewed") return "bg-emerald-500"
  return "bg-stone-300"
}

/** The folder report for one upload batch: the documents grouped by kind, the duplicates, the
 * missing months, and the per-document problems — all computed deterministically, with an opt-in
 * AI summary. A document chip or an issue's crosshair opens the source document (highlighted at the
 * offending value when there is one), reusing the same viewer the sheet uses. */
export function FolderReport({ workspaceId, fileId, uploadBatchId, onClose }: { workspaceId: string; fileId: string; uploadBatchId: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [report, setReport] = useState<FolderReportData | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [source, setSource] = useState<SourceDocument | null>(null)
  const [target, setTarget] = useState<ProvenanceTarget | null>(null)

  useEffect(() => {
    let cancelled = false
    getFolderReportAction(workspaceId, fileId, uploadBatchId).then((result) => {
      if (cancelled) return
      if (!result.success || !result.data) { setStatus("error"); return }
      setReport(result.data)
      setStatus("ready")
    }).catch(() => { if (!cancelled) setStatus("error") })
    return () => { cancelled = true }
  }, [workspaceId, fileId, uploadBatchId])

  const openDocument = (document: { id: string; filename: string; mimeType: string }) => {
    setSource({ documentId: document.id, filename: document.filename, mimeType: document.mimeType })
    setTarget(null)
  }

  const openIssue = async (documentId: string, fieldKey?: string) => {
    if (!fieldKey) {
      const group = report?.groups.flatMap((g) => g.documents).find((d) => d.id === documentId)
      if (group) openDocument(group)
      return
    }
    const info = await getCellProvenanceAction(workspaceId, documentId, fieldKey, null, null).catch(() => null)
    if (!info?.success || !info.data) { toast.error("Could not open the source"); return }
    setSource({ documentId, filename: info.data.filename, mimeType: info.data.mimeType })
    setTarget(info.data.ref ? { page: info.data.ref.page, bbox: info.data.ref.bbox, quote: info.data.ref.quote } : null)
  }

  const summarize = async () => {
    setSummarizing(true)
    try {
      const result = await summarizeFolderReportAction(workspaceId, fileId, uploadBatchId)
      if (!result.success || !result.data) { toast.error(result.error || "Could not summarize"); return }
      setSummary(result.data.summary)
    } finally { setSummarizing(false) }
  }

  return (
    <>
      <Dialog open title="Folder report" description={report ? `${report.total} document${report.total === 1 ? "" : "s"}, ${report.settled} processed` : undefined} width="max-w-2xl" onClose={onClose}>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {status === "loading" && <div className="flex items-center gap-2 text-stone-500"><Loader2 className="h-4 w-4 animate-spin" />Building report…</div>}
          {status === "error" && <p className="text-stone-500">Could not build the report.</p>}
          {status === "ready" && report && (
            <>
              <div className="flex items-start gap-2 rounded-md bg-emerald-50 p-2.5">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  {summary ? <p className="text-emerald-900">{summary}</p> : <p className="text-emerald-800">Get a one-line AI summary of what this folder contains and what needs attention.</p>}
                  {!summary && <button type="button" onClick={() => void summarize()} disabled={summarizing} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-50">{summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}Summarize with AI</button>}
                </div>
              </div>

              <section>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">Groups</h3>
                <div className="space-y-2">
                  {report.groups.map((group) => (
                    <div key={group.key} className="rounded-md border border-stone-200 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-stone-800">{group.docType || "Unlabelled"}{group.entity ? ` · ${group.entity}` : ""}</span>
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">{group.count}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {group.documents.map((document) => (
                          <button key={document.id} type="button" onClick={() => openDocument(document)} className="inline-flex items-center gap-1.5 rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-700 hover:border-emerald-300 hover:bg-emerald-50" title="Open source">
                            <span className={`h-1.5 w-1.5 rounded-full ${statusDot(document.status)}`} />
                            <span className="max-w-[10rem] truncate">{document.filename}</span>
                          </button>
                        ))}
                      </div>
                      {group.gaps.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {group.gaps.map((gap) => <span key={gap} className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{gap} missing</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {report.duplicates.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">Duplicates</h3>
                  <div className="space-y-1">
                    {report.duplicates.map((pair, index) => (
                      <div key={`${pair.a}-${pair.b}-${index}`} className="flex items-center gap-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-900">
                        <span className="max-w-[12rem] truncate">{pair.aFilename}</span>
                        <span className="text-amber-500">·</span>
                        <span className="max-w-[12rem] truncate">{pair.bFilename}</span>
                        <span className="ml-auto rounded bg-white/70 px-1.5 py-0.5 text-xs font-medium">{pair.kind === "exact" ? "exact copy" : `${Math.round(pair.score * 100)}% similar`}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {report.issues.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-stone-500">Needs attention</h3>
                  <div className="space-y-1">
                    {report.issues.map((issue, index) => (
                      <div key={`${issue.documentId}-${index}`} className="flex items-center gap-2 rounded-md bg-red-50 px-2.5 py-1.5 text-red-900">
                        <span className="min-w-0 flex-1 truncate">{issue.message}</span>
                        <button type="button" onClick={() => void openIssue(issue.documentId, issue.fieldKey)} className="shrink-0 rounded p-1 text-red-400 hover:bg-white hover:text-red-700" title="Open source"><Crosshair className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </Dialog>
      {source && <SourcePreview source={source} target={target} onClose={() => { setSource(null); setTarget(null) }} />}
    </>
  )
}
