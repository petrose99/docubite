"use client"

import { BulkActionBar } from "@/components/pipeline/bulk-action-bar"
import { highlightSnippet } from "@/components/shared/highlight-snippet"
import { LastUpdated } from "@/components/shared/relative-time"
import { useRowSelection } from "@/components/shared/use-row-selection"
import type { PipelineStage } from "@/lib/documents/stages"
import { AlertTriangle, FileText, Flag, Inbox, Loader2 } from "lucide-react"
import Link from "next/link"

export type PipelineDocumentRow = {
  id: string
  filename: string
  status: string
  receivedAt: string
  templateName: string | null
  flagged: boolean
  hasActiveJob: boolean
  missingRequiredFields: string[]
  /** Set only on the to-review stage — supplier/category/total in place of the filename, since a
   * reviewer triaging this list cares who the document is from and how much it's for, not what
   * it happened to be named on upload. */
  review: { supplier: string | null; category: string; total: string | null } | null
}

/** A document matched by content rather than by name — the pipeline's own version of the Files
 * browser's ContentMatchRow, minus the fileId/fileName/inScope fields that only make sense in a
 * folder-scoped list. */
export type ContentMatchRow = { documentId: string; filename: string; page: number | null; bbox: [number, number, number, number] | null; snippet: string }

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-500",
  failed: "bg-red-100 text-red-700",
  needs_review: "bg-indigo-100 text-indigo-700",
  ready_for_review: "bg-emerald-100 text-emerald-700",
  reviewed: "bg-emerald-100 text-emerald-700",
}

/** What each stage's empty table says, so "nothing here" reads as expected-and-fine on Archive
 * but as an invitation to upload on Inbox. */
const EMPTY_COPY: Record<PipelineStage, string> = {
  inbox: "Nothing waiting — uploaded documents land here while they're being extracted.",
  to_review: "Nothing needs a look right now.",
  ready: "Nothing marked ready yet.",
  approvals: "No documents are waiting on an approval.",
  archive: "Nothing archived.",
}

/** The shared list shell for every pipeline tab: a plain table with checkbox/flag/status columns,
 * shift-click range selection (useRowSelection), a bulk action bar that appears once anything is
 * marked, and — when a search is active and document search is configured — a "Matched inside
 * documents" section for hits the hybrid content search found that the filename match didn't.
 * Column configurability (UserListPreference) is a later refinement — this ships the fixed column
 * set every stage needs today. */
export function DocumentList({ workspaceId, stage, rows, contentMatches, query }: {
  workspaceId: string
  stage: PipelineStage
  rows: PipelineDocumentRow[]
  contentMatches: ContentMatchRow[]
  query: string
}) {
  const { marked, markRow, toggleAll, clear } = useRowSelection(rows)
  const selected = [...marked]
  // Every stage but Inbox swaps the single "Document" column for Supplier/Category/Total — a
  // document still in Inbox hasn't been extracted yet, so there's nothing to show but its name.
  // Elsewhere, whoever's looking cares who the document is from and how much it's for, not what
  // it happened to be named on upload — which shifts every colSpan below by one column.
  const isReview = stage !== "inbox"
  const columnCount = isReview ? 7 : 6

  const contentRow = (match: ContentMatchRow) => {
    const params = new URLSearchParams()
    if (match.page != null) params.set("page", String(match.page))
    if (match.bbox) params.set("bb", match.bbox.join(","))
    const hrefQuery = params.toString()
    return <tr key={`content-${match.documentId}`} className="hover:bg-slate-50">
      <td className="border-b px-2 py-2" />
      <td className="border-b px-1 py-2" />
      <td colSpan={columnCount - 2} className="border-b px-3 py-2">
        <Link href={`/workspaces/${workspaceId}/documents/${match.documentId}?stage=${stage}${hrefQuery ? `&${hrefQuery}` : ""}`} className="block">
          <span className="flex items-center gap-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="truncate font-medium text-slate-800" title={match.filename}>{match.filename}</span>
            {match.page != null && <span className="shrink-0 rounded bg-emerald-50 px-1 font-mono text-[11px] text-emerald-800">p.{match.page}</span>}
          </span>
          {match.snippet && <span className="ml-[1.375rem] mt-0.5 block line-clamp-2 text-xs text-slate-500">{highlightSnippet(match.snippet, query)}</span>}
        </Link>
      </td>
    </tr>
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    {selected.length > 0 && <BulkActionBar workspaceId={workspaceId} stage={stage} selectedIds={selected} onDone={clear} />}
    <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-white text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th className="w-10 border-b px-2 py-2"><input type="checkbox" aria-label="Select all" className="h-4 w-4 accent-emerald-600" checked={rows.length > 0 && marked.size === rows.length} onChange={toggleAll} /></th>
            <th className="w-8 border-b px-1 py-2" />
            {isReview ? <>
              <th className="border-b px-3 py-2">Supplier</th>
              <th className="border-b px-3 py-2">Category</th>
              <th className="border-b px-3 py-2">Total</th>
            </> : <>
              <th className="border-b px-3 py-2">Document</th>
              <th className="border-b px-3 py-2">Template</th>
            </>}
            <th className="border-b px-3 py-2">Status</th>
            <th className="border-b px-3 py-2">Received</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id} className={marked.has(row.id) ? "bg-emerald-50/60" : "hover:bg-slate-50"}>
            <td className="border-b px-2 py-2">
              <input type="checkbox" aria-label={`Select ${row.filename}`} className="h-4 w-4 accent-emerald-600" checked={marked.has(row.id)}
                onMouseDown={(event) => { if (event.shiftKey) event.preventDefault() }}
                onClick={(event) => { event.preventDefault(); markRow(index, event) }}
                onChange={() => {}} />
            </td>
            <td className="border-b px-1 py-2">{row.flagged && <Flag className="h-3.5 w-3.5 text-indigo-500" aria-label="Flagged" />}</td>
            {isReview && row.review ? <>
              <td className="border-b px-3 py-2">
                <Link href={`/workspaces/${workspaceId}/documents/${row.id}?stage=${stage}`} className="inline-flex items-center gap-2 font-medium text-slate-800 hover:text-emerald-800" title={row.filename}>
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">{row.review.supplier ?? "Unknown supplier"}</span>
                  {row.hasActiveJob && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" aria-label="Processing" />}
                  {row.missingRequiredFields.length > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-label="Missing required fields" />}
                </Link>
              </td>
              <td className="border-b px-3 py-2 text-slate-500">{row.review.category}</td>
              <td className="border-b px-3 py-2 text-slate-500">{row.review.total ?? "—"}</td>
            </> : <>
              <td className="border-b px-3 py-2">
                <Link href={`/workspaces/${workspaceId}/documents/${row.id}?stage=${stage}`} className="inline-flex items-center gap-2 font-medium text-slate-800 hover:text-emerald-800" title={row.filename}>
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="truncate">{row.filename}</span>
                  {row.hasActiveJob && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600" aria-label="Processing" />}
                  {row.missingRequiredFields.length > 0 && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-indigo-500" aria-label="Missing required fields" />}
                </Link>
              </td>
              <td className="border-b px-3 py-2 text-slate-500">{row.templateName ?? "—"}</td>
            </>}
            <td className="border-b px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status] ?? "bg-slate-100 text-slate-500"}`}>{row.status.replaceAll("_", " ")}</span></td>
            <td className="border-b px-3 py-2 text-slate-500"><LastUpdated iso={row.receivedAt} /></td>
          </tr>)}

          {contentMatches.length > 0 && <tr><td colSpan={columnCount} className="border-b bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Matched inside documents</td></tr>}
          {contentMatches.map(contentRow)}

          {!rows.length && !contentMatches.length && <tr><td colSpan={columnCount} className="px-4 py-16 text-center">
            <div className="mx-auto flex max-w-xs flex-col items-center gap-2 text-sm text-slate-400">
              <Inbox className="h-8 w-8 text-slate-300" />
              <p>{query ? `No documents match “${query}”.` : EMPTY_COPY[stage]}</p>
            </div>
          </td></tr>}
        </tbody>
      </table>
    </div>
  </div>
}
