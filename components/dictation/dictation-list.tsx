"use client"

import { getDocumentProcessingStatusAction } from "@/app/(app)/workspaces/[workspaceId]/actions"
import { CheckCircle2, ChevronRight, FileText, Loader2, Mic, PencilLine, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

export type DictationRow = {
  id: string
  filename: string
  status: string
  errorCode: string | null
  receivedAt: string
  transcriptEdited: boolean
  templateName: string
  summary: string | null
  draft: { version: number; status: string; signedAt: string | null } | null
}

/** How far along a dictation is, as one badge.
 *
 * "Signed" is the only terminal state and is styled as such. Everything else is deliberately
 * neutral rather than reassuring — a transcribed case that nobody has read is not "done", and a
 * green tick against it would say otherwise. */
function StatusBadge({ row }: { row: DictationRow }) {
  if (row.draft?.status === "signed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"><CheckCircle2 className="h-3 w-3" />Signed</span>
  }
  if (row.status === "failed") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><TriangleAlert className="h-3 w-3" />{row.errorCode?.replaceAll("_", " ") ?? "Failed"}</span>
  }
  if (row.status === "queued" || row.status === "processing") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600"><Loader2 className="h-3 w-3 animate-spin" />Transcribing</span>
  }
  if (row.draft) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"><FileText className="h-3 w-3" />Draft v{row.draft.version} — unsigned</span>
  }
  if (row.status === "needs_review") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"><TriangleAlert className="h-3 w-3" />Fields missing</span>
  }
  return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Awaiting review</span>
}

const IN_FLIGHT = new Set(["queued", "processing"])

export function DictationList({ workspaceId, dictations }: { workspaceId: string; dictations: DictationRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(dictations)

  // Adopt the server's list whenever it changes, adjusting during render rather than in an effect
  // (the pattern React documents for resetting state on a prop change). The local copy exists only
  // so polling can flip a status between refreshes; the server's version always wins.
  const [lastServerRows, setLastServerRows] = useState(dictations)
  if (lastServerRows !== dictations) {
    setLastServerRows(dictations)
    setRows(dictations)
  }

  // Poll only while something is actually transcribing, and stop as soon as nothing is. A list of
  // finished cases holds still.
  useEffect(() => {
    const pending = rows.filter((row) => IN_FLIGHT.has(row.status)).map((row) => row.id)
    if (!pending.length) return
    const timer = setInterval(async () => {
      const result = await getDocumentProcessingStatusAction(workspaceId, pending)
      if (!result.success || !result.data) return
      const byId = new Map(result.data.map((status) => [status.id, status]))
      const settled = result.data.some((status) => !IN_FLIGHT.has(status.status))
      setRows((current) => current.map((row) => {
        const update = byId.get(row.id)
        return update ? { ...row, status: update.status, errorCode: update.errorCode } : row
      }))
      // A finished transcription brings extracted fields with it, which the server component has
      // and this one does not — so refresh rather than paint a half-updated row.
      if (settled) router.refresh()
    }, 3000)
    return () => clearInterval(timer)
  }, [rows, router, workspaceId])

  if (!rows.length) {
    return (
      <section className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-6 py-12 text-center">
        <Mic className="mx-auto h-6 w-6 text-stone-400" />
        <p className="mt-2 text-sm font-medium text-stone-700">No dictations yet</p>
        <p className="mt-1 text-xs text-stone-500">Record one above and it will appear here to verify and sign.</p>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
      <h2 className="border-b border-stone-100 px-4 py-2.5 text-sm font-semibold text-stone-900">Cases</h2>
      <ul className="divide-y divide-stone-100">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/workspaces/${workspaceId}/dictation/${row.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-stone-50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-900">{row.summary ?? row.filename}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                  <span>{row.templateName}</span>
                  <span aria-hidden>·</span>
                  <span>{new Date(row.receivedAt).toLocaleString()}</span>
                  {row.transcriptEdited && <span className="inline-flex items-center gap-1 text-stone-500"><PencilLine className="h-3 w-3" />transcript edited</span>}
                </p>
              </div>
              <StatusBadge row={row} />
              <ChevronRight className="h-4 w-4 shrink-0 text-stone-300" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
